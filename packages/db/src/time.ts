/** 日期時間工具：一律以使用者本地時區判斷「哪一天」。 */

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** 毫秒時間戳 → 本地日期 'YYYY-MM-DD' */
export function toDateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey(now = Date.now()): string {
  return toDateKey(now);
}

/** 'YYYY-MM-DD' → 當天 00:00 的毫秒 */
export function startOfDay(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** 'YYYY-MM-DD' → 當天最後一毫秒 */
export function endOfDay(dateKey: string): number {
  return startOfDay(addDays(dateKey, 1)) - 1;
}

export function addDays(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return toDateKey(new Date(y, m - 1, d + n).getTime());
}

/** 毫秒 → 'YYYY-MM-DD HH:mm:ss'（寫進試算表用，試算表會辨識成日期時間） */
export function toSheetDateTime(ms: number): string {
  const d = new Date(ms);
  return `${toDateKey(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 毫秒 → 'HH:mm' */
export function toHHmm(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 毫秒 → <input type="datetime-local"> 用的 'YYYY-MM-DDTHH:mm' */
export function toInputDateTime(ms: number): string {
  const d = new Date(ms);
  return `${toDateKey(ms)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Google 試算表的日期序號（1899-12-30 起算的天數，小數是時間）→ 本地時間毫秒。
 * 序號代表試算表時區的「牆上時間」；APP 建立試算表時用使用者的時區，所以直接當本地時間解讀。
 */
export function serialToMs(serial: number): number {
  const asUtc = new Date(Math.round((serial - 25569) * 86400000));
  return new Date(
    asUtc.getUTCFullYear(),
    asUtc.getUTCMonth(),
    asUtc.getUTCDate(),
    asUtc.getUTCHours(),
    asUtc.getUTCMinutes(),
    asUtc.getUTCSeconds(),
  ).getTime();
}

/** 解析使用者手打的日期時間：2026/11/17 14:30、2026-11-17 14:30:00、2026-11-17T14:30 */
export function parseDateTimeText(text: string): number | null {
  const m = text
    .trim()
    .match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  const date = new Date(+y, +mo - 1, +d, +h, +mi, +s);
  if (date.getMonth() !== +mo - 1 || date.getDate() !== +d || +h > 23 || +mi > 59) return null;
  return date.getTime();
}

/** 解析日期文字 → 'YYYY-MM-DD' */
export function parseDateText(text: string): string | null {
  const ms = parseDateTimeText(text.trim().split(/[ T]/)[0]);
  return ms == null ? null : toDateKey(ms);
}
