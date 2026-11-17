/**
 * 健檢 / 檢驗的規則：項目清單、顏色標示（2026-11-17 確認）。
 * 資料存取在 health.ts 的 HealthStore。
 */
import type { Judge } from './vitals';

export const LAB_KINDS = ['健檢', '門診檢驗', '其他'] as const;
export type LabKind = (typeof LAB_KINDS)[number];

/** 糖化血色素：血糖頁會顯示 */
export const HBA1C_CODE = 'hba1c';

export interface LabReport {
  rowNumber: number;
  id: string;
  /** 檢驗日期 */
  date: string;
  kind: LabKind;
  place: string | null;
  note: string | null;
}

export interface LabItem {
  rowNumber: number;
  id: string;
  name: string;
  unit: string;
  type: '數字' | '文字';
  /** 預設正常範圍（報告沒印範圍時用） */
  refLow: number | null;
  refHigh: number | null;
  /** 明顯異常（紅色）：< redLow 或 ≥ redHigh */
  redLow: number | null;
  redHigh: number | null;
  /** 文字項目的選項 */
  options: string[];
  warnOptions: string[];
  badOptions: string[];
  sort: number;
  code: string | null;
}

export interface LabResult {
  rowNumber: number;
  id: string;
  reportId: string;
  item: string;
  value: number | null;
  text: string | null;
  /** 報告上印的範圍 */
  refLow: number | null;
  refHigh: number | null;
  /** 這一項的檢驗日期（跨日的批次）；null = 和報告同一天 */
  date: string | null;
  note: string | null;
}

// ───────────── 預設項目（成人常見；之後可改、可刪） ─────────────

type Seed = Partial<Omit<LabItem, 'rowNumber' | 'id' | 'sort' | 'name'>> & { name: string };
const URINE = { type: '文字' as const, options: ['−', '±', '+', '++', '+++', '++++'], warnOptions: ['±'], badOptions: ['+', '++', '+++', '++++'] };
const POS_NEG = { type: '文字' as const, options: ['陰性', '陽性'], badOptions: ['陽性'] };

export const DEFAULT_LAB_ITEMS: Seed[] = [
  { name: '空腹血糖', unit: 'mg/dL', refLow: 70, refHigh: 99, redHigh: 126 },
  { name: '糖化血色素 HbA1c', unit: '%', refLow: 4, refHigh: 5.6, redHigh: 6.5, code: HBA1C_CODE },
  { name: '總膽固醇', unit: 'mg/dL', refHigh: 199, redHigh: 240 },
  { name: '三酸甘油酯', unit: 'mg/dL', refHigh: 149, redHigh: 200 },
  { name: '高密度膽固醇 HDL', unit: 'mg/dL', refLow: 40 },
  { name: '低密度膽固醇 LDL', unit: 'mg/dL', refHigh: 129, redHigh: 160 },
  { name: 'GOT (AST)', unit: 'U/L', refHigh: 40 },
  { name: 'GPT (ALT)', unit: 'U/L', refHigh: 40 },
  { name: '肌酸酐', unit: 'mg/dL', refLow: 0.6, refHigh: 1.3 },
  { name: 'eGFR', unit: 'mL/min/1.73m²', refLow: 60, redLow: 30 },
  { name: '尿素氮 BUN', unit: 'mg/dL', refLow: 7, refHigh: 20 },
  { name: '尿酸', unit: 'mg/dL', refLow: 3, refHigh: 7 },
  { name: '血紅素', unit: 'g/dL', refLow: 12, refHigh: 16 },
  { name: '白血球', unit: '10³/µL', refLow: 4, refHigh: 10 },
  { name: '紅血球', unit: '10⁶/µL', refLow: 4, refHigh: 5.5 },
  { name: '血小板', unit: '10³/µL', refLow: 150, refHigh: 400 },
  { name: '血球容積比', unit: '%', refLow: 36, refHigh: 48 },
  { name: '甲狀腺刺激素 TSH', unit: 'µIU/mL', refLow: 0.4, refHigh: 4 },
  { name: '甲型胎兒蛋白 AFP', unit: 'ng/mL', refHigh: 20 },
  { name: '癌胚抗原 CEA', unit: 'ng/mL', refHigh: 5 },
  { name: 'B型肝炎表面抗原', unit: '', ...POS_NEG },
  { name: 'C型肝炎抗體', unit: '', ...POS_NEG },
  { name: '尿蛋白', unit: '', ...URINE },
  { name: '尿糖', unit: '', ...URINE },
  { name: '尿潛血', unit: '', ...URINE },
  { name: '尿液酸鹼值', unit: '', refLow: 5, refHigh: 8 },
  { name: '糞便潛血', unit: '', ...POS_NEG },
];

// ───────────── 顏色標示 ─────────────

/** 用哪個範圍判斷：報告上印的優先，沒有才用項目的預設 */
export function rangeOf(r: Pick<LabResult, 'refLow' | 'refHigh'>, item: LabItem | null): { low: number | null; high: number | null; fromReport: boolean } {
  if (r.refLow != null || r.refHigh != null) return { low: r.refLow, high: r.refHigh, fromReport: true };
  return { low: item?.refLow ?? null, high: item?.refHigh ?? null, fromReport: false };
}

/**
 * 數字：範圍內 🟢；超出範圍 🟡 偏高 / 偏低；超過「明顯異常」界線 🔴。
 * 文字：badOptions 🔴 異常、warnOptions 🟡 注意、其他 🟢。沒有範圍可判斷 → null（不標）
 */
export function judgeLab(r: Pick<LabResult, 'value' | 'text' | 'refLow' | 'refHigh'>, item: LabItem | null): Judge | null {
  if (r.text != null && r.value == null) {
    if (!item) return null;
    if (item.badOptions.includes(r.text)) return { level: 'bad', label: '異常' };
    if (item.warnOptions.includes(r.text)) return { level: 'warn', label: '注意' };
    return item.options.includes(r.text) ? { level: 'ok', label: '正常' } : null;
  }
  const v = r.value;
  if (v == null) return null;
  if (item?.redHigh != null && v >= item.redHigh) return { level: 'bad', label: '高' };
  if (item?.redLow != null && v < item.redLow) return { level: 'bad', label: '低' };
  const { low, high } = rangeOf(r, item);
  if (low == null && high == null) return null;
  if (high != null && v > high) return { level: 'warn', label: '偏高' };
  if (low != null && v < low) return { level: 'warn', label: '偏低' };
  return { level: 'ok', label: '正常' };
}

/** 範圍顯示：70–99、< 200、> 40 */
export function rangeText(low: number | null, high: number | null): string {
  if (low != null && high != null) return `${low}–${high}`;
  if (high != null) return `≤ ${high}`;
  if (low != null) return `≥ ${low}`;
  return '';
}

export const splitOptions = (v: unknown): string[] =>
  typeof v === 'string'
    ? v
        .split(/[,，、]/)
        .map((x) => x.trim())
        .filter(Boolean)
    : [];
