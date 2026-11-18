import type { MoneySnapshot, Txn } from '@life/db';
import { emptyForm, fmtMoney, monthStats, startOfDay, todayKey, toHHmm, txnCurrency, txnMyNet, txnTitle } from '@life/db';
import { DateNav } from '@life/ui/timeline';
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
  if (t.store) parts.push(t.branch ? `${t.store}（${t.branch}）` : t.store);
  if (t.note) parts.push(t.note);
  if (t.tags.length) parts.push(t.tags.map((x) => `#${x}`).join(' '));
  return parts.join('・');
}

function TxList({ list, snap, onEdit }: { list: Txn[]; snap: MoneySnapshot; onEdit: (e: Editing) => void }) {
  return (
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
  );
}

/** 支出 / 收入（新台幣）；外幣另外一行 */
function Sums({ snap, prefix, small }: { snap: MoneySnapshot; prefix: string; small?: string }) {
  const stats = monthStats(snap.txns, snap.categories, snap.accounts, prefix);
  const twd = stats.find((s) => s.currency === 'TWD');
  const foreign = stats.filter((s) => s.currency !== 'TWD');
  if (small) {
    return (
      <p className="hint center-text">
        {small} 支出 {fmtMoney(twd?.expense ?? 0)} ・ 收入 {fmtMoney(twd?.income ?? 0)}
      </p>
    );
  }
  return (
    <>
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
      {foreign.map((s) => (
        <p key={s.currency} className="hint">
          另有 {s.currency}：支出 {fmtMoney(s.expense, s.currency)}、收入 {fmtMoney(s.income, s.currency)}（還沒換算）
        </p>
      ))}
    </>
  );
}

/** 新增時的時間：看的是今天 → 現在；看的是別天 → 那天的現在這個時間 */
function timeFor(date: string) {
  const now = Date.now();
  const today = todayKey();
  return date === today ? now : startOfDay(date) + (now - startOfDay(today));
}

/** 記帳頁（2026-11-18 使用者要求：預設一天一天看，可切換整個月） */
export function LedgerView({
  snap,
  date,
  setDate,
  view,
  setView,
  onEdit,
  editing,
}: {
  snap: MoneySnapshot;
  date: string;
  setDate: (d: string) => void;
  view: 'day' | 'month';
  setView: (v: 'day' | 'month') => void;
  onEdit: (e: Editing) => void;
  editing: boolean;
}) {
  const month = date.slice(0, 7);
  const newEntry = (mode: '支出' | '收入' | '轉帳') => onEdit({ form: emptyForm(mode, view === 'day' ? timeFor(date) : Date.now()) });

  return (
    <>
      {!editing && (
        <div className="add-bar">
          <button className="primary big" onClick={() => newEntry('支出')}>
            ＋ 記一筆支出
          </button>
          <button onClick={() => newEntry('收入')}>收入</button>
          <button onClick={() => newEntry('轉帳')}>轉帳</button>
        </div>
      )}
      {!snap.accounts.length && <p className="hint warn">還沒有帳戶：請先到「⚙️ 設定」新增帳戶（例：台幣現金、信用卡）。</p>}

      <section className="card">
        <div className="ledger-head">
          {view === 'day' ? <DateNav date={date} setDate={setDate} /> : <MonthNav month={month} setMonth={(m) => setDate(`${m}-01`)} />}
          <div className="seg">
            <button className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}>
              日
            </button>
            <button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>
              月
            </button>
          </div>
        </div>

        {view === 'day' ? (
          <>
            <Sums snap={snap} prefix={date} />
            {snap.txns.some((t) => t.date === date) ? (
              <TxList list={snap.txns.filter((t) => t.date === date)} snap={snap} onEdit={onEdit} />
            ) : (
              <p className="muted center-text">這天沒有紀錄</p>
            )}
            <Sums snap={snap} prefix={month} small={`${Number(month.slice(5))} 月`} />
          </>
        ) : (
          <>
            <Sums snap={snap} prefix={month} />
            <MonthList snap={snap} month={month} onEdit={onEdit} onDay={(d) => (setDate(d), setView('day'))} />
          </>
        )}
      </section>
    </>
  );
}

function MonthList({ snap, month, onEdit, onDay }: { snap: MoneySnapshot; month: string; onEdit: (e: Editing) => void; onDay: (d: string) => void }) {
  const txns = snap.txns.filter((t) => t.date.startsWith(month));
  if (!txns.length) return <p className="muted center-text">這個月還沒有紀錄</p>;
  const days = [...new Set(txns.map((t) => t.date))];
  return (
    <>
      {days.map((d) => {
        const list = txns.filter((t) => t.date === d);
        const out = list.reduce((a, t) => (txnCurrency(t, snap.accounts) === 'TWD' ? a + txnMyNet(t).expense : a), 0);
        return (
          <div key={d}>
            <button className="day-head" onClick={() => onDay(d)} title="看這一天">
              <span>{dayLabel(d)}</span>
              {out !== 0 && <span>支出 {fmtMoney(out)}</span>}
            </button>
            <TxList list={list} snap={snap} onEdit={onEdit} />
          </div>
        );
      })}
    </>
  );
}
