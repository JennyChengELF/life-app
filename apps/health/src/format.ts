import type { BodyFieldKey } from '@life/db';
import { BODY_FIELDS, bodyField, toDateKey, toHHmm } from '@life/db';

/** 依項目的小數位數顯示 */
export function fmt(key: BodyFieldKey, v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toFixed(bodyField(key).decimals);
}

/** 同名有 % 和 kg 兩個的項目（體脂肪、骨骼肌）：名稱要加單位區分 */
export function hasTwin(key: BodyFieldKey): boolean {
  const f = bodyField(key);
  return BODY_FIELDS.some((o) => o.key !== key && o.label === f.label);
}

/** 項目名稱 */
export function fieldLabel(key: BodyFieldKey): string {
  const f = bodyField(key);
  return hasTwin(key) ? `${f.label} ${f.unit}` : f.label;
}

export function fmtDateTime(ms: number): string {
  const d = toDateKey(ms);
  return `${d.slice(0, 4) === String(new Date().getFullYear()) ? d.slice(5).replace('-', '/') : d.replace(/-/g, '/')} ${toHHmm(ms)}`;
}

/** 把輸入框文字轉成數字（空白 = null） */
export function parseNum(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
