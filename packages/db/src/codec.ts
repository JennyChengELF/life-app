/** 試算表儲存格 ↔ APP 數值的轉換 */
import type { ColType } from './schema';
import { parseDateText, parseDateTimeText, serialToMs, toDateKey, toSheetDateTime } from './time';

/** APP 內的值：datetime 是毫秒、date 是 'YYYY-MM-DD'、空白是 null */
export type CellValue = string | number | boolean | null;

export type Decoded = { ok: true; value: CellValue } | { ok: false; raw: unknown };

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** 讀取：儲存格原始值（UNFORMATTED_VALUE + SERIAL_NUMBER）→ APP 值 */
export function decodeCell(type: ColType, raw: unknown): Decoded {
  if (isEmpty(raw)) return { ok: true, value: null };
  switch (type) {
    case 'datetime': {
      // 序號 < 1 代表只有時間、沒有日期 → 不接受
      if (typeof raw === 'number') return raw >= 1 ? { ok: true, value: serialToMs(raw) } : { ok: false, raw };
      if (typeof raw === 'string') {
        const ms = parseDateTimeText(raw);
        return ms == null ? { ok: false, raw } : { ok: true, value: ms };
      }
      return { ok: false, raw };
    }
    case 'date': {
      if (typeof raw === 'number') return raw >= 1 ? { ok: true, value: toDateKey(serialToMs(raw)) } : { ok: false, raw };
      if (typeof raw === 'string') {
        const d = parseDateText(raw);
        return d == null ? { ok: false, raw } : { ok: true, value: d };
      }
      return { ok: false, raw };
    }
    case 'number': {
      if (typeof raw === 'number') return { ok: true, value: raw };
      if (typeof raw === 'string') {
        const n = Number(raw.replace(/,/g, '').replace(/\s*(ml|kg)$/i, '').trim());
        return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, raw };
      }
      return { ok: false, raw };
    }
    case 'bool': {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      if (typeof raw === 'string' && /^(true|false)$/i.test(raw.trim())) return { ok: true, value: /^true$/i.test(raw.trim()) };
      return { ok: false, raw };
    }
    case 'text':
      return { ok: true, value: String(raw) };
    case 'any':
      return { ok: true, value: raw as CellValue };
  }
}

/** 寫入（valueInputOption=USER_ENTERED）：APP 值 → 送給試算表的值 */
export function encodeCell(type: ColType, value: CellValue): string | number | boolean {
  if (value === null || value === undefined) return '';
  switch (type) {
    case 'datetime':
      return toSheetDateTime(Number(value));
    case 'date':
    case 'text':
      // 開頭加 ' 強制當文字，避免被試算表當成公式或日期
      return `'${String(value)}`;
    case 'number':
      return Number(value);
    case 'bool':
      return Boolean(value);
    case 'any':
      return typeof value === 'string' ? `'${value}` : value;
  }
}
