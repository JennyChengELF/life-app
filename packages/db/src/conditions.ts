/** 健康試算表中的共用身體狀況；第一版由生理期 APP 使用。 */
import type { Backend, RowUpdate, RowValues, TableRow } from './backend';
import { newId } from './ids';
import type { TableName } from './schema';
import { toDateKey } from './time';

export const CONDITION_SEVERITIES = ['輕微', '中等', '嚴重'] as const;
export type ConditionSeverity = (typeof CONDITION_SEVERITIES)[number];

export interface ConditionItem {
  rowNumber: number;
  id: string;
  name: string;
  showInHealth: boolean;
  showInPeriod: boolean;
  showInBowel: boolean;
  sort: number;
  archived: boolean;
}

export interface ConditionLog {
  rowNumber: number;
  id: string;
  time: number | null;
  date: string;
  symptom: string;
  severity: ConditionSeverity | null;
  note: string | null;
  createdVia: string | null;
}

export interface ConditionIssue {
  table: TableName;
  rowNumber: number;
  id: string | null;
  raw: Record<string, unknown>;
  problems: string[];
}

export interface ConditionSnapshot {
  loadedAt: number;
  items: ConditionItem[];
  logs: ConditionLog[];
  weights: ConditionWeight[];
  issues: ConditionIssue[];
}

export interface ConditionWeight {
  time: number;
  date: string;
  kg: number;
}

export interface ConditionLogDraft {
  id?: string;
  rowNumber?: number;
  symptom: string;
  severity: ConditionSeverity | null;
  note: string | null;
  time: number | null;
}

/** （2026-11-20 使用者決定：第一次建表加入這批預設項目；腰痠、腰痛分開。） */
export const DEFAULT_CONDITION_ITEMS: Omit<ConditionItem, 'rowNumber' | 'id' | 'sort' | 'archived'>[] = [
  ...['下腹痛', '腹脹', '脹氣', '腹部絞痛'].map((name) => ({ name, showInHealth: true, showInPeriod: true, showInBowel: true })),
  { name: '腸鳴', showInHealth: true, showInPeriod: false, showInBowel: true },
  ...['頭痛', '腰痠', '腰痛', '乳房脹痛', '噁心', '疲倦', '頭暈', '水腫', '長痘', '睡不好'].map((name) => ({
    name,
    showInHealth: true,
    showInPeriod: true,
    showInBowel: false,
  })),
];

const SEED_KEY = 'health.conditionSeedVersion';
const SEED_VERSION = 1;
const str = (v: unknown) => (v == null ? null : String(v));
const live = (r: TableRow) => !r.empty && r.values.deletedAt == null;
const asBool = (v: unknown) => v === true;
const asNum = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export class ConditionStore {
  private loadQueue: Promise<unknown> = Promise.resolve();
  constructor(
    private b: Backend,
    private via = 'period',
  ) {}

  load(now = Date.now()): Promise<ConditionSnapshot> {
    const p = this.loadQueue.then(() => this.loadNow(now));
    this.loadQueue = p.catch(() => undefined);
    return p;
  }

  private async loadNow(now: number): Promise<ConditionSnapshot> {
    let [itemRows, logRows, settingRows, weightRows] = await Promise.all([
      this.b.read('healthConditionItems'),
      this.b.read('healthConditionLogs'),
      this.b.read('healthSettings'),
      this.b.read('healthBodyMeasurements'),
    ]);
    const seeded = settingRows.some((r) => str(r.values.key)?.trim() === SEED_KEY && Number(r.values.value) >= SEED_VERSION);
    if (!seeded) {
      // （2026-11-20 使用者決定：種子只執行一次；之後不恢復使用者刪除、停用或修改的項目。）
      const existing = new Set(itemRows.filter(live).map((r) => str(r.values.name)?.trim()).filter(Boolean));
      const rows: RowValues[] = [];
      DEFAULT_CONDITION_ITEMS.forEach((x, i) => {
        if (existing.has(x.name)) return;
        rows.push({ ...x, sort: i + 1, archived: false, id: newId(now + i), createdAt: now, updatedAt: now });
      });
      if (rows.length) await this.b.append('healthConditionItems', rows);
      const marker = settingRows.find((r) => str(r.values.key)?.trim() === SEED_KEY);
      if (marker) await this.b.update('healthSettings', [{ rowNumber: marker.rowNumber, values: { value: SEED_VERSION } }]);
      else await this.b.append('healthSettings', [{ key: SEED_KEY, value: SEED_VERSION }]);
      itemRows = await this.b.read('healthConditionItems');
    }

    const issues: ConditionIssue[] = [];
    const itemFixes: RowUpdate[] = [];
    const items: ConditionItem[] = [];
    const names = new Set<string>();
    for (const r of itemRows) {
      if (!live(r)) continue;
      const name = str(r.values.name)?.trim();
      const problems: string[] = [];
      if (!name) problems.push('沒有填症狀名稱');
      else if (names.has(name)) problems.push(`症狀名稱「${name}」重複`);
      if (problems.length) {
        issues.push({ table: 'healthConditionItems', rowNumber: r.rowNumber, id: str(r.values.id), raw: r.raw, problems });
        continue;
      }
      names.add(name!);
      let id = str(r.values.id);
      if (!id) {
        id = newId(now);
        itemFixes.push({ rowNumber: r.rowNumber, expectId: '', values: { id, createdAt: now, updatedAt: now } });
      }
      items.push({
        rowNumber: r.rowNumber,
        id,
        name: name!,
        showInHealth: asBool(r.values.showInHealth),
        showInPeriod: asBool(r.values.showInPeriod),
        showInBowel: asBool(r.values.showInBowel),
        sort: asNum(r.values.sort, items.length + 1),
        archived: asBool(r.values.archived),
      });
    }
    if (itemFixes.length) await this.b.update('healthConditionItems', itemFixes);
    items.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-Hant'));

    const logFixes: RowUpdate[] = [];
    const logs: ConditionLog[] = [];
    for (const r of logRows) {
      if (!live(r)) continue;
      const problems: string[] = [];
      let date = str(r.values.date);
      const time = typeof r.values.time === 'number' ? r.values.time : null;
      if (r.errors.includes('time')) problems.push('時間格式看不懂');
      if (time != null) date = toDateKey(time);
      if (r.errors.includes('date') || !date) problems.push('日期看不懂或沒有填');
      const symptom = str(r.values.symptom)?.trim();
      if (!symptom) problems.push('沒有填症狀');
      else if (!items.some((x) => x.name === symptom)) problems.push(`症狀「${symptom}」不在項目清單裡`);
      const severity = str(r.values.severity)?.trim() || null;
      if (severity && !(CONDITION_SEVERITIES as readonly string[]).includes(severity)) problems.push(`程度「${severity}」看不懂`);
      if (problems.length) {
        issues.push({ table: 'healthConditionLogs', rowNumber: r.rowNumber, id: str(r.values.id), raw: r.raw, problems });
        continue;
      }
      let id = str(r.values.id);
      const fill: RowValues = {};
      if (!id) {
        id = newId(now);
        Object.assign(fill, { id, createdAt: now, updatedAt: now, createdVia: str(r.values.createdVia) ?? 'sheet' });
      }
      if (time != null && r.values.date !== date) fill.date = date;
      if (Object.keys(fill).length) logFixes.push({ rowNumber: r.rowNumber, expectId: str(r.values.id) ?? '', values: fill });
      logs.push({
        rowNumber: r.rowNumber,
        id,
        time,
        date: date!,
        symptom: symptom!,
        severity: severity as ConditionSeverity | null,
        note: str(r.values.note)?.trim() || null,
        createdVia: str(r.values.createdVia),
      });
    }
    if (logFixes.length) await this.b.update('healthConditionLogs', logFixes);
    logs.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? 0) - (b.time ?? 0));
    // （2026-11-21 使用者決定：生理期的日期摘要顯示健康 APP 當天最後一筆體重。）
    const weights: ConditionWeight[] = weightRows
      .filter(live)
      .map((r) => ({ time: typeof r.values.time === 'number' ? r.values.time : NaN, kg: typeof r.values.kg === 'number' ? r.values.kg : NaN }))
      .filter((x) => Number.isFinite(x.time) && Number.isFinite(x.kg) && x.kg >= 2 && x.kg <= 400)
      .map((x) => ({ ...x, date: toDateKey(x.time) }))
      .sort((a, b) => a.time - b.time);
    return { loadedAt: now, items, logs, weights, issues };
  }

  async addLogs(date: string, symptoms: string[], severity: ConditionSeverity | null, note: string | null, time: number | null = null) {
    if (!symptoms.length) throw new Error('請至少選一個身體狀況');
    const now = Date.now();
    await this.b.append(
      'healthConditionLogs',
      symptoms.map((symptom, i) => ({
        time,
        date: time == null ? date : toDateKey(time),
        symptom,
        severity,
        note: note?.trim() || null,
        personId: null,
        createdVia: this.via,
        id: newId(now + i),
        createdAt: now,
        updatedAt: now,
      })),
    );
  }

  async saveDayLogs(date: string, drafts: ConditionLogDraft[], current: ConditionLog[]) {
    // （2026-11-20 使用者決定：一天的身體狀況先在畫面編輯，最後和當天資料一起整批儲存；時間與程度都可以留白。）
    if (drafts.some((x) => !x.symptom.trim())) throw new Error('身體狀況名稱不能空白');
    const now = Date.now();
    const keptIds = new Set(drafts.map((x) => x.id).filter((x): x is string => !!x));
    const updates: RowUpdate[] = current
      .filter((x) => !keptIds.has(x.id))
      .map((x) => ({ rowNumber: x.rowNumber, expectId: x.id, values: { deletedAt: now, updatedAt: now } }));
    for (const draft of drafts) {
      if (!draft.id || draft.rowNumber == null) continue;
      updates.push({
        rowNumber: draft.rowNumber,
        expectId: draft.id,
        values: {
          time: draft.time,
          date: draft.time == null ? date : toDateKey(draft.time),
          symptom: draft.symptom.trim(),
          severity: draft.severity,
          note: draft.note?.trim() || null,
          updatedAt: now,
        },
      });
    }
    if (updates.length) await this.b.update('healthConditionLogs', updates);
    const additions = drafts.filter((x) => !x.id);
    if (additions.length) {
      await this.b.append(
        'healthConditionLogs',
        additions.map((draft, i) => ({
          time: draft.time,
          date: draft.time == null ? date : toDateKey(draft.time),
          symptom: draft.symptom.trim(),
          severity: draft.severity,
          note: draft.note?.trim() || null,
          personId: null,
          createdVia: this.via,
          id: newId(now + i),
          createdAt: now,
          updatedAt: now,
        })),
      );
    }
  }

  async updateLog(log: Pick<ConditionLog, 'rowNumber' | 'id'>, patch: Partial<Pick<ConditionLog, 'date' | 'time' | 'symptom' | 'severity' | 'note'>>) {
    const values: RowValues = { updatedAt: Date.now() };
    for (const key of ['date', 'time', 'symptom', 'severity', 'note'] as const) if (patch[key] !== undefined) values[key] = patch[key];
    if (patch.time != null) values.date = toDateKey(patch.time);
    await this.b.update('healthConditionLogs', [{ rowNumber: log.rowNumber, expectId: log.id, values }]);
  }

  async deleteLog(log: Pick<ConditionLog, 'rowNumber' | 'id'>) {
    const now = Date.now();
    await this.b.update('healthConditionLogs', [{ rowNumber: log.rowNumber, expectId: log.id, values: { deletedAt: now, updatedAt: now } }]);
  }

  async addItem(name: string) {
    const clean = name.trim();
    if (!clean) throw new Error('請輸入症狀名稱');
    const rows = await this.b.read('healthConditionItems');
    if (rows.some((r) => live(r) && str(r.values.name)?.trim() === clean)) throw new Error('已經有同名的症狀');
    const sort = Math.max(0, ...rows.map((r) => asNum(r.values.sort, 0))) + 1;
    const now = Date.now();
    await this.b.append('healthConditionItems', [{ name: clean, showInHealth: false, showInPeriod: true, showInBowel: false, sort, archived: false, id: newId(now), createdAt: now, updatedAt: now }]);
  }

  async updateItem(item: Pick<ConditionItem, 'rowNumber' | 'id'>, patch: Partial<Pick<ConditionItem, 'name' | 'showInPeriod' | 'sort' | 'archived'>>) {
    if (patch.name !== undefined) {
      const clean = patch.name.trim();
      if (!clean) throw new Error('請輸入症狀名稱');
      const items = await this.b.read('healthConditionItems');
      const current = items.find((r) => r.rowNumber === item.rowNumber && str(r.values.id) === item.id);
      const oldName = str(current?.values.name)?.trim();
      if (items.some((r) => live(r) && r.rowNumber !== item.rowNumber && str(r.values.name)?.trim() === clean)) throw new Error('已經有同名的症狀');
      patch.name = clean;
      if (oldName && oldName !== clean) {
        const logs = await this.b.read('healthConditionLogs');
        const updates = logs.filter((r) => live(r) && str(r.values.symptom)?.trim() === oldName).map((r) => ({ rowNumber: r.rowNumber, expectId: str(r.values.id) ?? '', values: { symptom: clean, updatedAt: Date.now() } }));
        if (updates.length) await this.b.update('healthConditionLogs', updates);
      }
    }
    const values: RowValues = { updatedAt: Date.now() };
    for (const key of ['name', 'showInPeriod', 'sort', 'archived'] as const) if (patch[key] !== undefined) values[key] = patch[key];
    await this.b.update('healthConditionItems', [{ rowNumber: item.rowNumber, expectId: item.id, values }]);
  }

  async deleteItem(item: Pick<ConditionItem, 'rowNumber' | 'id'>) {
    const now = Date.now();
    // 有歷史紀錄時仍需保留名稱，所以「刪除」在底層改成停用且不在生理期顯示。
    await this.b.update('healthConditionItems', [{ rowNumber: item.rowNumber, expectId: item.id, values: { archived: true, showInPeriod: false, updatedAt: now } }]);
  }
}
