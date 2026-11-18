import type { MoneySnapshot, Txn } from '@life/db';
import { emptyForm, fmtMoney, monthStats, toHHmm, txnCurrency, txnMyNet, txnTitle } from '@life/db';
import type { Editing } from '../App';
import { MonthNav } from './common';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
function dayLabel(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return `${m}/${d}（${WEEK[new Date(y, m - 1, d).getDay()]}）`;
}

/** 列表右邊的金額：支出紅、收入綠；轉帳、借還款只顯示金額 */
function TxAmount({ t, snap }: { t: Txn; snap: MoneySnapshot }) {
  const cur = txnCurrency(t, snap.accounts);
  const { expense, income } = txnMyNet(t);
  const total = t.amount ?? 0;
  if (expense || income) {
    const net = income - expense;
    const paid = t.direction === '出' && total !== expense ? `付 ${fmtMoney(total, cur)}` : null;
    return (
      <div className={`tx-amt ${net < 0 ? 'amt-out' : 'amt-in'}`}>
        {net < 0 ? '−' : '+'}
        {fmtMoney(Math.abs(net), cur)}
        {paid && <small>{paid}</small>}
      </div>
    );
  }
  return <div className="tx-amt">{fmtMoney(total, cur)}</div>;
}

function subText(t: Txn) {
  const parts: string[] = [];
  if (t.direction === '轉帳') parts.push(`${t.account} → ${t.toAccount}`);
  else if (t.account) parts.push(t.account);
  if (t.paidBy) parts.push(`${t.paidBy} 先付`);
  const shared = t.lines.filter((l) => l.kind === '他欠我' && l.debtType !== '借款').map((l) => l.person);
  if (shared.length) parts.push(`和 ${shared.join('、')} 分帳`);
  if (t.store) parts.push(t.store);
  if (t.note) parts.push(t.note);
  if (t.tags.length) parts.push(t.tags.map((x) => `#${x}`).join(' '));
  return parts.join('・');
}

export function LedgerView({
  snap,
  month,
  setMonth,
  onEdit,
  editing,
}: {
  snap: MoneySnapshot;
  month: string;
  setMonth: (m: string) => void;
  onEdit: (e: Editing) => void;
  editing: boolean;
}) {
  const txns = snap.txns.filter((t) => t.date.startsWith(month));
  const days = [...new Set(txns.map((t) => t.date))];
  const stats = monthStats(snap.txns, snap.categories, snap.accounts, month);
  const twd = stats.find((s) => s.currency === 'TWD');

  return (
    <>
      {!editing && (
        <div className="add-bar">
          <button className="primary big" onClick={() => onEdit({ form: emptyForm('支出') })}>
            ＋ 記一筆支出
          </button>
          <button onClick={() => onEdit({ form: emptyForm('收入') })}>收入</button>
          <button onClick={() => onEdit({ form: emptyForm('轉帳') })}>轉帳</button>
        </div>
      )}
      {!snap.accounts.length && <p className="hint warn">還沒有帳戶：請先到「⚙️ 設定」新增帳戶（例：台幣現金、信用卡）。</p>}

      <section className="card">
        <MonthNav month={month} setMonth={setMonth} />
        <div className="sum-row">
          <div>
            <div className="sum-label">支出</div>
            <div className="sum-value amt-out">{fmtMoney(twd?.expense ?? 0)}</div>
          </div>
          <div>
            <div className="sum-label">收入</div>
            <div className="sum-value amt-in">{fmtMoney(twd?.income ?? 0)}</div>
          </div>
        </div>
        {stats
          .filter((s) => s.currency !== 'TWD')
          .map((s) => (
            <p key={s.currency} className="hint">
              另有 {s.currency}：支出 {fmtMoney(s.expense, s.currency)}、收入 {fmtMoney(s.income, s.currency)}（還沒換算）
            </p>
          ))}

        {txns.length === 0 ? (
          <p className="muted center-text">這個月還沒有紀錄</p>
        ) : (
          days.map((d) => {
            const list = txns.filter((t) => t.date === d);
            const out = list.reduce((a, t) => (txnCurrency(t, snap.accounts) === 'TWD' ? a + txnMyNet(t).expense : a), 0);
            return (
              <div key={d}>
                <div className="day-head">
                  <span>{dayLabel(d)}</span>
                  {out > 0 && <span>支出 {fmtMoney(out)}</span>}
                </div>
                <ul className="tx-list">
                  {list.map((t) => (
                    <li key={t.id} className="tx-row" onClick={() => onEdit({ form: emptyForm(), txn: t })}>
                      <span className="muted small num">{toHHmm(t.time)}</span>
                      <div className="tx-main">
                        <div className="tx-title">{txnTitle(t)}</div>
                        <div className="tx-sub">{subText(t)}</div>
                      </div>
                      <TxAmount t={t} snap={snap} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </section>
    </>
  );
}
