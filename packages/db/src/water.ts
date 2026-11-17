/**
 * 喝水 APP 的資料存取與規則（也包含喝水需要的體重：存在「健康」試算表）。
 */
import type { Backend, RowUpdate, RowValues, TableRow } from './backend';
import { newId } from './ids';
import type { TableName } from './schema';
import { endOfDay, toDateKey, todayKey } from './time';

// ───────────── 型別 ─────────────

export interface WaterLog {
  rowNumber: number;
  id: string;
  time: number;
  ml: number;
  /** 飲品名稱；null = 預設飲品（清單第一個） */
  drink: string | null;
  note: string | null;
  date: string;
  createdVia: string | null;
}

export interface Drink {
  rowNumber: number;
  id: string;
  name: string;
  sort: number;
}

export interface WaterDay {
  rowNumber: number;
  id: string | null;
  date: string;
  goal: number;
  total: number;
  achieved: boolean;
  weightUsed: number | null;
  factor: number;
  extraMl: number;
  rounded: boolean;
  locked: boolean;
}

export interface Cup {
  rowNumber: number;
  id: string;
  name: string;
  ml: number;
  sort: number;
}

export interface Weight {
  rowNumber: number;
  id: string;
  time: number;
  kg: number;
}

export interface WaterSettings {
  /** ml/kg，25–45 */
  factor: number;
  /** 額外加量 ml */
  extraMl: number;
  /** 四捨五入到百位 */
  roundTo100: boolean;
}

/** 試算表裡需要補齊的資料 */
export interface Issue {
  table: TableName;
  rowNumber: number;
  id: string | null;
  /** 原始內容（顯示給使用者看） */
  raw: Record<string, unknown>;
  problems: string[];
}

export interface WaterSnapshot {
  loadedAt: number;
  logs: WaterLog[];
  days: Map<string, WaterDay>;
  cups: Cup[];
  /** 依排序；第一個是預設飲品 */
  drinks: Drink[];
  weights: Weight[];
  settings: WaterSettings;
  waterIssues: Issue[];
  weightIssues: Issue[];
}

// ───────────── 規則 ─────────────

export const DEFAULT_SETTINGS: WaterSettings = { factor: 30, extraMl: 0, roundTo100: true };
export const FACTOR_MIN = 25;
export const FACTOR_MAX = 45;
/** 沒有體重時的預設目標 */
export const DEFAULT_GOAL = 2000;
/** 第一次使用時建立的飲品清單（2026-11-17 確認） */
export const DEFAULT_DRINKS = ['開水', '其他'];

/** 這筆紀錄喝的是什麼（空白 = 預設飲品） */
export function drinkOf(log: Pick<WaterLog, 'drink'>, drinks: Drink[]): string {
  return log.drink?.trim() || drinks[0]?.name || DEFAULT_DRINKS[0];
}

export interface GoalCalc {
  goal: number;
  weightUsed: number | null;
  factor: number;
  extraMl: number;
  rounded: boolean;
}

/** 目標 = 體重 × 係數 ＋ 額外加量，可選擇四捨五入到百位；沒有體重用預設 2000ml */
export function computeGoal(weightKg: number | null, s: WaterSettings): GoalCalc {
  if (weightKg == null) {
    return { goal: DEFAULT_GOAL, weightUsed: null, factor: s.factor, extraMl: s.extraMl, rounded: s.roundTo100 };
  }
  const raw = weightKg * s.factor + s.extraMl;
  return {
    goal: s.roundTo100 ? Math.round(raw / 100) * 100 : Math.round(raw),
    weightUsed: weightKg,
    factor: s.factor,
    extraMl: s.extraMl,
    rounded: s.roundTo100,
  };
}

/** 某個時間點以前最新的體重（同一天多筆取時間最晚的） */
export function latestWeight(weights: Weight[], atOrBefore = Date.now()): Weight | null {
  let best: Weight | null = null;
  for (const w of weights) if (w.time <= atOrBefore && (!best || w.time > best.time)) best = w;
  return best;
}

// ───────────── 讀取時的整理 ─────────────

const str = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (typeof v === 'number' ? v : null);

/**
 * 時間 + 數值型的紀錄（喝水、體重）共用的整理：
 * - 有效、沒 id（使用者直接在試算表新增）→ 補上系統欄位
 * - 有 id 但 date 和 time 不一致（在試算表改過時間）→ 修正 date
 * - 格式錯誤或缺必填 → 列入「需要補齊」
 */
function triageTimed(
  rows: TableRow[],
  amountCol: 'ml' | 'kg',
  validAmount: (n: number) => boolean,
  now: number,
): { valid: TableRow[]; fixes: RowUpdate[]; issues: Issue[] } {
  const valid: TableRow[] = [];
  const fixes: RowUpdate[] = [];
  const issues: Issue[] = [];
  for (const r of rows) {
    if (r.empty || r.values.deletedAt != null) continue;
    const problems: string[] = [];
    const time = num(r.values.time);
    const amount = num(r.values[amountCol]);
    if (r.errors.includes('time')) problems.push('時間格式看不懂（例：2026/11/17 14:30）');
    else if (time == null) problems.push('沒有填時間');
    if (r.errors.includes(amountCol)) problems.push(`${amountCol} 不是數字`);
    else if (amount == null) problems.push(`沒有填 ${amountCol}`);
    else if (!validAmount(amount)) problems.push(`${amountCol} 的數值不合理`);
    const id = str(r.values.id);
    if (problems.length) {
      issues.push({ table: amountCol === 'ml' ? 'waterLogs' : 'healthWeights', rowNumber: r.rowNumber, id, raw: r.raw, problems });
      continue;
    }
    const date = toDateKey(time!);
    if (!id) {
      const newIdValue = newId(now);
      const values: RowValues = { id: newIdValue, date, createdVia: str(r.values.createdVia) ?? 'sheet', createdAt: now, updatedAt: now };
      fixes.push({ rowNumber: r.rowNumber, values, expectId: '' });
      valid.push({ ...r, values: { ...r.values, ...values } });
    } else {
      if (r.values.date !== date) fixes.push({ rowNumber: r.rowNumber, values: { date }, expectId: id });
      valid.push({ ...r, values: { ...r.values, date } });
    }
  }
  return { valid, fixes, issues };
}

export const validMl = (n: number) => n > 0 && n <= 5000;
export const validKg = (n: number) => n >= 2 && n <= 400;

// ───────────── 資料存取 ─────────────

export class WaterStore {
  /** 讀取會順便寫入（補齊、建立預設資料），所以一次只跑一個，避免重複建立 */
  private loadQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private b: Backend,
    private via = 'water',
  ) {}

  /** 讀取全部資料；順便補齊使用者在試算表新增的列、更新每日目標紀錄 */
  load(now = Date.now()): Promise<WaterSnapshot> {
    const p = this.loadQueue.then(() => this.loadNow(now));
    this.loadQueue = p.catch(() => undefined);
    return p;
  }

  private async loadNow(now: number): Promise<WaterSnapshot> {
    const [logRows, dayRows, cupRows, setRows, weightRows, drinkRows] = await Promise.all([
      this.b.read('waterLogs'),
      this.b.read('waterDays'),
      this.b.read('waterCups'),
      this.b.read('waterSettings'),
      this.b.read('healthWeights'),
      this.b.read('waterDrinks'),
    ]);
    const drinks = await this.ensureDrinks(drinkRows, now);

    const settings = parseSettings(setRows);

    const lt = triageTimed(logRows, 'ml', validMl, now);
    const wt = triageTimed(weightRows, 'kg', validKg, now);
    if (lt.fixes.length) await this.b.update('waterLogs', lt.fixes);
    if (wt.fixes.length) await this.b.update('healthWeights', wt.fixes);

    const logs: WaterLog[] = lt.valid
      .map((r) => ({
        rowNumber: r.rowNumber,
        id: String(r.values.id),
        time: Number(r.values.time),
        ml: Number(r.values.ml),
        drink: str(r.values.drink)?.trim() || null,
        note: str(r.values.note),
        date: String(r.values.date),
        createdVia: str(r.values.createdVia),
      }))
      .sort((a, b) => a.time - b.time);

    const weights: Weight[] = wt.valid
      .map((r) => ({ rowNumber: r.rowNumber, id: String(r.values.id), time: Number(r.values.time), kg: Number(r.values.kg) }))
      .sort((a, b) => a.time - b.time);

    const cups: Cup[] = cupRows
      .filter((r) => !r.empty && r.values.deletedAt == null && r.values.id && r.values.name && num(r.values.ml))
      .map((r) => ({
        rowNumber: r.rowNumber,
        id: String(r.values.id),
        name: String(r.values.name),
        ml: Number(r.values.ml),
        sort: num(r.values.sort) ?? 0,
      }))
      .sort((a, b) => a.sort - b.sort || a.rowNumber - b.rowNumber);

    const days = await this.syncDays(dayRows, logs, weights, settings, now);

    return { loadedAt: now, logs, days, cups, drinks, weights, settings, waterIssues: lt.issues, weightIssues: wt.issues };
  }

  /** 飲品清單；第一次使用（清單是空的）時建立預設的「開水、其他」 */
  private async ensureDrinks(rows: TableRow[], now: number): Promise<Drink[]> {
    const all: Drink[] = rows
      .filter((r) => !r.empty && r.values.deletedAt == null && r.values.id && str(r.values.name)?.trim())
      .map((r) => ({ rowNumber: r.rowNumber, id: String(r.values.id), name: String(r.values.name).trim(), sort: num(r.values.sort) ?? 0 }))
      .sort((a, b) => a.sort - b.sort || a.rowNumber - b.rowNumber);
    // 同名的只留第一個（紀錄用名稱對應，刪掉重複的不影響紀錄）
    const drinks: Drink[] = [];
    const dupes: RowUpdate[] = [];
    for (const d of all) {
      if (drinks.some((x) => x.name === d.name)) dupes.push({ rowNumber: d.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: d.id });
      else drinks.push(d);
    }
    if (dupes.length) await this.b.update('waterDrinks', dupes);
    if (drinks.length || rows.some((r) => !r.empty)) return drinks;
    const seed = DEFAULT_DRINKS.map((name, i) => ({ name, sort: i, id: newId(now), createdAt: now, updatedAt: now }));
    const rowNums = await this.b.append('waterDrinks', seed);
    return seed.map((d, i) => ({ rowNumber: rowNums[i], id: d.id, name: d.name, sort: d.sort }));
  }

  /**
   * 每日目標紀錄：
   * - 今天（及未來）：目標隨最新體重、設定更新，未鎖定
   * - 過去：鎖定目標（之前沒有紀錄的，用當天以前最新的體重計算）
   * - 總量、是否達標永遠依喝水紀錄重算（補記過去的紀錄也會更新）
   */
  private async syncDays(
    dayRows: TableRow[],
    logs: WaterLog[],
    weights: Weight[],
    settings: WaterSettings,
    now: number,
  ): Promise<Map<string, WaterDay>> {
    const today = todayKey(now);
    const days = new Map<string, WaterDay>();
    const updates: RowUpdate[] = [];
    for (const r of dayRows) {
      const date = str(r.values.date);
      if (r.empty || r.values.deletedAt != null || !date || num(r.values.goal) == null) continue;
      if (days.has(date)) {
        // 同一天重複的列只留第一個
        updates.push({ rowNumber: r.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: str(r.values.id) ?? '' });
        continue;
      }
      days.set(date, {
        rowNumber: r.rowNumber,
        id: str(r.values.id),
        date,
        goal: Number(r.values.goal),
        total: num(r.values.total) ?? 0,
        achieved: r.values.achieved === true,
        weightUsed: num(r.values.weightUsed),
        factor: num(r.values.factor) ?? settings.factor,
        extraMl: num(r.values.extraMl) ?? 0,
        rounded: r.values.rounded === true,
        locked: r.values.locked === true,
      });
    }

    const totals = new Map<string, number>();
    for (const l of logs) totals.set(l.date, (totals.get(l.date) ?? 0) + l.ml);

    const dates = new Set<string>([today, ...totals.keys(), ...days.keys()]);
    const appends: { date: string; values: RowValues }[] = [];

    for (const date of [...dates].sort()) {
      const total = totals.get(date) ?? 0;
      const existing = days.get(date);
      const past = date < today;
      let calc: GoalCalc;
      if (past && existing) {
        calc = { goal: existing.goal, weightUsed: existing.weightUsed, factor: existing.factor, extraMl: existing.extraMl, rounded: existing.rounded };
      } else {
        const atTime = past ? endOfDay(date) : now;
        calc = computeGoal(latestWeight(weights, atTime)?.kg ?? null, settings);
      }
      const desired = { ...calc, total, achieved: total >= calc.goal, locked: past };

      if (!existing) {
        const id = newId(now);
        appends.push({ date, values: { date, id, createdAt: now, updatedAt: now, ...desired } });
        days.set(date, { rowNumber: -1, id, date, ...desired });
        continue;
      }
      const changed = (Object.keys(desired) as (keyof typeof desired)[]).filter((k) => existing[k] !== desired[k]);
      if (changed.length) {
        const values: RowValues = { updatedAt: now };
        for (const k of changed) values[k] = desired[k];
        if (!existing.id) values.id = newId(now);
        updates.push({ rowNumber: existing.rowNumber, values });
        days.set(date, { ...existing, ...desired, id: (values.id as string) ?? existing.id });
      }
    }

    if (updates.length) await this.b.update('waterDays', updates);
    if (appends.length) {
      const rowNums = await this.b.append('waterDays', appends.map((a) => a.values));
      appends.forEach((a, i) => {
        const d = days.get(a.date);
        if (d) d.rowNumber = rowNums[i];
      });
    }
    return days;
  }

  // ───── 喝水紀錄 ─────

  async addLog(ml: number, time = Date.now(), drink: string | null = null, note: string | null = null): Promise<string> {
    if (!validMl(ml)) throw new Error('ml 的數值不合理');
    const now = Date.now();
    const id = newId(now);
    await this.b.append('waterLogs', [{ time, ml, drink, note, date: toDateKey(time), createdVia: this.via, id, createdAt: now, updatedAt: now }]);
    return id;
  }

  async updateLog(log: Pick<WaterLog, 'rowNumber' | 'id'>, patch: { time?: number; ml?: number; drink?: string | null; note?: string | null }) {
    if (patch.ml !== undefined && !validMl(patch.ml)) throw new Error('ml 的數值不合理');
    const values: RowValues = { ...patch, updatedAt: Date.now() };
    if (patch.time !== undefined) values.date = toDateKey(patch.time);
    await this.b.update('waterLogs', [{ rowNumber: log.rowNumber, values, expectId: log.id }]);
  }

  /** 刪除只做標記（deletedAt），不真的刪掉那一列 */
  async deleteLog(log: Pick<WaterLog, 'rowNumber' | 'id'>) {
    const now = Date.now();
    await this.b.update('waterLogs', [{ rowNumber: log.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: log.id }]);
  }

  /** 修正「需要補齊」的列 */
  async fixIssue(issue: Issue, patch: { time: number; amount: number }) {
    const isWater = issue.table === 'waterLogs';
    if (!(isWater ? validMl : validKg)(patch.amount)) throw new Error('數值不合理');
    const now = Date.now();
    const values: RowValues = {
      time: patch.time,
      [isWater ? 'ml' : 'kg']: patch.amount,
      date: toDateKey(patch.time),
      updatedAt: now,
    };
    if (!issue.id) Object.assign(values, { id: newId(now), createdAt: now, createdVia: 'sheet' });
    await this.b.update(issue.table, [{ rowNumber: issue.rowNumber, values, expectId: issue.id ?? '' }]);
  }

  /** 不要這一列（標記為刪除） */
  async discardIssue(issue: Issue) {
    const now = Date.now();
    await this.b.update(issue.table, [{ rowNumber: issue.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: issue.id ?? '' }]);
  }

  // ───── 體重（存在健康試算表） ─────

  async addWeight(kg: number, time = Date.now()) {
    if (!validKg(kg)) throw new Error('體重的數值不合理');
    const now = Date.now();
    await this.b.append('healthWeights', [{ time, kg, date: toDateKey(time), createdVia: this.via, id: newId(now), createdAt: now, updatedAt: now }]);
  }

  // ───── 常用杯子 ─────

  async addCup(name: string, ml: number, sort: number) {
    if (!name.trim()) throw new Error('請輸入名稱');
    if (!validMl(ml)) throw new Error('容量不合理');
    const now = Date.now();
    await this.b.append('waterCups', [{ name: name.trim(), ml, sort, id: newId(now), createdAt: now, updatedAt: now }]);
  }

  async updateCup(cup: Pick<Cup, 'rowNumber' | 'id'>, patch: { name?: string; ml?: number; sort?: number }) {
    if (patch.ml !== undefined && !validMl(patch.ml)) throw new Error('容量不合理');
    await this.b.update('waterCups', [{ rowNumber: cup.rowNumber, values: { ...patch, updatedAt: Date.now() }, expectId: cup.id }]);
  }

  async deleteCup(cup: Pick<Cup, 'rowNumber' | 'id'>) {
    const now = Date.now();
    await this.b.update('waterCups', [{ rowNumber: cup.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: cup.id }]);
  }

  // ───── 飲品清單 ─────

  async addDrink(name: string, existing: Drink[]) {
    const n = name.trim();
    if (!n) throw new Error('請輸入飲品名稱');
    if (existing.some((d) => d.name === n)) throw new Error('已經有這個飲品了');
    const now = Date.now();
    const sort = Math.max(-1, ...existing.map((d) => d.sort)) + 1;
    await this.b.append('waterDrinks', [{ name: n, sort, id: newId(now), createdAt: now, updatedAt: now }]);
  }

  /** 改名：喝水紀錄裡用舊名稱的也一起改 */
  async renameDrink(drink: Drink, newName: string, existing: Drink[]) {
    const n = newName.trim();
    if (!n) throw new Error('請輸入飲品名稱');
    if (n === drink.name) return;
    if (existing.some((d) => d.id !== drink.id && d.name === n)) throw new Error('已經有這個飲品了');
    const now = Date.now();
    await this.b.update('waterDrinks', [{ rowNumber: drink.rowNumber, values: { name: n, updatedAt: now }, expectId: drink.id }]);
    const logs = await this.b.read('waterLogs');
    const updates: RowUpdate[] = logs
      .filter((r) => str(r.values.drink)?.trim() === drink.name && r.values.id)
      .map((r) => ({ rowNumber: r.rowNumber, values: { drink: n, updatedAt: now }, expectId: String(r.values.id) }));
    if (updates.length) await this.b.update('waterLogs', updates);
  }

  /** 刪除只是不出現在選單；舊紀錄保留原本的名稱 */
  async deleteDrink(drink: Drink, existing: Drink[]) {
    if (existing.length <= 1) throw new Error('至少要留一個飲品');
    const now = Date.now();
    await this.b.update('waterDrinks', [{ rowNumber: drink.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: drink.id }]);
  }

  // ───── 設定 ─────

  async saveSettings(patch: Partial<WaterSettings>) {
    if (patch.factor !== undefined && (patch.factor < FACTOR_MIN || patch.factor > FACTOR_MAX)) {
      throw new Error(`係數要在 ${FACTOR_MIN}–${FACTOR_MAX} 之間`);
    }
    if (patch.extraMl !== undefined && (patch.extraMl < 0 || patch.extraMl > 3000)) throw new Error('額外加量不合理');
    const rows = await this.b.read('waterSettings');
    const updates: RowUpdate[] = [];
    const appends: RowValues[] = [];
    for (const [k, v] of Object.entries(patch)) {
      const key = `water.${k}`;
      const row = rows.find((r) => r.values.key === key);
      if (row) updates.push({ rowNumber: row.rowNumber, values: { value: v } });
      else appends.push({ key, value: v });
    }
    if (updates.length) await this.b.update('waterSettings', updates);
    if (appends.length) await this.b.append('waterSettings', appends);
  }
}

function parseSettings(rows: TableRow[]): WaterSettings {
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    const key = str(r.values.key);
    const v = r.values.value;
    if (key === 'water.factor' && typeof v === 'number' && v >= FACTOR_MIN && v <= FACTOR_MAX) s.factor = v;
    if (key === 'water.extraMl' && typeof v === 'number' && v >= 0) s.extraMl = v;
    if (key === 'water.roundTo100' && typeof v === 'boolean') s.roundTo100 = v;
  }
  return s;
}
