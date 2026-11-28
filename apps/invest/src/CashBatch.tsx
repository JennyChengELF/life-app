import { useState } from 'react';
import { canGenerateCash, INVEST_KINDS, investDate, prepareInvestmentCashBatch, type InvestSnapshot, type MoneySnapshot } from '@life/db';
import { format } from './Editor';

export function CashBatch({ snap, money, busy, onLoadMoney, onConfirm, onEdit }: {
  snap: InvestSnapshot; money: MoneySnapshot | null; busy: boolean;
  onLoadMoney: () => void; onConfirm: (ids: string[], date: string, account: string) => void;
  onEdit: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [dateOverride, setDateOverride] = useState<string>();
  const [accountOverride, setAccountOverride] = useState<string>();
  const candidates = snap.events.filter((row) => !row.moneyId && !row.pending && !row.removePending && canGenerateCash(row));
  const rows = candidates.filter((row) => selected.includes(row.id));
  const date = dateOverride ?? rows.find((row) => row.cashDate)?.cashDate ?? '';
  const accountName = accountOverride ?? rows.find((row) => row.cashAccount)?.cashAccount ?? '';
  const accounts = money?.accounts.filter((account) => !account.archived) ?? [];
  const account = accounts.find((item) => item.name === accountName);
  let preview: ReturnType<typeof prepareInvestmentCashBatch>['input'] | undefined;
  let problem = '';
  if (rows.length) {
    try {
      preview = prepareInvestmentCashBatch(rows, snap.assets, date, accountName, account?.currency ?? '').input;
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
  }

  return <section className="card">
    <h2>產生記帳</h2>
    <p className="hint">勾選同一次銀行扣款的投資，或選一筆實際入帳。已手動記過的交易請使用「連到既有記帳」。</p>
    {candidates.length ? <ul className="invest-list invest-cash-list">
      {candidates.map((row) => {
        const asset = snap.assets.find((item) => item.id === row.asset);
        const amount = row.kind === 'switch' ? row.externalFee : row.cashAmount;
        const checked = selected.includes(row.id);
        return <li key={row.id}>
          <label>
            <input type="checkbox" checked={checked} disabled={busy} onChange={() => setSelected((current) =>
              checked ? current.filter((id) => id !== row.id) : [...current, row.id])} />
            <span><strong>{asset?.symbol} {asset?.name} · {INVEST_KINDS[row.kind]}</strong>
              <small>{row.cashDate || `${investDate(row)} · 扣款／入帳日未填`} · {row.cashAccount || '帳戶未填'}
                {amount != null && ` · ${row.cashCurrency} ${format(amount)}`}</small>
            </span>
          </label>
          <button className="link" type="button" disabled={busy} onClick={() => onEdit(row.id)}>編輯</button>
        </li>;
      })}
    </ul> : <p className="hint">目前沒有待產生記帳的投資紀錄。</p>}
    {rows.length > 0 && <>
      <div className="invest-grid">
        <label className="field">扣款／入帳日<input type="date" value={date} disabled={busy}
          onChange={(e) => setDateOverride(e.currentTarget.value)} /></label>
        <label className="field">記帳帳戶<select value={account?.name ?? ''} disabled={busy || !money}
          onChange={(e) => setAccountOverride(e.currentTarget.value)}>
          <option value="">選擇帳戶</option>
          {accounts.map((item) => <option key={item.id} value={item.name}>{item.name}（{item.currency}）</option>)}
        </select></label>
      </div>
      {problem && <p role="status" className="msg warn">{problem}</p>}
      {preview && <section aria-label="記帳預覽">
        <h3>記帳預覽</h3>
        <p><strong>{preview.direction === '入' ? '收入' : '支出'} {account?.currency} {format(preview.amount)}</strong> · {date} · {accountName}</p>
        <p>{preview.note}</p>
        <ul className="invest-cash-lines">{preview.lines.map((line, i) => <li key={i}>
          <span>{line.note}<small>{line.category?.replaceAll(' / ', '／')}</small></span>
          <strong>{format(line.amount)}</strong>
        </li>)}</ul>
      </section>}
      <div className="invest-actions">
        <button className="btn primary" type="button" disabled={busy || !preview}
          onClick={() => onConfirm(rows.map((row) => row.id), date, accountName)}>確認產生一筆記帳</button>
        {!money && <button className="btn" type="button" onClick={onLoadMoney} disabled={busy}>重試讀取帳戶</button>}
      </div>
    </>}
  </section>;
}
