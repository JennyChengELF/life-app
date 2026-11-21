/**
 * 血壓、血糖、體溫的規則（顏色標示、722、測量時機）。
 * 這裡只放計算，不碰資料存取；存取在 health.ts 的 HealthStore。
 */
import { addDays, toDateKey } from './time';

/** 顏色標示：正常（綠）、偏高 / 偏低（黃）、異常（紅） */
export type Level = 'ok' | 'warn' | 'bad';
export interface Judge {
  level: Level;
  label: string;
}

export interface AttentionReason {
  level: Exclude<Level, 'ok'>;
  text: string;
}

// ───────────── 型別 ─────────────

interface Base {
  rowNumber: number;
  id: string;
  time: number;
  date: string;
  note: string | null;
}

export interface BloodPressure extends Base {
  systolic: number;
  diastolic: number;
  pulse: number | null;
}

export const GLUCOSE_TIMINGS = ['空腹', '飯前', '飯後2小時', '睡前', '隨機'] as const;
export type GlucoseTiming = (typeof GLUCOSE_TIMINGS)[number];

export interface BloodGlucose extends Base {
  timing: GlucoseTiming;
  mgdl: number;
}

export const TEMP_KINDS = ['一般', '基礎'] as const;
export type TempKind = (typeof TEMP_KINDS)[number];
export const TEMP_SITES = ['耳溫', '額溫', '口溫', '腋溫'] as const;
export type TempSite = (typeof TEMP_SITES)[number];

export interface Temperature extends Base {
  kind: TempKind;
  /** null = 沒填 */
  site: TempSite | null;
  celsius: number;
}

/** 合理的輸入範圍 */
export const BP_RANGE = { systolic: [40, 300], diastolic: [20, 200], pulse: [20, 250] } as const;
export const GLUCOSE_RANGE = [10, 1000] as const;
export const TEMP_RANGE = [30, 45] as const;

// ───────────── 顏色標示（2026-11-17 確認） ─────────────

/** 台灣 2022 居家血壓：< 130/80 正常；130–139 或 80–89 偏高；≥ 140/90 高；< 90/60 偏低 */
export function judgeBp(sys: number, dia: number): Judge {
  if (sys >= 140 || dia >= 90) return { level: 'bad', label: '高' };
  if (sys >= 130 || dia >= 80) return { level: 'warn', label: '偏高' };
  if (sys < 90 || dia < 60) return { level: 'warn', label: '偏低' };
  return { level: 'ok', label: '正常' };
}

/** 一筆血壓需要注意的全部原因，包含收縮壓、舒張壓與脈搏。（2026-11-21 使用者決定） */
export function bpAttentionReasons(sys: number, dia: number, pulse: number | null): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  if (sys >= 140) reasons.push({ level: 'bad', text: `收縮壓過高：${sys} mmHg（140 以上）` });
  else if (sys >= 130) reasons.push({ level: 'warn', text: `收縮壓偏高：${sys} mmHg（130–139）` });
  else if (sys < 90) reasons.push({ level: 'warn', text: `收縮壓偏低：${sys} mmHg（低於 90）` });

  if (dia >= 90) reasons.push({ level: 'bad', text: `舒張壓過高：${dia} mmHg（90 以上）` });
  else if (dia >= 80) reasons.push({ level: 'warn', text: `舒張壓偏高：${dia} mmHg（80–89）` });
  else if (dia < 60) reasons.push({ level: 'warn', text: `舒張壓偏低：${dia} mmHg（低於 60）` });

  if (pulse != null && pulse < 60) reasons.push({ level: 'warn', text: `心跳偏慢：${pulse} 次／分（低於 60）` });
  else if (pulse != null && pulse > 100) reasons.push({ level: 'warn', text: `心跳過快：${pulse} 次／分（高於 100）` });
  return reasons;
}

/** 列表用的整筆判斷；有任一原因就顯示「需注意」。 */
export function judgeBpReading(sys: number, dia: number, pulse: number | null): Judge {
  const reasons = bpAttentionReasons(sys, dia, pulse);
  return reasons.length
    ? { level: reasons.some((reason) => reason.level === 'bad') ? 'bad' : 'warn', label: '需注意' }
    : { level: 'ok', label: '一般範圍' };
}

/**
 * 血糖：任何時機 < 54 低血糖（紅）、< 70 偏低（黃）；
 * 空腹 / 飯前 70–99 正常、100–125 偏高、≥ 126 高；
 * 飯後 2 小時 < 140 正常、140–199 偏高、≥ 200 高；睡前 / 隨機 ≥ 200 高
 */
export function judgeGlucose(timing: GlucoseTiming, mgdl: number): Judge {
  if (mgdl < 54) return { level: 'bad', label: '低血糖' };
  if (mgdl < 70) return { level: 'warn', label: '偏低' };
  if (timing === '空腹' || timing === '飯前') {
    if (mgdl >= 126) return { level: 'bad', label: '高' };
    if (mgdl >= 100) return { level: 'warn', label: '偏高' };
  } else if (timing === '飯後2小時') {
    if (mgdl >= 200) return { level: 'bad', label: '高' };
    if (mgdl >= 140) return { level: 'warn', label: '偏高' };
  } else if (mgdl >= 200) return { level: 'bad', label: '高' };
  return { level: 'ok', label: '正常' };
}

/** 一筆血糖需要注意的原因，文字包含測量時機與該時機的門檻。（2026-11-21 使用者決定） */
export function glucoseAttentionReasons(timing: GlucoseTiming, mgdl: number): AttentionReason[] {
  if (mgdl < 54) return [{ level: 'bad', text: `${timing}血糖過低：${mgdl} mg/dL（低於 54，低血糖）` }];
  if (mgdl < 70) return [{ level: 'warn', text: `${timing}血糖偏低：${mgdl} mg/dL（低於 70）` }];
  if (timing === '空腹' || timing === '飯前') {
    if (mgdl >= 126) return [{ level: 'bad', text: `${timing}血糖過高：${mgdl} mg/dL（126 以上）` }];
    if (mgdl >= 100) return [{ level: 'warn', text: `${timing}血糖偏高：${mgdl} mg/dL（100–125）` }];
  } else if (timing === '飯後2小時') {
    if (mgdl >= 200) return [{ level: 'bad', text: `飯後 2 小時血糖過高：${mgdl} mg/dL（200 以上）` }];
    if (mgdl >= 140) return [{ level: 'warn', text: `飯後 2 小時血糖偏高：${mgdl} mg/dL（140–199）` }];
  } else if (mgdl >= 200) return [{ level: 'bad', text: `${timing}血糖過高：${mgdl} mg/dL（200 以上）` }];
  return [];
}

/** 一般體溫：≥ 38 發燒（紅）、≥ 37.5 微燒（黃）；基礎體溫不標顏色 */
export function judgeTemp(kind: TempKind, c: number): Judge | null {
  if (kind === '基礎') return null;
  if (c >= 38) return { level: 'bad', label: '發燒' };
  if (c >= 37.5) return { level: 'warn', label: '微燒' };
  return { level: 'ok', label: '正常' };
}

/**
 * 依時間猜測量時機（使用者可以再改）：
 * 04:00–09:59 空腹、21:00–03:59 睡前、其他時間飯前（💡 飯前的標準較嚴，猜錯時寧可多提醒）
 */
export function guessTiming(time: number): GlucoseTiming {
  const h = new Date(time).getHours();
  if (h >= 4 && h < 10) return '空腹';
  if (h >= 21 || h < 4) return '睡前';
  return '飯前';
}

// ───────────── 血壓 722 ─────────────

/** 早上 / 晚上的時段，以「當天 00:00 起的分鐘」表示；結束 < 開始代表跨過半夜 */
export interface TimeRange {
  start: number;
  end: number;
}
export interface BpPeriods {
  morning: TimeRange;
  evening: TimeRange;
}
export const DEFAULT_BP_PERIODS = { morning: '04:00-12:00', evening: '18:00-02:00' };

/** 'HH:MM-HH:MM' → 時段；看不懂回傳 null */
export function parseRange(text: unknown): TimeRange | null {
  const m = typeof text === 'string' ? /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(text) : null;
  if (!m) return null;
  const [h1, m1, h2, m2] = m.slice(1).map(Number);
  if (h1 > 23 || h2 > 24 || m1 > 59 || m2 > 59) return null;
  const start = h1 * 60 + m1;
  const end = (h2 * 60 + m2) % 1440;
  return start === end ? null : { start, end };
}

const pad = (n: number) => String(n).padStart(2, '0');
export const formatRange = (r: TimeRange) => `${pad(Math.floor(r.start / 60))}:${pad(r.start % 60)}-${pad(Math.floor(r.end / 60))}:${pad(r.end % 60)}`;

/** 兩個時段不能重疊 */
export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  const mins = (r: TimeRange) => {
    const s = new Set<number>();
    for (let m = r.start; m !== r.end; m = (m + 1) % 1440) s.add(m);
    return s;
  };
  const sa = mins(a);
  for (const m of mins(b)) if (sa.has(m)) return true;
  return false;
}

/** 這個時間屬於哪一天的早上 / 晚上（跨過半夜的部分算前一天）；都不是回傳 null */
export function bpPeriodOf(time: number, p: BpPeriods): { day: string; period: 'morning' | 'evening' } | null {
  const d = new Date(time);
  const m = d.getHours() * 60 + d.getMinutes();
  for (const period of ['morning', 'evening'] as const) {
    const r = p[period];
    const crosses = r.end < r.start;
    const inside = crosses ? m >= r.start || m < r.end : m >= r.start && m < r.end;
    if (!inside) continue;
    const day = crosses && m < r.end ? addDays(toDateKey(time), -1) : toDateKey(time);
    return { day, period };
  }
  return null;
}

/** 間隔 10 分鐘內的多筆算同一次 */
export const SESSION_GAP_MS = 10 * 60000;

export interface BpAverage {
  sys: number;
  dia: number;
  /** 有填脈搏的才算 */
  pulse: number | null;
  n: number;
}

export function averageBp(list: Pick<BloodPressure, 'systolic' | 'diastolic' | 'pulse'>[]): BpAverage | null {
  if (!list.length) return null;
  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  const pulses = list.map((x) => x.pulse).filter((x): x is number => x != null);
  return { sys: avg(list.map((x) => x.systolic)), dia: avg(list.map((x) => x.diastolic)), pulse: pulses.length ? avg(pulses) : null, n: list.length };
}

type DaySessions = { morning?: BloodPressure[]; evening?: BloodPressure[]; closed: Set<string> };

/** 每一天早上 / 晚上的「第一次」量測（間隔 10 分鐘內的連續多筆）；之後的另一次量測不算 */
function firstSessions(list: BloodPressure[], p: BpPeriods): Map<string, DaySessions> {
  const out = new Map<string, DaySessions>();
  for (const r of [...list].sort((a, b) => a.time - b.time)) {
    const at = bpPeriodOf(r.time, p);
    if (!at) continue;
    const day = out.get(at.day) ?? { closed: new Set<string>() };
    out.set(at.day, day);
    if (day.closed.has(at.period)) continue;
    const s = day[at.period];
    if (!s) day[at.period] = [r];
    else if (r.time - s[s.length - 1].time <= SESSION_GAP_MS) s.push(r);
    else day.closed.add(at.period);
  }
  return out;
}

export interface Bp722 {
  /** 7 天（舊 → 新） */
  days: string[];
  morning: BpAverage;
  evening: BpAverage;
  all: BpAverage;
  judge: Judge;
}

/**
 * 722：連續 7 天、早晚各量一次、每次量 2 遍。
 * 找最近一段連續 7 天都符合的（每天早上、晚上的第一次量測都有 ≥ 2 筆），算平均；沒有回傳 null
 */
export function compute722(list: BloodPressure[], p: BpPeriods): Bp722 | null {
  const sessions = firstSessions(list, p);
  const ok = (day: string) => {
    const s = sessions.get(day);
    return !!s && (s.morning?.length ?? 0) >= 2 && (s.evening?.length ?? 0) >= 2;
  };
  const days = [...sessions.keys()].filter(ok).sort().reverse();
  for (const last of days) {
    const run = Array.from({ length: 7 }, (_, i) => addDays(last, i - 6));
    if (!run.every(ok)) continue;
    const mor = run.flatMap((d) => sessions.get(d)!.morning!);
    const eve = run.flatMap((d) => sessions.get(d)!.evening!);
    const all = averageBp([...mor, ...eve])!;
    return { days: run, morning: averageBp(mor)!, evening: averageBp(eve)!, all, judge: judgeBp(all.sys, all.dia) };
  }
  return null;
}

/** 最近 N 天（含今天）的一般平均 */
export function recentBpAverage(list: BloodPressure[], days: number, now = Date.now()): BpAverage | null {
  const from = addDays(toDateKey(now), -(days - 1));
  return averageBp(list.filter((x) => x.date >= from && x.time <= now));
}
