import { useState } from 'react';
import type { Account, Deposit, MoneySnapshot } from '@life/db';
import { addDays, addMonthsToDate, estimateInterest, fmtMoney, todayKey } from '@life/db';
import type { MoneyApi } from '../useMoney';
import { AccountSelect, amountText, parseAmount } from './common';

const TERMS = [1, 3, 6, 9, 12, 24, 36];
const md = (d: string) => d.replace(/-/g, '/');

/**
 * 定存單（2026-11-18 確認）：定存帳戶底下列出每一張；到期時「解約回活存」或「續存」。
 */
export function DepositList({ api, snap, acc }: { api: MoneyApi; snap: MoneySnapshot; acc: Account }) {
  const [mode, setMode] = useState<null | 'open' | { dep: Deposit; kind: 'close' | 'renew' }>(null);
  const [showEnded, setShowEnded] = useState(false);
  const list = snap.deposits.filter((d) => d.account === acc.name);
  const active = list.filter((d) => !d.endedDate);
  const ended = list.filter((d) => d.endedDate);
  const today = todayKey();
  const soon = addDays(today, 7);

  return (
    <div className="deposits">
      {active.map((d) => {
        const due = d.maturityDate <= soon;
        return (
          <div key={d.id}>
            <div className={`dep-row ${due ? 'due' : ''}`}>
              <span className="grow">
                定存單 <b className="num">{fmtMoney(d.principal, acc.currency)}</b>
                {d.rate != null && <span className="muted small"> ・{d.rate}%</span>}
                <span className={`small ${due ? '' : 'muted'}`}>
                  {' '}
                  ・到期 {md(d.maturityDate)}
                  {d.maturityDate < today ? '（已到期）' : due ? '（快到期）' : ''}
                </span>
              </span>
              <button onClick={() => setMode({ dep: d, kind: 'close' })}>解約</button>
              <button onClick={() => setMode({ dep: d, kind: 'renew' })}>續存</button>
            </div>
            {mode && mode !== 'open' && mode.dep.id === d.id && (
              <MaturityForm api={api} snap={snap} acc={acc} dep={d} kind={mode.kind} onDone={() => setMode(null)} />
            )}
          </div>
        );
      })}
      {mode === 'open' ? (
        <OpenForm api={api} snap={snap} acc={acc} onDone={() => setMode(null)} />
      ) : (
        <button className="link small" onClick={() => setMode('open')}>
          ＋ 開定存
        </button>
      )}
      {ended.length > 0 && (
        <button className="link small muted" onClick={() => setShowEnded(!showEnded)}>
          已結束 {ended.length} 張 {showEnded ? '▲' : '▼'}
        </button>
      )}
      {showEnded &&
        ended.map((d) => (
          <div className="dep-row ended" key={d.id}>
            <span className="grow small muted">
              {fmtMoney(d.principal, acc.currency)}
              {d.rate != null && ` ・${d.rate}%`} ・{md(d.startDate)} ～ {md(d.maturityDate)}・{md(d.endedDate!)} 結束
            </span>
          </div>
        ))}
    </div>
  );
}

/** 開定存：從活存轉過來 */
function OpenForm({ api, snap, acc, onDone }: { api: MoneyApi; snap: MoneySnapshot; acc: Account; onDone: () => void }) {
  const sameBank = snap.accounts.find((a) => a.org === acc.org && a.currency === acc.currency && a.type === '銀行' && !a.archived);
  const [from, setFrom] = useState<string | null>(sameBank?.name ?? null);
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [start, setStart] = useState(todayKey());
  const [term, setTerm] = useState<number | null>(6);
  const [maturity, setMaturity] = useState(addMonthsToDate(todayKey(), 6));
  const [note, setNote] = useState('');
  const pick = (t: number | null, s = start) => {
    setTerm(t);
    if (t) setMaturity(addMonthsToDate(s, t));
  };
  const save = async () => {
    const p = parseAmount(principal);
    const r = parseAmount(rate);
    if (!from) return api.showToast({ kind: 'error', text: '請選從哪個帳戶轉過來' });
    if (p == null || Number.isNaN(p) || p <= 0) return api.showToast({ kind: 'error', text: '請填本金' });
    if (Number.isNaN(r)) return api.showToast({ kind: 'error', text: '利率請填數字' });
    const ok = await api.run((s) =>
      s.openDeposit({ fromAccount: from, account: acc.name, principal: p, rate: r, startDate: start, maturityDate: maturity, termMonths: term, note: note || null }).then(() => true),
    );
    if (ok) {
      api.showToast({ kind: 'info', text: '已開定存（記了一筆轉帳）' });
      onDone();
    }
  };
  return (
    <div className="subbox">
      <h2>開定存（{acc.name}）</h2>
      <label className="field">
        從哪個帳戶轉過來
        <AccountSelect snap={snap} value={from} onChange={setFrom} />
      </label>
      <div className="row">
        <label className="field" style={{ flex: 2 }}>
          本金（{acc.currency}）
          <input inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          年利率 %
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="1.7" />
        </label>
      </div>
      <div className="row">
        <label className="field" style={{ flex: 1 }}>
          起存日
          <input
            type="date"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              pick(term, e.target.value);
            }}
          />
        </label>
        <label className="field" style={{ flex: 1 }}>
          期間
          <select value={term ?? ''} onChange={(e) => pick(e.target.value ? Number(e.target.value) : null)}>
            {TERMS.map((t) => (
              <option key={t} value={t}>
                {t} 個月
              </option>
            ))}
            <option value="">自己填到期日</option>
          </select>
        </label>
      </div>
      <label className="field">
        到期日
        <input type="date" value={maturity} onChange={(e) => (setMaturity(e.target.value), setTerm(null))} />
      </label>
      <label className="field">
        備註
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="hint">會記一筆「{from ?? '活存'} → {acc.name}」的轉帳（不算收支）。</p>
      <div className="editor-actions">
        <button className="primary" onClick={save} disabled={api.busy}>
          開定存
        </button>
        <button onClick={onDone}>取消</button>
      </div>
    </div>
  );
}

/** 到期處理：解約回活存（本金轉回＋利息收入）或續存（換新到期日） */
function MaturityForm({ api, snap, acc, dep, kind, onDone }: { api: MoneyApi; snap: MoneySnapshot; acc: Account; dep: Deposit; kind: 'close' | 'renew'; onDone: () => void }) {
  const [to, setTo] = useState<string | null>(dep.fromAccount);
  const [interest, setInterest] = useState(amountText(estimateInterest(dep, acc.currency)));
  const [date, setDate] = useState(dep.maturityDate);
  const term = dep.termMonths ?? 6;
  const [maturity, setMaturity] = useState(addMonthsToDate(dep.maturityDate, term));
  const [rate, setRate] = useState(amountText(dep.rate));
  const [interestTo, setInterestTo] = useState<'deposit' | 'account'>('deposit');
  const save = async () => {
    const i = parseAmount(interest) ?? 0;
    if (Number.isNaN(i) || i < 0) return api.showToast({ kind: 'error', text: '利息請填數字' });
    let ok: boolean | undefined;
    if (kind === 'close') {
      if (!to) return api.showToast({ kind: 'error', text: '請選轉回哪個帳戶' });
      ok = await api.run((s) => s.closeDeposit(dep, { toAccount: to, interest: i, date }).then(() => true));
    } else {
      const r = parseAmount(rate);
      if (Number.isNaN(r)) return api.showToast({ kind: 'error', text: '利率請填數字' });
      if (interestTo === 'account' && !to) return api.showToast({ kind: 'error', text: '請選利息存到哪個帳戶' });
      ok = await api.run((s) => s.renewDeposit(dep, { maturityDate: maturity, interest: i, interestTo: interestTo === 'deposit' ? 'deposit' : to!, rate: r }).then(() => true));
    }
    if (ok) {
      api.showToast({ kind: 'info', text: kind === 'close' ? '已解約，本金轉回、利息記成收入' : '已續存' });
      onDone();
    }
  };
  return (
    <div className="subbox">
      <h2>
        {kind === 'close' ? '解約回活存' : '續存'}：{fmtMoney(dep.principal, acc.currency)}（到期 {md(dep.maturityDate)}）
      </h2>
      <label className="field">
        利息（{acc.currency}）
        <input inputMode="decimal" value={interest} onChange={(e) => setInterest(e.target.value)} />
        <span className="hint">照利率估算，請改成實際拿到的</span>
      </label>
      {kind === 'close' ? (
        <>
          <label className="field">
            本金和利息轉回哪個帳戶
            <AccountSelect snap={snap} value={to} onChange={setTo} />
          </label>
          <label className="field">
            解約日
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </>
      ) : (
        <>
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              新的到期日
              <input type="date" value={maturity} onChange={(e) => setMaturity(e.target.value)} />
            </label>
            <label className="field" style={{ flex: 1 }}>
              新的年利率 %
              <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
            </label>
          </div>
          <div className="seg modes">
            <button className={interestTo === 'deposit' ? 'active' : ''} onClick={() => setInterestTo('deposit')}>
              利息一起續存
            </button>
            <button className={interestTo === 'account' ? 'active' : ''} onClick={() => setInterestTo('account')}>
              利息轉到活存
            </button>
          </div>
          {interestTo === 'account' && (
            <label className="field">
              利息存到哪個帳戶
              <AccountSelect snap={snap} value={to} onChange={setTo} />
            </label>
          )}
        </>
      )}
      <div className="editor-actions">
        <button className="primary" onClick={save} disabled={api.busy}>
          確認
        </button>
        <button onClick={onDone}>取消</button>
      </div>
    </div>
  );
}
