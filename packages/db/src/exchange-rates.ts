import { addDays } from './time';

export interface ReferenceRate {
  date: string;
  rate: number;
}

export async function fetchReferenceRate(currency: string, date: string, signal: AbortSignal): Promise<ReferenceRate | null> {
  const from = addDays(date, -14);
  const query = new URLSearchParams({ base: currency, quotes: 'TWD', from, to: date });
  const request = new AbortController();
  const abort = () => request.abort();
  const timeout = setTimeout(abort, 8000);
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  let rows: unknown;
  try {
    const response = await fetch(`https://api.frankfurter.dev/v2/rates?${query}`, {
      credentials: 'omit',
      signal: request.signal,
    });
    if (response.status === 404 || response.status === 422) return null;
    if (!response.ok) throw new Error('匯率查詢失敗');
    rows = await response.json();
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
  if (!Array.isArray(rows)) throw new Error('匯率回應格式錯誤');

  let latest: ReferenceRate | null = null;
  for (const row of rows) {
    if (row?.base !== currency || row.quote !== 'TWD' || typeof row.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || row.date < from || row.date > date ||
      !Number.isFinite(row.rate) || row.rate <= 0) continue;
    if (!latest || row.date > latest.date) latest = { date: row.date, rate: row.rate };
  }
  return latest;
}

/** 台幣換算沿用交易表的正整數格式，低於半元時留空。 */
export function estimateTwdAmount(originalAmount: number, rate: number): number | null {
  const amount = Math.round(Math.abs(originalAmount) * rate);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}
