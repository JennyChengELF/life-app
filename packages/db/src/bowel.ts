/**
 * 「廁所大事」APP 的資料存取與排便規則。資料存在「生活APP-廁所大事」試算表。
 * 選項沿用舊試算表（2026-11-18 確認）；選項直接存中文，可以複選的用「、」分開。
 */
import type { Backend, RowUpdate, RowValues, TableRow } from './backend';
import { newId } from './ids';
import type { TableName } from './schema';
import { addDays, startOfDay, toDateKey } from './time';
import type { Judge, Level } from './vitals';

// ───────────── 選項 ─────────────

/** 布里斯托型態；未觀察 = 有排出但沒看或看不出來 */
export const BOWEL_TYPES = ['1', '2', '3', '4', '5', '6', '7', '未觀察'] as const;
export type BowelType = (typeof BOWEL_TYPES)[number];
export const TYPE_NAMES: Record<BowelType, string> = {
  '1': '硬顆粒',
  '2': '凹凸長條',
  '3': '裂痕長條',
  '4': '光滑長條',
  '5': '柔軟塊狀',
  '6': '泥糊狀',
  '7': '水狀',
  未觀察: '未觀察',
};
export const typeLabel = (t: BowelType) => (t === '未觀察' ? t : `${t} ${TYPE_NAMES[t]}`);

export const AMOUNTS = ['極少', '少量', '普通', '普通偏多', '大量'] as const;
export const COLORS = ['黃色', '黃褐色', '褐色', '深褐色', '綠色', '黑色', '紅色', '灰白色', '未觀察'] as const;
export const AFTER_FEELINGS = ['排乾淨', '排不乾淨', '仍有便意'] as const;
export const EASES = ['順暢', '稍微用力', '非常用力'] as const;
export const URGENCIES = ['無', '稍急', '非常急', '來不及'] as const;
export const DURATIONS = ['5分鐘內', '5～10分鐘', '10～20分鐘', '20分鐘以上'] as const;
export const SMELL_LEVELS = ['很淡', '普通', '較臭', '非常臭', '未觀察'] as const;
export const SMELL_TYPES = ['甜味', '酸味', '腐敗味', '其他', '無特殊氣味', '未觀察'] as const;
export const SYMPTOMS = [
  '腹痛',
  '腹脹',
  '腹部絞痛',
  '腸鳴',
  '肛門疼痛',
  '灼熱',
  '搔癢',
  '出血',
  '衛生紙有血',
  '糞便帶血',
  '滴血',
  '黏液',
  '油脂',
  '未消化食物',
  '泡沫',
  '黏馬桶',
  '不易擦乾淨',
  '排氣多',
  '排便失禁',
  '無特殊狀況',
] as const;
/** 算「帶血」的症狀 */
export const BLOOD_SYMPTOMS = ['出血', '衛生紙有血', '糞便帶血', '滴血'] as const;

export type Amount = (typeof AMOUNTS)[number];
export type BowelColor = (typeof COLORS)[number];
export type Symptom = (typeof SYMPTOMS)[number];

/** 單選的欄位與選項 */
export const SINGLE_FIELDS = {
  amount: { label: '量', options: AMOUNTS },
  color: { label: '顏色', options: COLORS },
  afterFeeling: { label: '排便後感受', options: AFTER_FEELINGS },
  ease: { label: '順暢度', options: EASES },
  urgency: { label: '急迫程度', options: URGENCIES },
  duration: { label: '花多久', options: DURATIONS },
  smellLevel: { label: '氣味強度', options: SMELL_LEVELS },
  smellType: { label: '特殊氣味', options: SMELL_TYPES },
} as const;
export type SingleField = keyof typeof SINGLE_FIELDS;
export const SINGLE_FIELD_KEYS = Object.keys(SINGLE_FIELDS) as SingleField[];

/** 沒排出時只填這些（2026-11-18 確認：感受、順暢度、症狀、備註） */
export const NOT_PASSED_FIELDS: SingleField[] = ['afterFeeling', 'ease'];
/** 只有排出才有的欄位 */
export const PASSED_ONLY: (SingleField | 'types')[] = ['types', 'amount', 'color'];

// ───────────── 型別 ─────────────

export interface BowelInput {
  /** false = 有便意但沒排出 */
  passed: boolean;
  types: BowelType[];
  amount: Amount | null;
  color: BowelColor | null;
  afterFeeling: (typeof AFTER_FEELINGS)[number] | null;
  ease: (typeof EASES)[number] | null;
  urgency: (typeof URGENCIES)[number] | null;
  duration: (typeof DURATIONS)[number] | null;
  smellLevel: (typeof SMELL_LEVELS)[number] | null;
  smellType: (typeof SMELL_TYPES)[number] | null;
  symptoms: Symptom[];
  note: string | null;
}

export interface BowelLog extends BowelInput {
  rowNumber: number;
  id: string;
  time: number;
  date: string;
  createdVia: string | null;
}

export interface BowelSettings {
  /** 幾天沒排出算便秘（1–14） */
  constipationDays: number;
  /** 體重比前一次多幾 kg 算「變重」（綜合首頁訊息用） */
  weightGainKg: number;
}

export const DEFAULT_BOWEL_SETTINGS: BowelSettings = { constipationDays: 3, weightGainKg: 0.3 };

export interface BowelIssue {
  table: TableName;
  rowNumber: number;
  id: string | null;
  raw: Record<string, unknown>;
  problems: string[];
}

export interface BowelSnapshot {
  loadedAt: number;
  /** 依時間排序（舊 → 新） */
  logs: BowelLog[];
  settings: BowelSettings;
  issues: BowelIssue[];
}

export const emptyInput = (passed = false): BowelInput => ({
  passed,
  types: [],
  amount: null,
  color: null,
  afterFeeling: null,
  ease: null,
  urgency: null,
  duration: null,
  smellLevel: null,
  smellType: null,
  symptoms: [],
  note: null,
});

// ───────────── 規則：顏色標示（2026-11-18 確認） ─────────────

const RANK: Record<Level, number> = { ok: 0, warn: 1, bad: 2 };
export const worse = (a: Level | null, b: Level | null): Level | null => (a == null ? b : b == null ? a : RANK[b] > RANK[a] ? b : a);

export interface BowelJudge extends Judge {
  /** 原因（例：7 水狀、帶血） */
  reasons: string[];
  /** 出血、黑便、灰白便 → 建議就醫 */
  seeDoctor: boolean;
}

/**
 * 型態 3–5 正常；1、2、6 注意；7 異常。顏色：綠色注意；黑色、紅色、灰白色異常。出血類症狀異常。
 * 型態複選時看最嚴重的。什麼都沒填（或只填未觀察）→ null（不標）
 */
export function judgeBowel(x: Pick<BowelInput, 'passed' | 'types' | 'color' | 'symptoms'>): BowelJudge | null {
  let level: Level | null = null;
  const reasons: string[] = [];
  let seeDoctor = false;
  const add = (l: Level, reason?: string) => {
    level = worse(level, l);
    if (reason) reasons.push(reason);
  };
  if (x.passed) {
    for (const t of x.types) {
      if (t === '7') add('bad', typeLabel(t));
      else if (t === '1' || t === '2' || t === '6') add('warn', typeLabel(t));
      else if (t !== '未觀察') add('ok');
    }
    if (x.color === '綠色') add('warn', '綠色');
    if (x.color === '黑色' || x.color === '紅色' || x.color === '灰白色') {
      add('bad', x.color);
      if (x.color !== '紅色') seeDoctor = true;
    }
  }
  const blood = x.symptoms.filter((s) => (BLOOD_SYMPTOMS as readonly string[]).includes(s));
  if (blood.length) {
    add('bad', '帶血');
    seeDoctor = true;
  }
  // 紅色便也可能是出血
  if (x.passed && x.color === '紅色') seeDoctor = true;
  if (level == null) return null;
  const label = level === 'bad' ? '異常' : level === 'warn' ? '注意' : '正常';
  return { level, label, reasons, seeDoctor };
}

/** 一筆的摘要文字（例：4 光滑長條・普通・褐色） */
export function bowelSummary(x: BowelInput): string {
  if (!x.passed) return '有便意沒排出';
  const parts = [x.types.map((t) => (t === '未觀察' ? '型態未觀察' : typeLabel(t))).join('＋'), x.amount, x.color].filter(Boolean);
  return parts.join('・');
}

/** 有排出的 */
export const passedLogs = (logs: BowelLog[]) => logs.filter((l) => l.passed);

/** 最後一次排出 */
export function lastPassed(logs: BowelLog[], now = Date.now()): BowelLog | null {
  let best: BowelLog | null = null;
  for (const l of logs) if (l.passed && l.time <= now && (!best || l.time > best.time)) best = l;
  return best;
}

/** 經過的時間 → 「1 天 3 小時」「5 小時」「20 分鐘」 */
export function elapsedText(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  if (d > 0) return h ? `${d} 天 ${h} 小時` : `${d} 天`;
  if (h > 0) return `${h} 小時`;
  return min < 1 ? '剛剛' : `${min} 分鐘`;
}

/** 便秘：距離上次排出 ≥ N 天（沒有任何紀錄時不算） */
export function constipation(snap: Pick<BowelSnapshot, 'logs' | 'settings'>, now = Date.now()): { days: number } | null {
  if (!snap.logs.length) return null;
  const last = lastPassed(snap.logs, now);
  // 有紀錄但從來沒排出過：從第一筆紀錄算
  const from = last?.time ?? Math.min(...snap.logs.map((l) => l.time));
  const days = Math.floor((now - from) / 86400000);
  return days >= snap.settings.constipationDays ? { days } : null;
}

/** 腹瀉：那天排出 ≥ 3 次，而且有 6–7 型 */
export function diarrhea(logs: BowelLog[], date: string): { count: number } | null {
  const day = logs.filter((l) => l.date === date && l.passed);
  const loose = day.some((l) => l.types.includes('6') || l.types.includes('7'));
  return day.length >= 3 && loose ? { count: day.length } : null;
}

/** 排便不足：那天沒有排出，或只有一次而且量少（極少 / 少量）（💡 量少的定義是暫定） */
export function insufficient(logs: BowelLog[], date: string): boolean {
  const day = logs.filter((l) => l.date === date && l.passed);
  if (day.length === 0) return true;
  return day.length === 1 && (day[0].amount === '極少' || day[0].amount === '少量');
}

/**
 * 綜合首頁訊息（2026-11-16 確認）：昨天排便不足 → 提醒；今天體重比前一次重 ≥ 門檻 → 加一句。
 * weights：體重紀錄（時間、kg）。從來沒記過排便的人不顯示。
 */
export function bowelHomeMessage(
  snap: Pick<BowelSnapshot, 'logs' | 'settings'>,
  weights: { time: number; kg: number }[],
  now = Date.now(),
): { text: string; weightGain: number | null } | null {
  if (!snap.logs.length) return null;
  const today = toDateKey(now);
  const yesterday = addDays(today, -1);
  // 昨天之前還沒開始記錄 → 不判斷
  if (Math.min(...snap.logs.map((l) => l.time)) >= startOfDay(today)) return null;
  if (!insufficient(snap.logs, yesterday)) return null;
  const sorted = [...weights].filter((w) => w.time <= now).sort((a, b) => a.time - b.time);
  const last = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  let weightGain: number | null = null;
  if (last && prev && toDateKey(last.time) === today) {
    const diff = Math.round((last.kg - prev.kg) * 10) / 10;
    if (diff >= snap.settings.weightGainKg - 1e-9) weightGain = diff;
  }
  return { text: '昨天排便較少，記得多喝水、多吃蔬菜', weightGain };
}

export interface BowelStats {
  /** 排出的次數 */
  count: number;
  /** 有排出的天數 */
  days: number;
  totalDays: number;
  /** 沒排出的次數 */
  notPassed: number;
  /** 型態分布：有這個型態的次數（複選的每個都算） */
  types: { type: BowelType; count: number }[];
  /** 沒填型態的次數 */
  noType: number;
}

/** from、to：日期（含） */
export function bowelStats(logs: BowelLog[], from: string, to: string): BowelStats {
  const inRange = logs.filter((l) => l.date >= from && l.date <= to);
  const passed = inRange.filter((l) => l.passed);
  let totalDays = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) totalDays++;
  return {
    count: passed.length,
    days: new Set(passed.map((l) => l.date)).size,
    totalDays,
    notPassed: inRange.length - passed.length,
    types: BOWEL_TYPES.map((type) => ({ type, count: passed.filter((l) => l.types.includes(type)).length })),
    noType: passed.filter((l) => !l.types.length).length,
  };
}

export interface CalendarDay {
  date: string;
  /** 排出的次數 */
  count: number;
  /** 當天最嚴重的（排出但沒填型態等 → null） */
  level: Level | null;
  /** 只有「有便意沒排出」 */
  onlyNotPassed: boolean;
}

/** 某個月（'YYYY-MM'）每天的狀況 */
export function bowelMonth(logs: BowelLog[], month: string): CalendarDay[] {
  const out: CalendarDay[] = [];
  for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) {
    const day = logs.filter((l) => l.date === d);
    const passed = day.filter((l) => l.passed);
    let level: Level | null = null;
    for (const l of day) level = worse(level, judgeBowel(l)?.level ?? null);
    out.push({ date: d, count: passed.length, level, onlyNotPassed: day.length > 0 && passed.length === 0 });
  }
  return out;
}

// ───────────── 讀取時的整理 ─────────────

const str = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (typeof v === 'number' ? v : null);
const isLive = (r: TableRow) => !r.empty && r.values.deletedAt == null;

/** 「1、4」「1,4」→ 陣列 */
export function splitMulti(v: unknown): string[] {
  const s = str(v)?.trim();
  if (!s) return [];
  return s
    .split(/[、,，;；\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}
export const joinMulti = (xs: readonly string[]) => (xs.length ? xs.join('、') : null);

/** 型態：接受「4」「4 光滑長條」「光滑長條」 */
function parseType(s: string): BowelType | null {
  if ((BOWEL_TYPES as readonly string[]).includes(s)) return s as BowelType;
  const m = /^([1-7])/.exec(s);
  if (m) return m[1] as BowelType;
  const byName = (Object.entries(TYPE_NAMES) as [BowelType, string][]).find(([, n]) => n === s);
  return byName ? byName[0] : null;
}

function checkRow(r: TableRow): string[] {
  const p: string[] = [];
  if (r.errors.includes('time')) p.push('時間格式看不懂（例：2026/11/18 08:30）');
  else if (num(r.values.time) == null) p.push('沒有填時間');
  if (r.errors.includes('passed')) p.push('passed 請填 TRUE（有排出）或 FALSE（沒排出）');
  const types = splitMulti(r.values.types);
  const badTypes = types.filter((t) => !parseType(t));
  if (badTypes.length) p.push(`型態「${badTypes.join('、')}」看不懂（請填 1–7 或 未觀察）`);
  for (const k of SINGLE_FIELD_KEYS) {
    const v = str(r.values[k])?.trim();
    const f = SINGLE_FIELDS[k];
    if (v && !(f.options as readonly string[]).includes(v)) p.push(`${f.label}「${v}」看不懂（請填：${f.options.join('、')}）`);
  }
  const badSym = splitMulti(r.values.symptoms).filter((s) => !(SYMPTOMS as readonly string[]).includes(s));
  if (badSym.length) p.push(`症狀「${badSym.join('、')}」看不懂`);
  return p;
}

function toLog(r: TableRow): BowelLog {
  const v = r.values;
  const one = <K extends SingleField>(k: K) => (str(v[k])?.trim() || null) as BowelInput[K];
  const types = [...new Set(splitMulti(v.types).map((t) => parseType(t)!))];
  return {
    rowNumber: r.rowNumber,
    id: String(v.id),
    time: Number(v.time),
    date: String(v.date),
    createdVia: str(v.createdVia),
    passed: v.passed !== false,
    types: BOWEL_TYPES.filter((t) => types.includes(t)),
    amount: one('amount'),
    color: one('color'),
    afterFeeling: one('afterFeeling'),
    ease: one('ease'),
    urgency: one('urgency'),
    duration: one('duration'),
    smellLevel: one('smellLevel'),
    smellType: one('smellType'),
    symptoms: SYMPTOMS.filter((s) => splitMulti(v.symptoms).includes(s)),
    note: str(v.note),
  };
}

function parseSettings(rows: TableRow[]): BowelSettings {
  const kv = new Map<string, unknown>();
  for (const r of rows) {
    const k = str(r.values.key)?.trim();
    if (k && !kv.has(k)) kv.set(k, r.values.value);
  }
  const n = (k: string) => {
    const v = kv.get(k);
    const x = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(x) ? x : null;
  };
  const days = n('bowel.constipationDays');
  const gain = n('bowel.weightGainKg');
  return {
    constipationDays: days != null && days >= 1 && days <= 14 ? Math.round(days) : DEFAULT_BOWEL_SETTINGS.constipationDays,
    weightGainKg: gain != null && gain > 0 && gain <= 5 ? gain : DEFAULT_BOWEL_SETTINGS.weightGainKg,
  };
}

/** 輸入 → 試算表的值（只轉有給的欄位） */
function toValues(patch: Partial<BowelInput>): RowValues {
  const out: RowValues = {};
  if (patch.passed !== undefined) out.passed = patch.passed;
  if (patch.types !== undefined) {
    for (const t of patch.types) if (!(BOWEL_TYPES as readonly string[]).includes(t)) throw new Error(`型態「${t}」看不懂`);
    out.types = joinMulti(BOWEL_TYPES.filter((t) => patch.types!.includes(t)));
  }
  for (const k of SINGLE_FIELD_KEYS) {
    const v = patch[k];
    if (v === undefined) continue;
    if (v !== null && !(SINGLE_FIELDS[k].options as readonly string[]).includes(v)) throw new Error(`${SINGLE_FIELDS[k].label}「${v}」看不懂`);
    out[k] = v;
  }
  if (patch.symptoms !== undefined) {
    for (const s of patch.symptoms) if (!(SYMPTOMS as readonly string[]).includes(s)) throw new Error(`症狀「${s}」看不懂`);
    out.symptoms = joinMulti(SYMPTOMS.filter((s) => patch.symptoms!.includes(s)));
  }
  if (patch.note !== undefined) out.note = patch.note?.trim() || null;
  return out;
}

// ───────────── 資料存取 ─────────────

export class BowelStore {
  /** 讀取會順便寫入（補齊），一次只跑一個 */
  private loadQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private b: Backend,
    private via = 'bowel',
  ) {}

  load(now = Date.now()): Promise<BowelSnapshot> {
    const p = this.loadQueue.then(() => this.loadNow(now));
    this.loadQueue = p.catch(() => undefined);
    return p;
  }

  private async loadNow(now: number): Promise<BowelSnapshot> {
    const [rows, setRows] = await Promise.all([this.b.read('bowelLogs'), this.b.read('bowelSettings')]);
    const logs: BowelLog[] = [];
    const fixes: RowUpdate[] = [];
    const issues: BowelIssue[] = [];
    for (const r of rows) {
      if (!isLive(r)) continue;
      const id = str(r.values.id);
      const problems = checkRow(r);
      if (problems.length) {
        issues.push({ table: 'bowelLogs', rowNumber: r.rowNumber, id, raw: r.raw, problems });
        continue;
      }
      const date = toDateKey(Number(r.values.time));
      let values = { ...r.values, date };
      const fill: RowValues = {};
      if (!id) {
        Object.assign(fill, { id: newId(now), date, createdVia: str(r.values.createdVia) ?? 'sheet', createdAt: now, updatedAt: now });
      } else if (r.values.date !== date) {
        fill.date = date;
      }
      const types = splitMulti(r.values.types).map((t) => parseType(t)!);
      // 舊規則：passed=TRUE（或已由舊版補過 id、passed 留白）但沒型態，仍代表有排出；轉成「未觀察」。
      if (types.length === 0 && (r.values.passed === true || (r.values.passed == null && id))) {
        Object.assign(fill, { types: '未觀察', passed: true });
      } else {
        const passed = types.length > 0;
        if (r.values.passed !== passed) fill.passed = passed;
      }
      if (Object.keys(fill).length) {
        fixes.push({ rowNumber: r.rowNumber, values: fill, expectId: id ?? '' });
        values = { ...values, ...fill };
      }
      logs.push(toLog({ ...r, values }));
    }
    if (fixes.length) await this.b.update('bowelLogs', fixes);
    logs.sort((a, b) => a.time - b.time);
    return { loadedAt: now, logs, settings: parseSettings(setRows), issues };
  }

  /** 新增一筆；id 可以先在畫面上產生（記完馬上展開詳細欄位用） */
  async addLog(input: Partial<BowelInput> = {}, time = Date.now(), id = newId()): Promise<string> {
    if (time > Date.now() + 5 * 60000) throw new Error('時間不能是未來');
    const now = Date.now();
    // 先驗證呼叫端傳入的選項，再依「沒型態＝沒排出」清除不適用欄位，避免悄悄吞掉錯字。
    toValues(input);
    const full = { ...emptyInput(false), ...input };
    full.passed = full.types.length > 0;
    if (!full.passed) Object.assign(full, { amount: null, color: null });
    const values = toValues(full);
    await this.b.append('bowelLogs', [{ ...values, time, date: toDateKey(time), createdVia: this.via, id, createdAt: now, updatedAt: now }]);
    return id;
  }

  /** 只更新有給的欄位 */
  async updateLog(log: Pick<BowelLog, 'rowNumber' | 'id'>, patch: Partial<BowelInput> & { time?: number }) {
    const { time, ...rest } = patch;
    // 是否排出由型態推導；「未觀察」也算有排出。
    if (rest.types !== undefined) rest.passed = rest.types.length > 0;
    else if (rest.passed === true) rest.types = ['未觀察'];
    else if (rest.passed === false) rest.types = [];
    if (rest.passed === false) Object.assign(rest, { amount: null, color: null });
    const values: RowValues = { ...toValues(rest), updatedAt: Date.now() };
    if (time !== undefined) {
      if (!Number.isFinite(time)) throw new Error('請輸入時間');
      if (time > Date.now() + 5 * 60000) throw new Error('時間不能是未來');
      Object.assign(values, { time, date: toDateKey(time) });
    }
    await this.b.update('bowelLogs', [{ rowNumber: log.rowNumber, values, expectId: log.id }]);
  }

  /** 刪除只做標記（deletedAt） */
  async deleteLog(log: Pick<BowelLog, 'rowNumber' | 'id'>) {
    const now = Date.now();
    await this.b.update('bowelLogs', [{ rowNumber: log.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: log.id }]);
  }

  async saveSettings(s: BowelSettings) {
    if (!Number.isInteger(s.constipationDays) || s.constipationDays < 1 || s.constipationDays > 14) throw new Error('便秘提醒天數請填 1–14');
    if (!Number.isFinite(s.weightGainKg) || s.weightGainKg <= 0 || s.weightGainKg > 5) throw new Error('體重增加請填 0.1–5 kg');
    const rows = await this.b.read('bowelSettings');
    const want: Record<string, number> = { 'bowel.constipationDays': s.constipationDays, 'bowel.weightGainKg': s.weightGainKg };
    const updates: RowUpdate[] = [];
    const appends: RowValues[] = [];
    for (const [key, value] of Object.entries(want)) {
      const r = rows.find((x) => str(x.values.key)?.trim() === key);
      if (r) updates.push({ rowNumber: r.rowNumber, values: { value } });
      else appends.push({ key, value });
    }
    if (updates.length) await this.b.update('bowelSettings', updates);
    if (appends.length) await this.b.append('bowelSettings', appends);
  }

  async discardIssue(issue: BowelIssue) {
    const now = Date.now();
    await this.b.update(issue.table, [{ rowNumber: issue.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: issue.id ?? '' }]);
  }
}
