/** 生理期 APP 的資料存取、預測與個人週期比較規則。 */
import type { Backend, RowUpdate, RowValues, TableRow } from './backend';
import { newId } from './ids';
import type { TableName } from './schema';
import { addDays } from './time';

export const PERIOD_FLOWS = ['點狀', '極少', '少量', '普通', '偏多', '大量'] as const;
export const PERIOD_COLORS = ['粉紅', '鮮紅', '暗紅', '褐色', '深褐／近黑', '其他'] as const;
export const PERIOD_CLOTS = ['無', '小於1 cm', '1～2.4 cm', '2.5 cm以上', '未觀察'] as const;
export type PeriodFlow = (typeof PERIOD_FLOWS)[number];
export type PeriodColor = (typeof PERIOD_COLORS)[number];
export type PeriodClot = (typeof PERIOD_CLOTS)[number];

export interface PeriodCycle {
  rowNumber: number;
  id: string;
  startDate: string;
  endDate: string | null;
  excludeFromPrediction: boolean;
  note: string | null;
}

export interface PeriodDay {
  rowNumber: number;
  id: string;
  date: string;
  flow: PeriodFlow | null;
  colors: PeriodColor[];
  clotSize: PeriodClot | null;
  note: string | null;
}

export interface PeriodSettings {
  defaultCycleDays: number | null;
  defaultPeriodDays: number | null;
  ovulationEnabled: boolean;
  lutealPhaseDays: number;
  upcomingReminderEnabled: boolean;
  upcomingReminderDaysBefore: number;
  startDatePromptEnabled: boolean;
  suppliesReminderEnabled: boolean;
}

export const DEFAULT_PERIOD_SETTINGS: PeriodSettings = {
  // （2026-11-20 使用者決定：完全沒有設定資料時先顯示週期 28 天、經期 7 天，之後可自行修改。）
  defaultCycleDays: 28,
  defaultPeriodDays: 7,
  ovulationEnabled: true,
  lutealPhaseDays: 14,
  upcomingReminderEnabled: true,
  upcomingReminderDaysBefore: 3,
  startDatePromptEnabled: true,
  suppliesReminderEnabled: false,
};

export interface PeriodIssue {
  table: TableName;
  rowNumber: number;
  id: string | null;
  raw: Record<string, unknown>;
  problems: string[];
}

export interface PeriodSnapshot {
  loadedAt: number;
  cycles: PeriodCycle[];
  days: PeriodDay[];
  settings: PeriodSettings;
  issues: PeriodIssue[];
}

export interface PeriodPrediction {
  cycleDays: number;
  periodDays: number;
  cycleBasis: 'setting' | 'history';
  periodBasis: 'setting' | 'history';
  nextStart: string;
  nextEnd: string;
  ovulationDate: string | null;
  fertileFrom: string | null;
  fertileTo: string | null;
}

export interface ProjectedPeriod {
  startDate: string;
  endDate: string;
  ovulationDate: string | null;
  fertileFrom: string | null;
  fertileTo: string | null;
}

const str = (v: unknown) => (v == null ? null : String(v));
const isLive = (r: TableRow) => !r.empty && r.values.deletedAt == null;
const bool = (v: unknown, fallback = false) => (typeof v === 'boolean' ? v : fallback);

/** 日期差；用 UTC 避免夏令時間造成 23 / 25 小時。 */
export function dateDiff(a: string, b: string): number {
  const p = (s: string) => s.split('-').map(Number);
  const [ay, am, ad] = p(a);
  const [by, bm, bd] = p(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export const periodLength = (c: Pick<PeriodCycle, 'startDate' | 'endDate'>) => (c.endDate ? dateDiff(c.startDate, c.endDate) + 1 : null);
export const isDateInCycle = (date: string, c: Pick<PeriodCycle, 'startDate' | 'endDate'>) => date >= c.startDate && date <= (c.endDate ?? date);

export function medianDays(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}

/** 尚未確認結束日時，只用該次以前的真實經期估算；不足 3 次就用設定值。 */
export function estimatedPeriodDays(cycles: PeriodCycle[], settings: PeriodSettings, beforeStart?: string): number {
  const durations = cycles
    .filter((c) => !c.excludeFromPrediction && c.endDate && (!beforeStart || c.startDate < beforeStart))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(-6)
    .map((c) => periodLength(c)!)
    .filter((n) => n > 0);
  return durations.length >= 3 ? medianDays(durations)! : settings.defaultPeriodDays ?? DEFAULT_PERIOD_SETTINGS.defaultPeriodDays!;
}

export function estimatedCycleEnd(cycles: PeriodCycle[], settings: PeriodSettings, cycle: Pick<PeriodCycle, 'startDate'>): string {
  return addDays(cycle.startDate, estimatedPeriodDays(cycles, settings, cycle.startDate) - 1);
}

export function cycleIntervals(cycles: PeriodCycle[], predictionOnly = false): { from: PeriodCycle; to: PeriodCycle; days: number }[] {
  const sorted = [...cycles].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const out: { from: PeriodCycle; to: PeriodCycle; days: number }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const from = sorted[i - 1];
    const to = sorted[i];
    if (predictionOnly && (from.excludeFromPrediction || to.excludeFromPrediction)) continue;
    out.push({ from, to, days: dateDiff(from.startDate, to.startDate) });
  }
  return out;
}

export function predictPeriod(snap: Pick<PeriodSnapshot, 'cycles' | 'settings'>): PeriodPrediction | null {
  // （2026-11-20 使用者決定：不足 3 個間隔用自行設定；之後用最近最多 6 個的中間值，晚來時不滑動預測。）
  if (!snap.cycles.length) return null;
  const intervals = cycleIntervals(snap.cycles, true).slice(-6).map((x) => x.days);
  const durations = snap.cycles
    .filter((c) => !c.excludeFromPrediction && c.endDate)
    .slice(-6)
    .map((c) => periodLength(c)!)
    .filter((n) => n > 0);
  const cycleBasis = intervals.length >= 3 ? 'history' : 'setting';
  const periodBasis = durations.length >= 3 ? 'history' : 'setting';
  const cycleDays = cycleBasis === 'history' ? medianDays(intervals)! : snap.settings.defaultCycleDays;
  const periodDays = periodBasis === 'history' ? medianDays(durations)! : snap.settings.defaultPeriodDays;
  if (!cycleDays || !periodDays) return null;
  const last = snap.cycles[snap.cycles.length - 1];
  const nextStart = addDays(last.startDate, cycleDays);
  const nextEnd = addDays(nextStart, periodDays - 1);
  const ovulationDate = snap.settings.ovulationEnabled ? addDays(nextStart, -snap.settings.lutealPhaseDays) : null;
  return {
    cycleDays,
    periodDays,
    cycleBasis,
    periodBasis,
    nextStart,
    nextEnd,
    ovulationDate,
    fertileFrom: ovulationDate ? addDays(ovulationDate, -5) : null,
    fertileTo: ovulationDate ? addDays(ovulationDate, 1) : null,
  };
}

/** 依目前預測基準持續推算到指定日期；每次有真實新資料時會由 predictPeriod 重新起算。 */
export function projectPeriods(snap: Pick<PeriodSnapshot, 'cycles' | 'settings'>, throughDate: string): ProjectedPeriod[] {
  const prediction = predictPeriod(snap);
  if (!prediction) return [];
  const out: ProjectedPeriod[] = [];
  let startDate = prediction.nextStart;
  for (let i = 0; i < 600 && startDate <= throughDate; i++) {
    const endDate = addDays(startDate, prediction.periodDays - 1);
    const ovulationDate = snap.settings.ovulationEnabled ? addDays(startDate, -snap.settings.lutealPhaseDays) : null;
    out.push({
      startDate,
      endDate,
      ovulationDate,
      fertileFrom: ovulationDate ? addDays(ovulationDate, -5) : null,
      fertileTo: ovulationDate ? addDays(ovulationDate, 1) : null,
    });
    startDate = addDays(startDate, prediction.cycleDays);
  }
  return out;
}

export interface PersonalDifference {
  average: number;
  difference: number;
  direction: 'longer' | 'shorter';
}

function differenceFromPrior(values: number[], current: number, threshold: number): PersonalDifference | null {
  if (values.length < 3) return null;
  const average = Math.round(values.slice(-6).reduce((a, b) => a + b, 0) / Math.min(values.length, 6));
  const diff = current - average;
  if (Math.abs(diff) < threshold) return null;
  return { average, difference: Math.abs(diff), direction: diff > 0 ? 'longer' : 'shorter' };
}

/** 指定週期只和它以前的週期相比，不可使用之後補進的資料。 */
export function cycleDifference(cycles: PeriodCycle[], cycle: PeriodCycle): PersonalDifference | null {
  // （2026-11-20 使用者決定：不用固定醫療範圍；只用該日期以前的個人資料，週期差至少 7 天才中性提醒。）
  const intervals = cycleIntervals(cycles).filter((x) => x.to.startDate <= cycle.startDate);
  const current = intervals.find((x) => x.to.id === cycle.id);
  if (!current) return null;
  return differenceFromPrior(
    intervals.filter((x) => x.to.startDate < cycle.startDate).map((x) => x.days),
    current.days,
    7,
  );
}

/** 歷史列表一列顯示「本次開始到下次開始」，提醒也必須使用同一段週期。 */
export function cycleDifferenceToNext(cycles: PeriodCycle[], cycle: PeriodCycle): PersonalDifference | null {
  // （2026-11-22 使用者決定：週期長短說明要跟它所描述的週期天數放在同一筆。）
  const next = cycles
    .filter((x) => x.startDate > cycle.startDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null;
  return next ? cycleDifference(cycles, next) : null;
}

export function durationDifference(cycles: PeriodCycle[], cycle: PeriodCycle): PersonalDifference | null {
  // （2026-11-20 使用者決定：經期天數只和先前個人平均比較，相差至少 3 天才提醒。）
  const current = periodLength(cycle);
  if (current == null) return null;
  const prior = cycles
    .filter((c) => c.startDate < cycle.startDate && c.endDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((c) => periodLength(c)!);
  return differenceFromPrior(prior, current, 3);
}

export function periodStats(cycles: PeriodCycle[]) {
  const intervals = cycleIntervals(cycles).map((x) => x.days);
  const durations = cycles.map(periodLength).filter((n): n is number => n != null);
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  return {
    averageCycle: avg(intervals),
    averagePeriod: avg(durations),
    shortestCycle: intervals.length ? Math.min(...intervals) : null,
    longestCycle: intervals.length ? Math.max(...intervals) : null,
  };
}

const splitMulti = (v: unknown) =>
  (str(v)?.trim() ?? '')
    .split(/[、,，;；]+/)
    .map((x) => x.trim())
    .filter(Boolean);

function parseSettings(rows: TableRow[]): PeriodSettings {
  const kv = new Map<string, unknown>();
  for (const r of rows) {
    const key = str(r.values.key)?.trim();
    if (key && !kv.has(key)) kv.set(key, r.values.value);
  }
  const number = (key: string, fallback: number | null, min: number, max: number) => {
    const raw = kv.get(key);
    const n = typeof raw === 'number' ? raw : raw == null || raw === '' ? NaN : Number(raw);
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
  };
  const boolean = (key: string, fallback: boolean) => (typeof kv.get(key) === 'boolean' ? (kv.get(key) as boolean) : fallback);
  return {
    defaultCycleDays: number('period.defaultCycleDays', DEFAULT_PERIOD_SETTINGS.defaultCycleDays, 1, 365),
    defaultPeriodDays: number('period.defaultPeriodDays', DEFAULT_PERIOD_SETTINGS.defaultPeriodDays, 1, 60),
    ovulationEnabled: boolean('period.ovulationEnabled', true),
    lutealPhaseDays: number('period.lutealPhaseDays', 14, 1, 30)!,
    upcomingReminderEnabled: boolean('period.upcomingReminderEnabled', true),
    upcomingReminderDaysBefore: number('period.upcomingReminderDaysBefore', 3, 0, 30)!,
    startDatePromptEnabled: boolean('period.startDatePromptEnabled', true),
    suppliesReminderEnabled: boolean('period.suppliesReminderEnabled', false),
  };
}

export class PeriodStore {
  private loadQueue: Promise<unknown> = Promise.resolve();
  constructor(private b: Backend) {}

  load(now = Date.now()): Promise<PeriodSnapshot> {
    const p = this.loadQueue.then(() => this.loadNow(now));
    this.loadQueue = p.catch(() => undefined);
    return p;
  }

  private async loadNow(now: number): Promise<PeriodSnapshot> {
    const [cycleRows, dayRows, settingRows] = await Promise.all([
      this.b.read('periodCycles'),
      this.b.read('periodDays'),
      this.b.read('periodSettings'),
    ]);
    const settings = parseSettings(settingRows);
    const issues: PeriodIssue[] = [];
    const cycleFixes: RowUpdate[] = [];
    const candidates: { row: TableRow; cycle: PeriodCycle }[] = [];
    for (const r of cycleRows) {
      if (!isLive(r)) continue;
      const p: string[] = [];
      const start = str(r.values.startDate);
      const end = str(r.values.endDate);
      if (r.errors.includes('startDate') || !start) p.push('開始日期看不懂或沒有填');
      if (r.errors.includes('endDate')) p.push('結束日期看不懂');
      if (start && end && end < start) p.push('結束日期早於開始日期');
      if (r.errors.includes('excludeFromPrediction')) p.push('不納入預測請填 TRUE 或 FALSE');
      if (p.length) {
        issues.push({ table: 'periodCycles', rowNumber: r.rowNumber, id: str(r.values.id), raw: r.raw, problems: p });
        continue;
      }
      let id = str(r.values.id);
      if (!id) {
        id = newId(now);
        cycleFixes.push({ rowNumber: r.rowNumber, expectId: '', values: { id, createdAt: now, updatedAt: now } });
      }
      candidates.push({
        row: r,
        cycle: {
          rowNumber: r.rowNumber,
          id,
          startDate: start!,
          endDate: end || null,
          excludeFromPrediction: bool(r.values.excludeFromPrediction),
          note: str(r.values.note)?.trim() || null,
        },
      });
    }
    candidates.sort((a, b) => a.cycle.startDate.localeCompare(b.cycle.startDate) || a.cycle.rowNumber - b.cycle.rowNumber);
    const allCandidateCycles = candidates.map((x) => x.cycle);
    const invalid = new Map<number, string[]>();
    const problem = (row: number, text: string) => invalid.set(row, [...(invalid.get(row) ?? []), text]);
    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i];
      const aEnd = a.cycle.endDate ?? estimatedCycleEnd(allCandidateCycles, settings, a.cycle);
      for (let j = i + 1; j < candidates.length; j++) {
        const b = candidates[j];
        if (a.cycle.startDate === b.cycle.startDate) {
          problem(a.cycle.rowNumber, '開始日期重複');
          problem(b.cycle.rowNumber, '開始日期重複');
        } else if (b.cycle.startDate <= aEnd) {
          problem(a.cycle.rowNumber, '經期日期和另一筆重疊');
          problem(b.cycle.rowNumber, '經期日期和另一筆重疊');
        }
      }
    }
    for (const c of candidates) {
      const p = invalid.get(c.cycle.rowNumber);
      if (p) issues.push({ table: 'periodCycles', rowNumber: c.cycle.rowNumber, id: c.cycle.id, raw: c.row.raw, problems: p });
    }
    const cycles = candidates.filter((c) => !invalid.has(c.cycle.rowNumber)).map((c) => c.cycle);

    const days: PeriodDay[] = [];
    const dayFixes: RowUpdate[] = [];
    const seenDates = new Map<string, PeriodDay>();
    const duplicateDates = new Set<string>();
    for (const r of dayRows) {
      if (!isLive(r)) continue;
      const p: string[] = [];
      const date = str(r.values.date);
      const flow = str(r.values.flow)?.trim() || null;
      const colors = splitMulti(r.values.colors);
      const clot = str(r.values.clotSize)?.trim() || null;
      if (r.errors.includes('date') || !date) p.push('日期看不懂或沒有填');
      if (flow && !(PERIOD_FLOWS as readonly string[]).includes(flow)) p.push(`經血量「${flow}」看不懂`);
      const badColors = colors.filter((x) => !(PERIOD_COLORS as readonly string[]).includes(x));
      if (badColors.length) p.push(`血色「${badColors.join('、')}」看不懂`);
      if (clot && !(PERIOD_CLOTS as readonly string[]).includes(clot)) p.push(`最大血塊「${clot}」看不懂`);
      if (date && seenDates.has(date)) {
        duplicateDates.add(date);
        p.push('同一日期有重複紀錄');
        const first = seenDates.get(date)!;
        if (!issues.some((x) => x.table === 'periodDays' && x.rowNumber === first.rowNumber))
          issues.push({ table: 'periodDays', rowNumber: first.rowNumber, id: first.id, raw: {}, problems: ['同一日期有重複紀錄'] });
      }
      if (p.length) {
        issues.push({ table: 'periodDays', rowNumber: r.rowNumber, id: str(r.values.id), raw: r.raw, problems: p });
        continue;
      }
      let id = str(r.values.id);
      if (!id) {
        id = newId(now);
        dayFixes.push({ rowNumber: r.rowNumber, expectId: '', values: { id, createdAt: now, updatedAt: now } });
      }
      const day: PeriodDay = {
        rowNumber: r.rowNumber,
        id,
        date: date!,
        flow: flow as PeriodFlow | null,
        colors: PERIOD_COLORS.filter((x) => colors.includes(x)),
        clotSize: clot as PeriodClot | null,
        note: str(r.values.note)?.trim() || null,
      };
      seenDates.set(date!, day);
      days.push(day);
    }
    if (cycleFixes.length) await this.b.update('periodCycles', cycleFixes);
    if (dayFixes.length) await this.b.update('periodDays', dayFixes);
    return { loadedAt: now, cycles, days: days.filter((d) => !duplicateDates.has(d.date)).sort((a, b) => a.date.localeCompare(b.date)), settings, issues };
  }

  private async assertCycleRange(startDate: string, endDate: string | null, ignoreId?: string) {
    const snap = await this.load();
    const existing = snap.cycles.filter((c) => c.id !== ignoreId);
    const candidate: PeriodCycle = { rowNumber: -1, id: ignoreId ?? '__new__', startDate, endDate, excludeFromPrediction: false, note: null };
    const all = [...existing, candidate].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const candidateEnd = endDate ?? estimatedCycleEnd(all, snap.settings, candidate);
    for (const cycle of existing) {
      if (cycle.startDate === startDate) throw new Error('這一天已經是正式經期的開始日');
      const existingEnd = cycle.endDate ?? estimatedCycleEnd(all, snap.settings, cycle);
      if (startDate <= existingEnd && cycle.startDate <= candidateEnd) throw new Error('這次經期和既有的正式經期日期重疊，請先修改既有紀錄');
    }
  }

  async addCycle(startDate: string, endDate: string | null = null) {
    // （2026-11-19 使用者決定：正式經期一定由使用者確認；每日出血不能自動建立或延長經期。）
    if (endDate && endDate < startDate) throw new Error('結束日期不能早於開始日期');
    // （2026-11-21 使用者決定：未填真實結束日先用個人平均／設定天數暫估，歷史開始日不再無限延伸。）
    await this.assertCycleRange(startDate, endDate);
    const now = Date.now();
    await this.b.append('periodCycles', [{ startDate, endDate, excludeFromPrediction: false, id: newId(now), createdAt: now, updatedAt: now }]);
  }

  async updateCycle(cycle: Pick<PeriodCycle, 'rowNumber' | 'id'>, patch: Partial<Pick<PeriodCycle, 'startDate' | 'endDate' | 'excludeFromPrediction' | 'note'>>) {
    if (patch.startDate !== undefined || patch.endDate !== undefined) {
      const snap = await this.load();
      const current = snap.cycles.find((x) => x.id === cycle.id);
      if (!current) throw new Error('找不到這次經期，請重新整理後再試一次');
      const startDate = patch.startDate ?? current.startDate;
      const endDate = patch.endDate !== undefined ? patch.endDate : current.endDate;
      if (endDate && endDate < startDate) throw new Error('結束日期不能早於開始日期');
      await this.assertCycleRange(startDate, endDate, cycle.id);
    }
    const values: RowValues = { updatedAt: Date.now() };
    for (const key of ['startDate', 'endDate', 'excludeFromPrediction', 'note'] as const) if (patch[key] !== undefined) values[key] = patch[key];
    await this.b.update('periodCycles', [{ rowNumber: cycle.rowNumber, expectId: cycle.id, values }]);
  }

  async deleteCycle(cycle: Pick<PeriodCycle, 'rowNumber' | 'id'>) {
    // （2026-11-20 使用者決定：刪除正式經期不連帶刪除每日出血或共用身體狀況。）
    const now = Date.now();
    await this.b.update('periodCycles', [{ rowNumber: cycle.rowNumber, expectId: cycle.id, values: { deletedAt: now, updatedAt: now } }]);
  }

  async saveDay(date: string, input: Pick<PeriodDay, 'flow' | 'colors' | 'clotSize' | 'note'>, current?: Pick<PeriodDay, 'rowNumber' | 'id'>) {
    if (!input.flow && !input.colors.length && !input.clotSize && !input.note?.trim()) throw new Error('請至少填一項出血資料');
    const values: RowValues = {
      date,
      flow: input.flow,
      colors: input.colors.length ? input.colors.join('、') : null,
      clotSize: input.clotSize,
      note: input.note?.trim() || null,
      updatedAt: Date.now(),
    };
    if (current) await this.b.update('periodDays', [{ rowNumber: current.rowNumber, expectId: current.id, values }]);
    else {
      const now = Date.now();
      await this.b.append('periodDays', [{ ...values, id: newId(now), createdAt: now }]);
    }
  }

  async deleteDay(day: Pick<PeriodDay, 'rowNumber' | 'id'>) {
    const now = Date.now();
    await this.b.update('periodDays', [{ rowNumber: day.rowNumber, expectId: day.id, values: { deletedAt: now, updatedAt: now } }]);
  }

  async saveSettings(s: PeriodSettings) {
    if (s.defaultCycleDays != null && (!Number.isInteger(s.defaultCycleDays) || s.defaultCycleDays < 1 || s.defaultCycleDays > 365)) throw new Error('預設週期天數請填 1～365');
    if (s.defaultPeriodDays != null && (!Number.isInteger(s.defaultPeriodDays) || s.defaultPeriodDays < 1 || s.defaultPeriodDays > 60)) throw new Error('預設經期天數請填 1～60');
    if (!Number.isInteger(s.lutealPhaseDays) || s.lutealPhaseDays < 1 || s.lutealPhaseDays > 30) throw new Error('黃體期天數請填 1～30');
    if (!Number.isInteger(s.upcomingReminderDaysBefore) || s.upcomingReminderDaysBefore < 0 || s.upcomingReminderDaysBefore > 30) throw new Error('提前提醒天數請填 0～30');
    const want: RowValues = {
      'period.defaultCycleDays': s.defaultCycleDays,
      'period.defaultPeriodDays': s.defaultPeriodDays,
      'period.ovulationEnabled': s.ovulationEnabled,
      'period.lutealPhaseDays': s.lutealPhaseDays,
      'period.upcomingReminderEnabled': s.upcomingReminderEnabled,
      'period.upcomingReminderDaysBefore': s.upcomingReminderDaysBefore,
      'period.startDatePromptEnabled': s.startDatePromptEnabled,
      'period.suppliesReminderEnabled': s.suppliesReminderEnabled,
    };
    const rows = await this.b.read('periodSettings');
    const updates: RowUpdate[] = [];
    const appends: RowValues[] = [];
    for (const [key, value] of Object.entries(want)) {
      const row = rows.find((r) => str(r.values.key)?.trim() === key);
      if (row) updates.push({ rowNumber: row.rowNumber, values: { value } });
      else appends.push({ key, value });
    }
    if (updates.length) await this.b.update('periodSettings', updates);
    if (appends.length) await this.b.append('periodSettings', appends);
  }
}
