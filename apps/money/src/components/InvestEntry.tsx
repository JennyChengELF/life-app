import { useEffect, useState } from 'react';
import { impliedInvestPrice, INVEST_KINDS, investOriginal, type Txn } from '@life/db';
import type { MoneyApi } from '../useMoney';

export function investUrl(values: Record<string, string>) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('investEditor', '1');
  if (new URLSearchParams(location.search).has('local')) url.searchParams.set('local', '');
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  return url.href;
}

export function InvestEntry({ txn, api, close }: { txn: Txn; api: MoneyApi; close: () => void }) {
  const [detail, setDetail] = useState<Awaited<ReturnType<MoneyApi['investmentDetail']>> | null>(null);
  const [error, setError] = useState('');
  const investmentId = txn.investmentId;
  const { investmentDetail } = api;
  useEffect(() => {
    if (!investmentId) return;
    let live = true;
    void investmentDetail(investmentId).then((result) => {
      if (live) setDetail(result);
    }).catch(() => { if (live) setError('無法讀取投資明細，可重開這筆交易再試。'); });
    return () => { live = false; };
  }, [investmentId, investmentDetail]);

  if (!investmentId) {
    if (txn.direction !== '出' && txn.direction !== '入') return null;
    if (!txn.lines.some((line) => line.category?.startsWith('投資'))) return null;
    return <section className="card"><a className="link" href={investUrl({ moneyTxn: txn.id, date: txn.date })}>補填或連結投資明細</a></section>;
  }
  const url = investUrl({ fromMoney: '1', event: investmentId, date: txn.date });
  const event = detail?.event;
  const asset = detail?.asset;
  const estimate = asset && event ? impliedInvestPrice(event, asset) : null;
  return <section className="card">
    <h2>{event ? INVEST_KINDS[event.kind] : '投資明細'}{asset && ` · ${asset.symbol} ${asset.name}`}</h2>
    {txn.note && txn.investmentGenerated && <label className="field">整筆自動備註<input readOnly value={txn.note} /></label>}
    {event && asset ? <p>{event.tradeDate || '成交日待補'} · {event.quantity ?? '待補'} {asset.kind === 'stock' ? '股' : '單位'}
      {event.price != null && ` · ${asset.kind === 'stock' ? '成交價' : '淨值'} ${event.price} ${asset.currency}`}
      {estimate != null && ` · 推算單價 ${estimate}`}{event.fx != null && ` · 匯率 ${event.fx}`}
      {investOriginal(event) != null && ` · 原幣金額 ${investOriginal(event)} ${asset.currency}`}</p> : <p className="hint">{error || '讀取投資明細中…'}</p>}
    {txn.investmentGenerated && <>
      <p>{txn.date} · {txn.account} · {txn.direction === '入' ? '實收' : '實扣'} {txn.amount}</p>
      <ul>{txn.lines.map((line) => <li key={line.id}>{line.category?.replaceAll(' / ', '／')} · {line.amount}{line.note && ` · ${line.note}`}</li>)}</ul>
    </>}
    <a className="link" href={url}>修改投資交易</a>
    {txn.investmentGenerated && <>
      <button type="button" className="btn" onClick={close}>返回</button>
      <button type="button" className="btn danger" disabled={api.busy} onClick={() => {
        if (window.confirm('刪除這筆記帳和對應的投資紀錄？')) {
          void api.run(() => api.deleteLinkedTxn(txn).then(() => true)).then((ok) => { if (ok) close(); });
        }
      }}>刪除</button>
    </>}
  </section>;
}
