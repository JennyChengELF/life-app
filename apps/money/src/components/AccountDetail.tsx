import { useState } from 'react';
import type { Account, MoneySnapshot } from '@life/db';
import {
  accountBalance,
  accountLabel,
  canReconcile,
  cardTxnStatus,
  checkDiff,
  defaultCloseDate,
  emptyForm,
  fmtMoney,
  isStatementPaid,
  statementPaid,
  stmtAmount,
  todayKey,
  toHHmm,
  txnTitle,
} from '@life/db';
import type { MoneyApi } from '../useMoney';
import type { Editing } from '../App';
import { AccountForm } from './SettingsView';
import { DepositList } from './Deposits';
import { CheckForm, defaultCheckDate, DiffText } from './Stocktake';
import { dayLabel, subText } from './LedgerView';
import { MonthNav } from './common';

/**
 * 帳戶明細頁（2026-11-18 確認：點帳戶進來）：餘額、這個帳戶的交易、修改帳戶 / 帳單對帳 / 盤點
 */
export function AccountDetail({
  api,
  snap,
  acc,
  onBack,
  onEdit,
  openReconcile,
}: {
  api: MoneyApi;
  snap: MoneySnapshot;
  acc: Account;
  onBack: () => void;
  onEdit: (e: Editing) => void;
  openReconcile: (closeDate: string) => void;
}) {
  const [panel, setPanel] = useState<'edit' | 'check' | null>(null);
  const [checkDate, setCheckDate] = useState(() => defaultCheckDate(snap));
  const [month, setMonth] = useState(() => todayKey().slice(0, 7));
  const card = acc.type === '信用卡';
  const bal = accountBalance(acc, snap.txns);
  const statements = snap.statements.filter((s) => s.account === acc.name).reverse();
  const checks = snap.balanceChecks.filter((c) => c.account === acc.name).reverse();
  const txns = snap.txns.filter((t) => t.date.startsWith(month) && stmtAmount(t, acc) !== 0);
  const back: Editing['back'] = { tab: 'accounts' };
  const byDay = new Map<string, typeof txns>();
  for (const t of txns) byDay.set(t.date, [...(byDay.get(t.date) ?? []), t]);
  const toggle = (p: 'edit' | 'check') => setPanel(panel === p ? null : p);

  return (
    <>
      <section className="card">
        <div className="page-head">
          <button className="link" onClick={onBack}>
            ‹ 帳戶
          </button>
          <h2>{accountLabel(acc)}</h2>
        </div>
        <p className="muted small">
          {[acc.org, acc.type, acc.currency !== 'TWD' ? acc.currency : null, card && acc.closingDay ? `每月 ${acc.closingDay} 號結帳` : null, card && acc.dueDay ? `${acc.dueDay} 號繳款` : null]
            .filter(Boolean)
            .join('・')}
        </p>
        <div className="big-balance">
          {bal == null ? (
            <span className="muted">沒設期初餘額</span>
          ) : card ? (
            <>
              未繳 <b className="num">{fmtMoney(Math.max(0, -bal), acc.currency)}</b>
              {bal > 0 && <small className="muted">（溢繳 {fmtMoney(bal, acc.currency)}）</small>}
            </>
          ) : (
            <b className={`num ${bal < 0 ? 'amt-out' : ''}`}>{fmtMoney(bal, acc.currency)}</b>
          )}
        </div>
        <div className="add-bar">
          <button className={panel === 'edit' ? 'active' : ''} onClick={() => toggle('edit')}>
            ✏️ 修改帳戶
          </button>
          {canReconcile(acc) && <button onClick={() => openReconcile(statements[0] && !statements[0].doneAt ? statements[0].closeDate : defaultCloseDate(acc, todayKey()))}>🧾 帳單對帳</button>}
          <button className={panel === 'check' ? 'active' : ''} onClick={() => toggle('check')}>
            🧮 盤點
          </button>
        </div>
        {panel === 'edit' && <AccountForm api={api} snap={snap} acc={acc} onDone={() => setPanel(null)} />}
        {panel === 'check' && (
          <div className="subbox">
            <label className="field">
              盤點哪一天的餘額（那天結束時）
              <input type="date" value={checkDate} onChange={(e) => e.target.value && setCheckDate(e.target.value)} />
            </label>
            <CheckForm api={api} snap={snap} acc={acc} date={checkDate} onDone={() => setPanel(null)} />
          </div>
        )}
        {acc.type === '定存' && <DepositList api={api} snap={snap} acc={acc} />}
      </section>

      {checks.length > 0 && (
        <section className="card">
          <h2>盤點紀錄</h2>
          {checks.slice(0, 6).map((c) => {
            const d = checkDiff(acc, c, snap.txns);
            return (
              <div className="check-hist" key={c.id}>
                <span className="num">{c.date.replace(/-/g, '/')}</span>
                <span className="num">實際 {fmtMoney(c.actual, acc.currency)}</span>
                <span className="grow">
                  {d.original != null && d.original !== d.now && (
                    <span className="muted small">
                      原本 <DiffText diff={d.original} currency={acc.currency} /> → 現在{' '}
                    </span>
                  )}
                  <DiffText diff={d.now} currency={acc.currency} />
                </span>
                {d.now != null && d.now !== 0 && (
                  <button
                    onClick={() =>
                      confirm(`找不到原因的差額 ${fmtMoney(Math.abs(d.now!), acc.currency)}，記一筆「調整」讓餘額對得上？`) && api.run((s) => s.adjustBalance(c))
                    }
                  >
                    調整差額
                  </button>
                )}
                <button className="link small danger-text" onClick={() => confirm('刪除這次盤點？') && api.run((s) => s.deleteBalanceCheck(c))}>
                  刪除
                </button>
              </div>
            );
          })}
          <p className="hint">有差額時，先照實際日期補登漏記的，差額會自動重算；找不到原因再按「調整差額」。</p>
        </section>
      )}

      {canReconcile(acc) && statements.length > 0 && (
        <section className="card">
          <h2>帳單</h2>
          {statements.slice(0, 12).map((s) => {
            const n = snap.statementItems.filter((i) => i.account === acc.name && i.closeDate === s.closeDate).length;
            const paid = statementPaid(s, snap.txns);
            return (
              <button className="stmt-row" key={s.id} onClick={() => openReconcile(s.closeDate)}>
                <span className="num">{s.closeDate.replace(/-/g, '/')}</span>
                <span className="grow muted small">
                  {n} 筆{s.doneAt ? '・✓ 對帳完成' : n ? '・還沒完成對帳' : ''}
                </span>
                {card && s.amountDue != null && (
                  <span className={`small ${isStatementPaid(s, snap.txns) ? 'ok-text' : 'warn-text'}`}>
                    {isStatementPaid(s, snap.txns) ? '已繳' : paid > 0 ? `已繳 ${fmtMoney(paid, acc.currency, false)}／` : '未繳 '}
                    {isStatementPaid(s, snap.txns) ? '' : fmtMoney(s.amountDue, acc.currency)}
                  </span>
                )}
              </button>
            );
          })}
        </section>
      )}

      <section className="card">
        <MonthNav month={month} setMonth={setMonth} />
        {txns.length === 0 && <p className="muted">這個月沒有紀錄</p>}
        {[...byDay].map(([date, list]) => (
          <div key={date}>
            <div className="day-head">{dayLabel(date)}</div>
            <ul className="tx-list">
              {list.map((t) => {
                const amt = stmtAmount(t, acc);
                const status = card ? cardTxnStatus(snap, t, acc.name) : null;
                // 帳戶的錢變多 = 綠；信用卡刷卡（欠款變多）= 紅
                const more = card ? amt < 0 : amt > 0;
                return (
                  <li key={t.id} className="tx-row" onClick={() => onEdit({ form: emptyForm(), txn: t, back })}>
                    <span className="muted small num">{t.dateOnly ? '' : toHHmm(t.time)}</span>
                    <div className="tx-main">
                      <div className="tx-title">
                        {txnTitle(t)}
                        {status && <span className={`tag ${status === '已繳' ? 'ok' : status === '未出帳' ? 'dim' : 'warn'}`}>{status}</span>}
                      </div>
                      <div className="tx-sub">{subText(t, snap.sharedTags)}</div>
                    </div>
                    <div className={`tx-amt ${more ? 'amt-in' : 'amt-out'}`}>
                      {more ? '+' : '−'}
                      {fmtMoney(Math.abs(amt), acc.currency)}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </>
  );
}
