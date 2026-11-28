import { useState } from 'react';
import { canGenerateCash, canLinkInvestmentCash, INVEST_KINDS, investCategory, investDate, prepareInvestmentCashBatch,
  type InvestSnapshot, type MoneySnapshot } from '@life/db';
import { format } from './Editor';

export function CashBatch({ snap, money, busy, onLoadMoney, onConfirm, onLink, onEdit }: {
  snap: InvestSnapshot; money: MoneySnapshot | null; busy: boolean;
  onLoadMoney: () => void; onConfirm: (ids: string[], date: string, account: string, categories: Record<string, string>) => void;
  onLink: (ids: string[], date: string, moneyId: string) => void;
  onEdit: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [dateOverride, setDateOverride] = useState<string>();
  const [accountOverride, setAccountOverride] = useState<string>();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [moneyId, setMoneyId] = useState('');
  const [categories, setCategories] = useState<Record<string, string>>({});
  const candidates = snap.events.filter((row) => !row.moneyId && !row.pending && !row.removePending && canGenerateCash(row));
  const rows = candidates.filter((row) => selected.includes(row.id));
  const first = rows[0];
  const date = dateOverride ?? rows.find((row) => row.cashDate)?.cashDate ?? (mode === 'existing' && first ? investDate(first) : '');
  const accountName = accountOverride ?? rows.find((row) => row.cashAccount)?.cashAccount ?? '';
  const accounts = money?.accounts.filter((account) => !account.archived) ?? [];
  const account = accounts.find((item) => item.name === accountName);
  const matching = mode === 'existing' && date
    ? money?.txns.filter((txn) => txn.date === date && canLinkInvestmentCash(rows, txn)) ?? [] : [];
  const existing = matching.find((txn) => txn.id === moneyId);
  let preview: ReturnType<typeof prepareInvestmentCashBatch> | undefined;
  let problem = '';
  if (rows.length && mode === 'new') {
    try {
      preview = prepareInvestmentCashBatch(rows.map((row) => ({ ...row, category: categories[row.id] ?? row.category })),
        snap.assets, date, accountName, account?.currency ?? '');
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
      <div className="invest-actions" role="group" aria-label="記帳方式">
        <button type="button" className={mode === 'new' ? 'btn primary' : 'btn'} aria-pressed={mode === 'new'} disabled={busy}
          onClick={() => setMode('new')}>產生新記帳</button>
        <button type="button" className={mode === 'existing' ? 'btn primary' : 'btn'} aria-pressed={mode === 'existing'} disabled={busy}
          onClick={() => setMode('existing')}>連到既有記帳</button>
      </div>
      <div className="invest-grid">
        <label className="field">{mode === 'existing' ? '記帳日期' : '扣款／入帳日'}<input type="date" value={date} disabled={busy}
          onChange={(e) => { setDateOverride(e.currentTarget.value); setMoneyId(''); }} /></label>
        {mode === 'new' ? <label className="field">記帳帳戶<select value={account?.name ?? ''} disabled={busy || !money}
          onChange={(e) => setAccountOverride(e.currentTarget.value)}>
          <option value="">選擇帳戶</option>
          {accounts.map((item) => <option key={item.id} value={item.name}>{item.name}（{item.currency}）</option>)}
        </select></label> : <label className="field">既有記帳交易
          <select value={existing?.id ?? ''} disabled={busy || !matching.length} onChange={(e) => setMoneyId(e.currentTarget.value)}>
            <option value="">{!date ? '請先選日期' : busy ? '讀取中…' : !money ? '無法讀取記帳資料'
              : matching.length ? '選擇已入帳的紀錄' : '這一天沒有可連結的記帳交易'}</option>
            {matching.map((txn) => <option key={txn.id} value={txn.id}>
              {[txn.account, format(txn.amount), txn.note || txn.lines[0]?.category].filter(Boolean).join(' · ')}
            </option>)}
          </select>
        </label>}
      </div>
      {problem && <p role="status" className="msg warn">{problem}</p>}
      {preview && <section aria-label="記帳預覽">
        <h3>記帳預覽</h3>
        <p><strong>{preview.input.direction === '入' ? '收入' : '支出'} {account?.currency} {format(preview.input.amount)}</strong> · {date} · {accountName}</p>
        <p>{preview.input.note}</p>
        <ul className="invest-cash-lines">{preview.input.lines.map((line, i) => {
          const id = preview.lineEvents[i];
          const row = id ? rows.find((item) => item.id === id) : undefined;
          const asset = row ? snap.assets.find((item) => item.id === row.asset) : undefined;
          const root = row && asset ? investCategory(row, asset) : '';
          const choices = root ? money?.categories.filter((item) => !item.archived && item.kind === line.kind &&
            item.path.startsWith(`${root} / `) && item.path.split(' / ').length === 3) ?? [] : [];
          return <li key={i}>
            <span>{line.note}{id && root ? <select aria-label={`${line.note} 的記帳分類`} value={line.category ?? root} disabled={busy}
              onChange={(e) => {
                const category = e.currentTarget.value;
                setCategories((previous) => ({ ...previous, [id]: category }));
              }}>
              <option value={root}>{root.replaceAll(' / ', '／')}</option>
              {line.category && line.category !== root && !choices.some((item) => item.path === line.category) &&
                <option value={line.category}>{line.category.replaceAll(' / ', '／')}</option>}
              {choices.map((item) => <option value={item.path} key={item.id}>{item.path.replaceAll(' / ', '／')}</option>)}
            </select> : <small>{line.category?.replaceAll(' / ', '／')}</small>}</span>
            <strong>{format(line.amount)}</strong>
          </li>;
        })}</ul>
      </section>}
      <div className="invest-actions">
        {mode === 'new' ? <button className="btn primary" type="button" disabled={busy || !preview}
          onClick={() => onConfirm(rows.map((row) => row.id), date, accountName, categories)}>確認產生一筆記帳</button>
          : <button className="btn primary" type="button" disabled={busy || !existing}
            onClick={() => { if (existing) onLink(rows.map((row) => row.id), date, existing.id); }}>確認連結</button>}
        {!money && <button className="btn" type="button" onClick={onLoadMoney} disabled={busy}>重試讀取帳戶</button>}
      </div>
    </>}
  </section>;
}
