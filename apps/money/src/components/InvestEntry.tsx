import { useEffect, useState } from 'react';
import { impliedInvestPrice, INVEST_KINDS, investmentMemo, investOriginal, type Txn } from '@life/db';
import type { MoneyApi } from '../useMoney';

export function investUrl(values: Record<string, string>) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('investEditor', '1');
  if (new URLSearchParams(location.search).has('local')) url.searchParams.set('local', '');
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  return url.href;
}

export function InvestEntry({ txn, api }: { txn: Txn; api: MoneyApi }) {
  const [detail, setDetail] = useState<Awaited<ReturnType<MoneyApi['investmentDetail']>> | null>(null);
  const [error, setError] = useState('');
  const investmentId = txn.investmentId;
  const { investmentDetail } = api;
  useEffect(() => {
    if (!investmentId) return;
    let live = true;
    void investmentDetail(txn.id).then((result) => {
      if (!live) return;
      if (result.length) setDetail(result);
      else setError('找不到連結的投資紀錄。');
    }).catch(() => { if (live) setError('無法讀取投資明細，可重開這筆交易再試。'); });
    return () => { live = false; };
  }, [txn.id, investmentId, investmentDetail]);

  if (!investmentId) {
    if (txn.direction !== '出' && txn.direction !== '入') return null;
    if (!txn.lines.some((line) => line.category?.startsWith('投資'))) return null;
    return <section className="card"><a className="link" href={investUrl({ moneyTxn: txn.id, date: txn.date })}>補填或連結投資明細</a></section>;
  }
  return <section className="card">
    <h2>投資明細{detail && detail.length > 1 ? `（${detail.length} 筆）` : ''}</h2>
    {!detail && <p className="hint">{error || '讀取投資明細中…'}</p>}
    <ul className="invest-money-links">{detail?.map(({ event, asset }) => {
      const estimate = asset ? impliedInvestPrice(event, asset) : null;
      const original = investOriginal(event);
      return <li key={event.id}>
        <strong>{INVEST_KINDS[event.kind]}{asset && ` · ${asset.symbol} ${asset.name}`}</strong>
        {asset && <p>{event.tradeDate || '成交日待補'} · {event.quantity ?? '待補'} {asset.kind === 'stock' ? '股' : '單位'}
          {event.price != null && ` · ${asset.kind === 'stock' ? '成交價' : '淨值'} ${event.price} ${asset.currency}`}
          {estimate != null && ` · ${asset.kind === 'fund' && event.kind === 'buy' ? '推算淨值' : '推算單價'} ${estimate} ${asset.currency}`}
          {event.fx != null && ` · ${event.fxSource === 'reference' ? '參考匯率' : event.fxSource === 'inferred' ? '推算匯率' : '匯率'} ${event.fx}`}
          {original != null && ` · 原幣金額 ${original} ${asset.currency}`}</p>}
        {asset && event.moneyMode === 'generated' && <p className="hint">自動摘要 · {investmentMemo(event, asset)}</p>}
        <a className="link" href={investUrl({ fromMoney: '1', event: event.id, date: txn.date })}>修改投資交易</a>
      </li>;
    })}</ul>
    {txn.direction === '出' && !txn.investmentGenerated &&
      <a className="link" href={investUrl({ moneyTxn: txn.id, date: txn.date })}>補填或連結其他投資明細</a>}
  </section>;
}
