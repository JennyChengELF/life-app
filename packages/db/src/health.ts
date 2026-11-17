/**
 * 健康 APP 的資料存取與規則：身體量測、偶爾量測、血壓、血糖、體溫。
 * 資料存在「生活APP-健康」試算表。血壓、血糖、體溫的判斷規則在 vitals.ts。
 */
import type { Backend, RowUpdate, RowValues, TableRow } from './backend';
import { newId } from './ids';
import type { TableName } from './schema';
import { toDateKey } from './time';
import type { BloodGlucose, BloodPressure, BpPeriods, GlucoseTiming, Temperature, TempKind, TempSite } from './vitals';
import {
  BP_RANGE,
  DEFAULT_BP_PERIODS,
  formatRange,
  GLUCOSE_RANGE,
  GLUCOSE_TIMINGS,
  parseRange,
  rangesOverlap,
  TEMP_KINDS,
  TEMP_RANGE,
  TEMP_SITES,
} from './vitals';

// ───────────── 身體量測的項目 ─────────────

export type BodyFieldKey =
  | 'kg'
  | 'bodyFatPct'
  | 'bodyFatKg'
  | 'visceralFatLevel'
  | 'bmi'
  | 'skeletalMusclePct'
  | 'skeletalMuscleKg'
  | 'muscleKg'
  | 'bodyAge'
  | 'bmrKcal';

/** 可以輸入的數值欄位（BMI 輸入的是體重計顯示的 bmiScale） */
export type BodyValueCol =
  | 'kg'
  | 'bodyFatPct'
  | 'bodyFatKg'
  | 'visceralFatLevel'
  | 'bmiScale'
  | 'skeletalMusclePct'
  | 'skeletalMuscleKg'
  | 'muscleKg'
  | 'bodyAge'
  | 'bmrKcal';

export interface BodyFieldDef {
  key: BodyFieldKey;
  /** 存在試算表的欄位 */
  col: BodyValueCol;
  label: string;
  unit: string;
  /** 輸入的小數位數 */
  decimals: number;
  min: number;
  max: number;
}

export const BODY_FIELDS: BodyFieldDef[] = [
  { key: 'kg', col: 'kg', label: '體重', unit: 'kg', decimals: 1, min: 2, max: 400 },
  { key: 'bodyFatPct', col: 'bodyFatPct', label: '體脂肪', unit: '%', decimals: 1, min: 1, max: 80 },
  { key: 'bodyFatKg', col: 'bodyFatKg', label: '體脂肪', unit: 'kg', decimals: 1, min: 0.5, max: 300 },
  { key: 'visceralFatLevel', col: 'visceralFatLevel', label: '內臟脂肪程度', unit: '', decimals: 1, min: 0.5, max: 60 },
  { key: 'bmi', col: 'bmiScale', label: 'BMI', unit: '', decimals: 1, min: 5, max: 90 },
  { key: 'skeletalMusclePct', col: 'skeletalMusclePct', label: '骨骼肌', unit: '%', decimals: 1, min: 1, max: 90 },
  { key: 'skeletalMuscleKg', col: 'skeletalMuscleKg', label: '骨骼肌', unit: 'kg', decimals: 1, min: 0.5, max: 200 },
  { key: 'muscleKg', col: 'muscleKg', label: '肌肉量', unit: 'kg', decimals: 1, min: 0.5, max: 250 },
  { key: 'bodyAge', col: 'bodyAge', label: '身體年齡', unit: '歲', decimals: 0, min: 1, max: 130 },
  { key: 'bmrKcal', col: 'bmrKcal', label: '基礎代謝', unit: 'kcal', decimals: 0, min: 200, max: 6000 },
];

export const bodyField = (key: BodyFieldKey) => BODY_FIELDS.find((f) => f.key === key)!;

/** 預設顯示的項目與順序（2026-11-17 確認；體脂肪、骨骼肌的 % 和 kg 都顯示） */
export const DEFAULT_BODY_FIELDS: BodyFieldKey[] = [
  'kg',
  'bodyFatPct',
  'bodyFatKg',
  'visceralFatLevel',
  'bmi',
  'skeletalMusclePct',
  'skeletalMuscleKg',
  'bodyAge',
  'bmrKcal',
];

/** 預設的偶爾量測項目（第一次使用時建立） */
export const HEIGHT_CODE = 'height';
export const DEFAULT_OCC_ITEMS: { name: string; unit: string; code?: string }[] = [
  { name: '身高', unit: 'cm', code: HEIGHT_CODE },
  { name: '胸圍', unit: 'cm' },
  { name: '上腹圍', unit: 'cm' },
  { name: '下腹圍', unit: 'cm' },
  { name: '腰圍', unit: 'cm' },
  { name: '臀圍', unit: 'cm' },
  { name: '右大腿', unit: 'cm' },
  { name: '左大腿', unit: 'cm' },
  { name: '右小腿', unit: 'cm' },
  { name: '左小腿', unit: 'cm' },
  { name: '右手臂', unit: 'cm' },
  { name: '左手臂', unit: 'cm' },
];

/** 體重計 BMI 和自動算的差這麼多才提醒（避免四捨五入誤差） */
export const BMI_TOLERANCE = 0.2;

/** 體重 × % 和填的 kg 差這麼多（kg）才提醒（四捨五入誤差最多約 0.1 kg） */
export const PCT_KG_TOLERANCE = 0.3;

/** 同一個東西有 % 和 kg 兩個欄位：體重 × % 應該等於 kg */
export const PCT_KG_PAIRS = [
  { key: 'bodyFat', label: '體脂肪', pct: 'bodyFatPct', kg: 'bodyFatKg', ok: 'bodyFatOk' },
  { key: 'skeletalMuscle', label: '骨骼肌', pct: 'skeletalMusclePct', kg: 'skeletalMuscleKg', ok: 'skeletalMuscleOk' },
] as const;
export type PctKgPair = (typeof PCT_KG_PAIRS)[number];
export type OkFlag = 'bmiOk' | PctKgPair['ok'];

// ───────────── 型別 ─────────────

export type BodyValues = Partial<Record<BodyValueCol, number | null>>;

export interface BodyMeasurement extends BodyValues {
  rowNumber: number;
  id: string;
  time: number;
  date: string;
  kg: number;
  note: string | null;
  createdVia: string | null;
  /** 數值對不起來時，使用者確認不用改（體重計 BMI ≠ 自動算；體重 × % ≠ kg） */
  bmiOk: boolean;
  bodyFatOk: boolean;
  skeletalMuscleOk: boolean;
}

export interface OccItem {
  rowNumber: number;
  id: string;
  name: string;
  unit: string;
  sort: number;
  code: string | null;
}

export interface OccMeasurement {
  rowNumber: number;
  id: string;
  time: number;
  date: string;
  item: string;
  value: number;
  note: string | null;
}

export interface HealthSettings {
  /** 顯示哪些項目、順序 */
  bodyFields: BodyFieldKey[];
  /** 血壓 722 的早上 / 晚上時段 */
  bpPeriods: BpPeriods;
  /** 體溫的預設部位 */
  tempSite: Record<TempKind, TempSite>;
}

export const DEFAULT_TEMP_SITE: Record<TempKind, TempSite> = { 一般: '耳溫', 基礎: '口溫' };

export interface HealthIssue {
  table: TableName;
  rowNumber: number;
  id: string | null;
  raw: Record<string, unknown>;
  problems: string[];
}

export interface HealthSnapshot {
  loadedAt: number;
  /** 依時間排序（舊 → 新） */
  body: BodyMeasurement[];
  /** 依排序 */
  items: OccItem[];
  /** 依時間排序（舊 → 新） */
  occ: OccMeasurement[];
  /** 依時間排序（舊 → 新） */
  bp: BloodPressure[];
  glucose: BloodGlucose[];
  temps: Temperature[];
  settings: HealthSettings;
  issues: HealthIssue[];
}

// ───────────── 規則 ─────────────

export const round1 = (n: number) => Math.round(n * 10) / 10;

/** BMI = 體重 kg ÷ 身高 m²，取到小數一位 */
export function computeBmi(kg: number, heightCm: number): number {
  const m = heightCm / 100;
  return round1(kg / (m * m));
}

/**
 * 某個時間點用的身高：那個時間點以前最新的身高；
 * 如果那時還沒量過身高，用最早的一筆（例：先記了體重，後來才補填身高）。
 */
export function heightAt(snap: Pick<HealthSnapshot, 'items' | 'occ'>, time: number): number | null {
  const item = snap.items.find((i) => i.code === HEIGHT_CODE);
  if (!item) return null;
  const hs = snap.occ.filter((o) => o.item === item.name);
  if (!hs.length) return null;
  let best: OccMeasurement | null = null;
  for (const h of hs) if (h.time <= time && (!best || h.time > best.time)) best = h;
  if (!best) best = hs.reduce((a, b) => (b.time < a.time ? b : a));
  return best.value;
}

export interface BmiInfo {
  /** 用身高算的（沒有身高 = null） */
  computed: number | null;
  height: number | null;
  /** 體重計顯示的 */
  scale: number | null;
  /** 兩個都有、差距 ≥ 0.2，而且還沒確認不用改 */
  mismatch: boolean;
}

export function bmiInfo(m: BodyMeasurement, snap: Pick<HealthSnapshot, 'items' | 'occ'>): BmiInfo {
  const height = heightAt(snap, m.time);
  const computed = height ? computeBmi(m.kg, height) : null;
  const scale = m.bmiScale ?? null;
  const differs = computed != null && scale != null && Math.abs(computed - scale) >= BMI_TOLERANCE - 1e-9;
  return { computed, height, scale, mismatch: differs && !m.bmiOk };
}

export interface PctKgInfo {
  pair: PctKgPair;
  pct: number;
  kg: number;
  /** 體重 × % 算出來的 kg */
  kgFromPct: number;
  /** 體重和 kg 反推的 % */
  pctFromKg: number;
}

/** % 和 kg 都有、體重 × % 和 kg 差 ≥ 0.3 kg、而且還沒確認不用改的組 */
export function pctKgMismatches(m: BodyMeasurement): PctKgInfo[] {
  const out: PctKgInfo[] = [];
  for (const pair of PCT_KG_PAIRS) {
    const pct = m[pair.pct];
    const kg = m[pair.kg];
    if (pct == null || kg == null || m[pair.ok]) continue;
    const kgFromPct = Math.round(m.kg * pct * 10) / 1000;
    if (Math.abs(kgFromPct - kg) < PCT_KG_TOLERANCE - 1e-9) continue;
    out.push({ pair, pct, kg, kgFromPct, pctFromKg: Math.round((kg / m.kg) * 1000) / 10 });
  }
  return out;
}

/** 這筆有沒有數值對不起來（畫面提醒用）；回傳有問題的項目 */
export function mismatchFields(m: BodyMeasurement, snap: Pick<HealthSnapshot, 'items' | 'occ'>): BodyFieldKey[] {
  const keys: BodyFieldKey[] = bmiInfo(m, snap).mismatch ? ['bmi'] : [];
  for (const x of pctKgMismatches(m)) keys.push(x.pair.pct, x.pair.kg);
  return keys;
}

/** 畫面上顯示的值：BMI 優先用自動算的，沒有身高才用體重計的 */
export function bodyValue(m: BodyMeasurement, key: BodyFieldKey, snap: Pick<HealthSnapshot, 'items' | 'occ'>): number | null {
  if (key === 'bmi') {
    const b = bmiInfo(m, snap);
    return b.computed ?? b.scale;
  }
  return m[bodyField(key).col] ?? null;
}

/** 設定值 → 項目清單（看不懂的忽略；體重一定要有） */
export function parseBodyFields(text: unknown): BodyFieldKey[] {
  if (typeof text !== 'string' || !text.trim()) return [...DEFAULT_BODY_FIELDS];
  const keys = text
    .split(',')
    .map((s) => s.trim())
    .filter((s, i, a): s is BodyFieldKey => BODY_FIELDS.some((f) => f.key === s) && a.indexOf(s) === i);
  if (!keys.includes('kg')) keys.unshift('kg');
  return keys;
}

// ───────────── 讀取時的整理 ─────────────

const str = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (typeof v === 'number' ? v : null);
const isLive = (r: TableRow) => !r.empty && r.values.deletedAt == null;

function checkBodyRow(r: TableRow): string[] {
  const problems: string[] = [];
  if (r.errors.includes('time')) problems.push('時間格式看不懂（例：2026/11/17 07:30）');
  else if (num(r.values.time) == null) problems.push('沒有填時間');
  const kgDef = bodyField('kg');
  const kg = num(r.values.kg);
  if (r.errors.includes('kg')) problems.push('體重不是數字');
  else if (kg == null) problems.push('沒有填體重');
  else if (kg < kgDef.min || kg > kgDef.max) problems.push('體重的數值不合理');
  for (const f of BODY_FIELDS) {
    if (f.col === 'kg') continue;
    const label = f.key === 'bmi' ? 'BMI' : `${f.label}${f.unit ? ` ${f.unit}` : ''}`;
    if (r.errors.includes(f.col)) problems.push(`${label} 不是數字`);
    else {
      const v = num(r.values[f.col]);
      if (v != null && (v < f.min || v > f.max)) problems.push(`${label} 的數值不合理`);
    }
  }
  return problems;
}

function checkTime(r: TableRow, problems: string[]) {
  if (r.errors.includes('time')) problems.push('時間格式看不懂（例：2026/11/17 07:30）');
  else if (num(r.values.time) == null) problems.push('沒有填時間');
}

function checkNum(r: TableRow, col: string, label: string, [min, max]: readonly [number, number], required: boolean, problems: string[]) {
  const v = num(r.values[col]);
  if (r.errors.includes(col)) problems.push(`${label}不是數字`);
  else if (v == null) {
    if (required) problems.push(`沒有填${label}`);
  } else if (v < min || v > max) problems.push(`${label}的數值不合理`);
}

function checkChoice(r: TableRow, col: string, label: string, choices: readonly string[], required: boolean, problems: string[]) {
  const v = str(r.values[col])?.trim();
  if (!v) {
    if (required) problems.push(`沒有填${label}`);
  } else if (!choices.includes(v)) problems.push(`${label}「${v}」看不懂（請填：${choices.join('、')}）`);
}

function checkBpRow(r: TableRow): string[] {
  const p: string[] = [];
  checkTime(r, p);
  checkNum(r, 'systolic', '收縮壓', BP_RANGE.systolic, true, p);
  checkNum(r, 'diastolic', '舒張壓', BP_RANGE.diastolic, true, p);
  checkNum(r, 'pulse', '脈搏', BP_RANGE.pulse, false, p);
  if (!p.length && Number(r.values.diastolic) >= Number(r.values.systolic)) p.push('舒張壓（低）比收縮壓（高）還高，可能填反了');
  return p;
}

function checkGlucoseRow(r: TableRow): string[] {
  const p: string[] = [];
  checkTime(r, p);
  checkChoice(r, 'timing', '測量時機', GLUCOSE_TIMINGS, true, p);
  checkNum(r, 'mgdl', '血糖', GLUCOSE_RANGE, true, p);
  return p;
}

function checkTempRow(r: TableRow): string[] {
  const p: string[] = [];
  checkTime(r, p);
  checkChoice(r, 'kind', '種類', TEMP_KINDS, true, p);
  checkChoice(r, 'site', '部位', TEMP_SITES, false, p);
  checkNum(r, 'celsius', '體溫', TEMP_RANGE, true, p);
  return p;
}

const baseOf = (r: TableRow) => ({
  rowNumber: r.rowNumber,
  id: String(r.values.id),
  time: Number(r.values.time),
  date: String(r.values.date),
  note: str(r.values.note),
});

/** 補上使用者在試算表直接新增的列（id 等）、修正 date；有問題的列入「需要補齊」 */
function triage(
  table: TableName,
  rows: TableRow[],
  check: (r: TableRow) => string[],
  now: number,
): { valid: TableRow[]; fixes: RowUpdate[]; issues: HealthIssue[] } {
  const valid: TableRow[] = [];
  const fixes: RowUpdate[] = [];
  const issues: HealthIssue[] = [];
  for (const r of rows) {
    if (!isLive(r)) continue;
    const id = str(r.values.id);
    const problems = check(r);
    if (problems.length) {
      issues.push({ table, rowNumber: r.rowNumber, id, raw: r.raw, problems });
      continue;
    }
    const date = toDateKey(Number(r.values.time));
    if (!id) {
      const values: RowValues = { id: newId(now), date, createdVia: str(r.values.createdVia) ?? 'sheet', createdAt: now, updatedAt: now };
      fixes.push({ rowNumber: r.rowNumber, values, expectId: '' });
      valid.push({ ...r, values: { ...r.values, ...values } });
    } else {
      if (r.values.date !== date) fixes.push({ rowNumber: r.rowNumber, values: { date }, expectId: id });
      valid.push({ ...r, values: { ...r.values, date } });
    }
  }
  return { valid, fixes, issues };
}

function toBody(r: TableRow): BodyMeasurement {
  const m: BodyMeasurement = {
    rowNumber: r.rowNumber,
    id: String(r.values.id),
    time: Number(r.values.time),
    date: String(r.values.date),
    kg: Number(r.values.kg),
    note: str(r.values.note),
    createdVia: str(r.values.createdVia),
    bmiOk: r.values.bmiOk === true,
    bodyFatOk: r.values.bodyFatOk === true,
    skeletalMuscleOk: r.values.skeletalMuscleOk === true,
  };
  for (const f of BODY_FIELDS) if (f.col !== 'kg') m[f.col] = num(r.values[f.col]);
  return m;
}

/** 檢查輸入的數值；回傳整理過的值（小數位數依項目） */
export function cleanBodyValues(values: BodyValues): BodyValues {
  const out: BodyValues = {};
  for (const [col, v] of Object.entries(values) as [BodyValueCol, number | null | undefined][]) {
    const f = BODY_FIELDS.find((x) => x.col === col);
    if (!f || v === undefined) continue;
    if (v === null || Number.isNaN(v)) {
      if (col === 'kg') throw new Error('請輸入體重');
      out[col] = null;
      continue;
    }
    if (v < f.min || v > f.max) throw new Error(`${f.label}${f.unit ? `（${f.unit}）` : ''}的數值不合理`);
    const p = 10 ** f.decimals;
    out[col] = Math.round(v * p) / p;
  }
  return out;
}

export const validOccValue = (n: number) => Number.isFinite(n) && n > 0 && n < 100000;

function parseSettings(rows: TableRow[]): HealthSettings {
  const kv = new Map<string, unknown>();
  for (const r of rows) {
    const k = str(r.values.key)?.trim();
    if (k && !kv.has(k)) kv.set(k, r.values.value);
  }
  const defaults = { morning: parseRange(DEFAULT_BP_PERIODS.morning)!, evening: parseRange(DEFAULT_BP_PERIODS.evening)! };
  const morning = parseRange(kv.get('health.bpMorning')) ?? defaults.morning;
  const evening = parseRange(kv.get('health.bpEvening')) ?? defaults.evening;
  const site = (k: TempKind): TempSite => {
    const v = str(kv.get(`health.tempSite.${k}`))?.trim() ?? '';
    return (TEMP_SITES as readonly string[]).includes(v) ? (v as TempSite) : DEFAULT_TEMP_SITE[k];
  };
  return {
    bodyFields: parseBodyFields(kv.get('health.bodyFields')),
    // 試算表裡改成重疊的時段 → 用預設
    bpPeriods: rangesOverlap(morning, evening) ? defaults : { morning, evening },
    tempSite: { 一般: site('一般'), 基礎: site('基礎') },
  };
}

/** 檢查數值範圍；回傳四捨五入後的值 */
function checkRange(v: number, [min, max]: readonly [number, number], label: string, decimals = 0): number {
  if (!Number.isFinite(v)) throw new Error(`請輸入${label}`);
  if (v < min || v > max) throw new Error(`${label}的數值不合理`);
  const p = 10 ** decimals;
  return Math.round(v * p) / p;
}

export interface BpInput {
  systolic: number;
  diastolic: number;
  pulse: number | null;
}
export function cleanBp(v: BpInput): BpInput {
  const out = {
    systolic: checkRange(v.systolic, BP_RANGE.systolic, '收縮壓'),
    diastolic: checkRange(v.diastolic, BP_RANGE.diastolic, '舒張壓'),
    pulse: v.pulse == null ? null : checkRange(v.pulse, BP_RANGE.pulse, '脈搏'),
  };
  if (out.diastolic >= out.systolic) throw new Error('舒張壓（低）比收縮壓（高）還高，請確認是不是填反了');
  return out;
}

export interface GlucoseInput {
  timing: GlucoseTiming;
  mgdl: number;
}
export function cleanGlucose(v: GlucoseInput): GlucoseInput {
  if (!GLUCOSE_TIMINGS.includes(v.timing)) throw new Error('請選測量時機');
  return { timing: v.timing, mgdl: checkRange(v.mgdl, GLUCOSE_RANGE, '血糖') };
}

export interface TempInput {
  kind: TempKind;
  site: TempSite | null;
  celsius: number;
}
export function cleanTemp(v: TempInput): TempInput {
  if (!TEMP_KINDS.includes(v.kind)) throw new Error('請選種類');
  if (v.site != null && !TEMP_SITES.includes(v.site)) throw new Error('部位看不懂');
  // 基礎體溫記到小數第 2 位
  return { kind: v.kind, site: v.site, celsius: checkRange(v.celsius, TEMP_RANGE, '體溫', v.kind === '基礎' ? 2 : 1) };
}

export type VitalTable = 'healthBloodPressure' | 'healthBloodGlucose' | 'healthTemperature';

// ───────────── 資料存取 ─────────────

export class HealthStore {
  /** 讀取會順便寫入（補齊、建立預設資料），一次只跑一個 */
  private loadQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private b: Backend,
    private via = 'health',
  ) {}

  load(now = Date.now()): Promise<HealthSnapshot> {
    const p = this.loadQueue.then(() => this.loadNow(now));
    this.loadQueue = p.catch(() => undefined);
    return p;
  }

  private async loadNow(now: number): Promise<HealthSnapshot> {
    const [bodyRows, itemRows, occRows, setRows, bpRows, gluRows, tempRows] = await Promise.all([
      this.b.read('healthBodyMeasurements'),
      this.b.read('healthOccasionalItems'),
      this.b.read('healthOccasionalMeasurements'),
      this.b.read('healthSettings'),
      this.b.read('healthBloodPressure'),
      this.b.read('healthBloodGlucose'),
      this.b.read('healthTemperature'),
    ]);

    const items = await this.ensureItems(itemRows, now);

    const bt = triage('healthBodyMeasurements', bodyRows, checkBodyRow, now);
    const ot = triage(
      'healthOccasionalMeasurements',
      occRows,
      (r) => {
        const problems: string[] = [];
        if (r.errors.includes('time')) problems.push('時間格式看不懂（例：2026/11/17 07:30）');
        else if (num(r.values.time) == null) problems.push('沒有填時間');
        const item = str(r.values.item)?.trim();
        if (!item) problems.push('沒有填項目');
        else if (!items.some((i) => i.name === item)) problems.push(`項目「${item}」不在項目清單裡（請先在 APP 設定新增，或改成清單裡的名稱）`);
        if (r.errors.includes('value')) problems.push('數值不是數字');
        else if (num(r.values.value) == null) problems.push('沒有填數值');
        else if (!validOccValue(Number(r.values.value))) problems.push('數值不合理');
        return problems;
      },
      now,
    );
    const pt = triage('healthBloodPressure', bpRows, checkBpRow, now);
    const gt = triage('healthBloodGlucose', gluRows, checkGlucoseRow, now);
    const tt = triage('healthTemperature', tempRows, checkTempRow, now);
    if (bt.fixes.length) await this.b.update('healthBodyMeasurements', bt.fixes);
    if (ot.fixes.length) await this.b.update('healthOccasionalMeasurements', ot.fixes);
    if (pt.fixes.length) await this.b.update('healthBloodPressure', pt.fixes);
    if (gt.fixes.length) await this.b.update('healthBloodGlucose', gt.fixes);
    if (tt.fixes.length) await this.b.update('healthTemperature', tt.fixes);
    const byTime = (a: { time: number }, b: { time: number }) => a.time - b.time;
    const bp: BloodPressure[] = pt.valid
      .map((r) => ({ ...baseOf(r), systolic: Number(r.values.systolic), diastolic: Number(r.values.diastolic), pulse: num(r.values.pulse) }))
      .sort(byTime);
    const glucose: BloodGlucose[] = gt.valid
      .map((r) => ({ ...baseOf(r), timing: String(r.values.timing).trim() as GlucoseTiming, mgdl: Number(r.values.mgdl) }))
      .sort(byTime);
    const temps: Temperature[] = tt.valid
      .map((r) => ({
        ...baseOf(r),
        kind: String(r.values.kind).trim() as TempKind,
        site: (str(r.values.site)?.trim() || null) as TempSite | null,
        celsius: Number(r.values.celsius),
      }))
      .sort(byTime);

    const body = bt.valid.map(toBody).sort((a, b) => a.time - b.time);
    const occ: OccMeasurement[] = ot.valid
      .map((r) => ({
        rowNumber: r.rowNumber,
        id: String(r.values.id),
        time: Number(r.values.time),
        date: String(r.values.date),
        item: String(r.values.item).trim(),
        value: Number(r.values.value),
        note: str(r.values.note),
      }))
      .sort((a, b) => a.time - b.time);

    return {
      loadedAt: now,
      body,
      items,
      occ,
      bp,
      glucose,
      temps,
      settings: parseSettings(setRows),
      issues: [...bt.issues, ...ot.issues, ...pt.issues, ...gt.issues, ...tt.issues],
    };
  }

  /** 項目清單；第一次使用（清單是空的）時建立預設項目；同名的只留第一個 */
  private async ensureItems(rows: TableRow[], now: number): Promise<OccItem[]> {
    const all: OccItem[] = rows
      .filter((r) => isLive(r) && r.values.id && str(r.values.name)?.trim())
      .map((r) => ({
        rowNumber: r.rowNumber,
        id: String(r.values.id),
        name: String(r.values.name).trim(),
        unit: str(r.values.unit)?.trim() ?? '',
        sort: num(r.values.sort) ?? 0,
        code: str(r.values.code)?.trim() || null,
      }))
      .sort((a, b) => a.sort - b.sort || a.rowNumber - b.rowNumber);
    const items: OccItem[] = [];
    const dupes: RowUpdate[] = [];
    for (const i of all) {
      if (items.some((x) => x.name === i.name)) dupes.push({ rowNumber: i.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: i.id });
      else items.push(i);
    }
    if (dupes.length) await this.b.update('healthOccasionalItems', dupes);
    if (items.length || rows.some((r) => !r.empty)) return items;
    const seed = DEFAULT_OCC_ITEMS.map((d, i) => ({ name: d.name, unit: d.unit, code: d.code ?? null, sort: i, id: newId(now), createdAt: now, updatedAt: now }));
    const rowNums = await this.b.append('healthOccasionalItems', seed);
    return seed.map((d, i) => ({ rowNumber: rowNums[i], id: d.id, name: d.name, unit: d.unit, sort: d.sort, code: d.code }));
  }

  // ───── 身體量測 ─────

  async addBody(values: BodyValues & { kg: number }, time = Date.now(), note: string | null = null): Promise<string> {
    const clean = cleanBodyValues(values);
    const now = Date.now();
    const id = newId(now);
    await this.b.append('healthBodyMeasurements', [
      { ...clean, time, note: note?.trim() || null, date: toDateKey(time), createdVia: this.via, id, createdAt: now, updatedAt: now },
    ]);
    return id;
  }

/**
   * 修改一筆。m 帶完整的舊資料時，只有數值真的改了才重新比對（清掉「不用改」）；
   * 只帶 rowNumber、id 時，有傳的相關欄位都當作改了。
   */
  async updateBody(
    m: Pick<BodyMeasurement, 'rowNumber' | 'id'> & Partial<BodyMeasurement>,
    patch: BodyValues & { time?: number; note?: string | null } & Partial<Record<OkFlag, boolean>>,
  ) {
    const { time, note, bmiOk, bodyFatOk, skeletalMuscleOk, ...vals } = patch;
    const clean = cleanBodyValues(vals);
    const values: RowValues = { ...clean, updatedAt: Date.now() };
    if (time !== undefined) Object.assign(values, { time, date: toDateKey(time) });
    if (note !== undefined) values.note = note?.trim() || null;
    const changed = (col: BodyValueCol) => col in clean && (!(col in m) || (m[col] ?? null) !== (clean[col] ?? null));
    const flags: [OkFlag, boolean | undefined, BodyValueCol[]][] = [
      ['bmiOk', bmiOk, ['kg', 'bmiScale']],
      ...PCT_KG_PAIRS.map((p): [OkFlag, boolean | undefined, BodyValueCol[]] => [p.ok, p.ok === 'bodyFatOk' ? bodyFatOk : skeletalMuscleOk, ['kg', p.pct, p.kg]]),
    ];
    for (const [flag, given, cols] of flags) {
      if (given !== undefined) values[flag] = given;
      // 相關數值改了 → 重新比對
      else if (cols.some(changed)) values[flag] = null;
    }
    await this.b.update('healthBodyMeasurements', [{ rowNumber: m.rowNumber, values, expectId: m.id }]);
  }

  async deleteBody(m: Pick<BodyMeasurement, 'rowNumber' | 'id'>) {
    const now = Date.now();
    await this.b.update('healthBodyMeasurements', [{ rowNumber: m.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: m.id }]);
  }

  // ───── 血壓、血糖、體溫 ─────

  async addBp(v: BpInput, time = Date.now(), note: string | null = null) {
    return this.addVital('healthBloodPressure', { ...cleanBp(v) }, time, note);
  }
  async updateBp(r: Pick<BloodPressure, 'rowNumber' | 'id'>, v: BpInput, time: number, note: string | null) {
    return this.updateVital('healthBloodPressure', r, { ...cleanBp(v) }, time, note);
  }
  async addGlucose(v: GlucoseInput, time = Date.now(), note: string | null = null) {
    return this.addVital('healthBloodGlucose', { ...cleanGlucose(v) }, time, note);
  }
  async updateGlucose(r: Pick<BloodGlucose, 'rowNumber' | 'id'>, v: GlucoseInput, time: number, note: string | null) {
    return this.updateVital('healthBloodGlucose', r, { ...cleanGlucose(v) }, time, note);
  }
  async addTemp(v: TempInput, time = Date.now(), note: string | null = null) {
    return this.addVital('healthTemperature', { ...cleanTemp(v) }, time, note);
  }
  async updateTemp(r: Pick<Temperature, 'rowNumber' | 'id'>, v: TempInput, time: number, note: string | null) {
    return this.updateVital('healthTemperature', r, { ...cleanTemp(v) }, time, note);
  }

  async deleteVital(table: VitalTable, r: { rowNumber: number; id: string }) {
    const now = Date.now();
    await this.b.update(table, [{ rowNumber: r.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: r.id }]);
  }

  private async addVital(table: VitalTable, values: RowValues, time: number, note: string | null) {
    if (time > Date.now() + 5 * 60000) throw new Error('時間不能是未來');
    const now = Date.now();
    const id = newId(now);
    await this.b.append(table, [{ ...values, time, note: note?.trim() || null, date: toDateKey(time), createdVia: this.via, id, createdAt: now, updatedAt: now }]);
    return id;
  }

  private async updateVital(table: VitalTable, r: { rowNumber: number; id: string }, values: RowValues, time: number, note: string | null) {
    if (time > Date.now() + 5 * 60000) throw new Error('時間不能是未來');
    const v: RowValues = { ...values, time, date: toDateKey(time), note: note?.trim() || null, updatedAt: Date.now() };
    await this.b.update(table, [{ rowNumber: r.rowNumber, values: v, expectId: r.id }]);
  }

  // ───── 偶爾量測 ─────

  /** 一次記多個項目（同一個時間） */
  async addOcc(entries: { item: string; value: number }[], time = Date.now(), note: string | null = null) {
    if (!entries.length) throw new Error('請至少填一個項目');
    for (const e of entries) if (!validOccValue(e.value)) throw new Error(`${e.item} 的數值不合理`);
    const now = Date.now();
    await this.b.append(
      'healthOccasionalMeasurements',
      entries.map((e) => ({
        time,
        item: e.item,
        value: e.value,
        note: note?.trim() || null,
        date: toDateKey(time),
        createdVia: this.via,
        id: newId(now),
        createdAt: now,
        updatedAt: now,
      })),
    );
  }

  async updateOcc(o: Pick<OccMeasurement, 'rowNumber' | 'id'>, patch: { time?: number; value?: number; note?: string | null }) {
    if (patch.value !== undefined && !validOccValue(patch.value)) throw new Error('數值不合理');
    const values: RowValues = { updatedAt: Date.now() };
    if (patch.value !== undefined) values.value = patch.value;
    if (patch.time !== undefined) Object.assign(values, { time: patch.time, date: toDateKey(patch.time) });
    if (patch.note !== undefined) values.note = patch.note?.trim() || null;
    await this.b.update('healthOccasionalMeasurements', [{ rowNumber: o.rowNumber, values, expectId: o.id }]);
  }

  async deleteOcc(o: Pick<OccMeasurement, 'rowNumber' | 'id'>) {
    const now = Date.now();
    await this.b.update('healthOccasionalMeasurements', [{ rowNumber: o.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: o.id }]);
  }

  // ───── 偶爾量測的項目清單 ─────

  async addItem(name: string, unit: string, existing: OccItem[]) {
    const n = name.trim();
    if (!n) throw new Error('請輸入項目名稱');
    if (existing.some((i) => i.name === n)) throw new Error('已經有這個項目了');
    const now = Date.now();
    const sort = Math.max(-1, ...existing.map((i) => i.sort)) + 1;
    await this.b.append('healthOccasionalItems', [{ name: n, unit: unit.trim(), sort, id: newId(now), createdAt: now, updatedAt: now }]);
  }

  /** 改名稱 / 單位；改名時紀錄裡用舊名稱的也一起改 */
  async updateItem(item: OccItem, patch: { name?: string; unit?: string }, existing: OccItem[]) {
    const now = Date.now();
    const values: RowValues = { updatedAt: now };
    let rename: string | null = null;
    if (patch.name !== undefined) {
      const n = patch.name.trim();
      if (!n) throw new Error('請輸入項目名稱');
      if (existing.some((i) => i.id !== item.id && i.name === n)) throw new Error('已經有這個項目了');
      if (n !== item.name) rename = values.name = n;
    }
    if (patch.unit !== undefined) values.unit = patch.unit.trim();
    await this.b.update('healthOccasionalItems', [{ rowNumber: item.rowNumber, values, expectId: item.id }]);
    if (rename) {
      const rows = await this.b.read('healthOccasionalMeasurements');
      const updates: RowUpdate[] = rows
        .filter((r) => str(r.values.item)?.trim() === item.name && r.values.id)
        .map((r) => ({ rowNumber: r.rowNumber, values: { item: rename, updatedAt: now }, expectId: String(r.values.id) }));
      if (updates.length) await this.b.update('healthOccasionalMeasurements', updates);
    }
  }

  /** 刪除只是不出現在選單；已記的紀錄保留 */
  async deleteItem(item: OccItem, occ: OccMeasurement[]) {
    if (item.code === HEIGHT_CODE) throw new Error('身高用來算 BMI，不能刪除');
    if (occ.some((o) => o.item === item.name)) throw new Error(`「${item.name}」已經有紀錄，不能刪除（請先刪除紀錄）`);
    const now = Date.now();
    await this.b.update('healthOccasionalItems', [{ rowNumber: item.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: item.id }]);
  }

  /** 依新的順序重新編排序號 */
  async reorderItems(ordered: OccItem[]) {
    const now = Date.now();
    const updates: RowUpdate[] = ordered
      .map((i, idx) => ({ i, idx }))
      .filter(({ i, idx }) => i.sort !== idx)
      .map(({ i, idx }) => ({ rowNumber: i.rowNumber, values: { sort: idx, updatedAt: now }, expectId: i.id }));
    if (updates.length) await this.b.update('healthOccasionalItems', updates);
  }

  // ───── 設定 ─────

  async saveBodyFields(keys: BodyFieldKey[]) {
    await this.saveSetting('health.bodyFields', parseBodyFields(keys.join(',')).join(','));
  }

  /** 血壓 722 的時段（不能重疊） */
  async saveBpPeriods(p: BpPeriods) {
    if (rangesOverlap(p.morning, p.evening)) throw new Error('早上和晚上的時段重疊了');
    await this.saveSetting('health.bpMorning', formatRange(p.morning));
    await this.saveSetting('health.bpEvening', formatRange(p.evening));
  }

  async saveTempSite(kind: TempKind, site: TempSite) {
    await this.saveSetting(`health.tempSite.${kind}`, site);
  }

  private async saveSetting(key: string, value: string) {
    const rows = await this.b.read('healthSettings');
    const row = rows.find((r) => str(r.values.key)?.trim() === key);
    if (row) await this.b.update('healthSettings', [{ rowNumber: row.rowNumber, values: { value } }]);
    else await this.b.append('healthSettings', [{ key, value }]);
  }

  // ───── 需要補齊 ─────

  /** 不要這一列（標記為刪除） */
  async discardIssue(issue: HealthIssue) {
    const now = Date.now();
    await this.b.update(issue.table, [{ rowNumber: issue.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: issue.id ?? '' }]);
  }
}
