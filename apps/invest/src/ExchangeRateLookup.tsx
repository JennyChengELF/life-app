import { useEffect, useRef, useState } from 'react';
import { fetchReferenceRate, type ReferenceRate } from '@life/db';

export function ExchangeRateLookup({ currency, date, onApply }: {
  currency: string; date: string; onApply: (quote: ReferenceRate) => void;
}) {
  const current = useRef<AbortController>();
  const [quote, setQuote] = useState<ReferenceRate | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => () => current.current?.abort(), []);

  async function lookup() {
    const request = new AbortController();
    current.current = request;
    setLoading(true);
    setQuote(null);
    setMessage('');
    try {
      const result = await fetchReferenceRate(currency, date, request.signal);
      if (request.signal.aborted) return;
      setQuote(result);
      if (!result) setMessage('查不到扣款／入帳日或之前的參考匯率，可手動填寫。');
    } catch {
      if (!request.signal.aborted) setMessage('查詢匯率失敗，可重試或手動填寫。');
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }

  return <>
    <button className="btn" type="button" disabled={!date || loading} onClick={() => void lookup()}>
      {loading ? '查詢中…' : '查詢匯率'}
    </button>
    {!date && <p className="hint">請先填扣款／入帳日。</p>}
    {message && <p className="hint" role="status">{message}</p>}
    {quote && <div className="invest-actions">
      <span>參考匯率 {quote.date} · 1 {currency} = NT$ {quote.rate}</span>
      <button className="btn" type="button" onClick={() => { onApply(quote); setQuote(null); }}>套用</button>
    </div>}
  </>;
}
