import type { MoneySnapshot, SharedTag, Txn } from '@life/db';
import { emptyForm, fmtMoney, isRecordOnlyTxn, monthStats, startOfDay, todayKey, toHHmm, topCategory, txnCurrency, txnMissingCategory, txnMyNet, txnTitle } from '@life/db';
import { MonthCalendar } from '@life/ui/month-calendar';
import { tagLabel } from '@life/ui/tag-picker';
import { Icon, type IconName } from '@life/ui/icon';
import type { Editing } from '../App';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
export function dayLabel(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return `${m}/${d}（${WEEK[new Date(y, m - 1, d).getDay()]}）`;
}

/** 列表右邊的金額：支出紅、收入綠；轉帳、借還款只顯示金額 */
export function TxAmount({ t, snap }: { t: Txn; snap: MoneySnapshot }) {
  const cur = txnCurrency(t, snap.accounts);
  const { expense, income } = txnMyNet(t);
  const total = t.amount ?? 0;
  const local = t.origCurrency && (t.twdAmount == null ? '台幣待確認' : `${t.twdStatus === 'estimated' ? '預估 ' : ''}${fmtMoney(t.twdAmount)}`);
  if (expense || income) {
    const net = income - expense;
    const paid = t.direction === '出' && total !== expense ? `付 ${fmtMoney(total, cur)}` : null;
    return (
      <div className={`tx-amt ${net < 0 ? 'amt-out' : 'amt-in'}`}>
        {net < 0 ? '−' : '+'}
        {fmtMoney(Math.abs(net), cur)}
        {paid && <small>{paid}</small>}
        {local && <small>{local}</small>}
      </div>
    );
  }
  return <div className="tx-amt">{fmtMoney(total, cur)}</div>;
}

/** 第一層分類的圖示和顏色（2026-11-19 改版）；沒對到的用標籤圖示 */
const TOP_ICON: Record<string, [IconName, string]> = {
  食: ['utensils', 'orange'],
  衣: ['shirt', 'pink'],
  住: ['home', 'purple'],
  行: ['bus', 'teal'],
  育: ['bookOpen', 'indigo'],
  樂: ['music', 'rose'],
  投資: ['trend', 'green'],
};

/** 列表左邊的圓角圖示：依第一個明細決定 */
export function TxIcon({ t, snap }: { t: Txn; snap: MoneySnapshot }) {
  let icon: IconName = 'tag';
  let tone = 'gray';
  const first = t.lines.find((l) => l.kind === '支出' || l.kind === '收入');
  if (t.direction === '轉帳') icon = 'transfer';
  else if (first?.category) {
    const top = topCategory(first.category);
    const hit = TOP_ICON[top];
    if (first.kind === '收入') [icon, tone] = ['cash', 'green'];
    else if (hit) [icon, tone] = hit;
    else if (snap.categories.find((c) => c.path === first.category)?.isInvest) [icon, tone] = ['trend', 'green'];
  } else if (t.lines.some((l) => l.person)) [icon, tone] = ['user', 'purple'];
  else if (t.lines.some((l) => l.kind === '調整')) icon = 'scale';
  return (
    <span className={`tx-icon ${tone}`}>
      <Icon name={icon} size={20} strokeWidth={1.9} />
    </span>
  );
}

/** 標題後面的小標籤：人物的份、沒有預算 */
function TxBadges({ t }: { t: Txn }) {
  const cur = t.lines.some((l) => l.kind === '支出');
  const people = cur ? t.lines.filter((l) => l.kind === '他欠我' && l.person) : [];
  const noBudget = !isRecordOnlyTxn(t) && t.lines.some((l) => l.kind === '支出' && !l.budget);
  return (
    <>
      {people.map((l) => (
        <span key={l.id} className="badge person">
          {l.person} {fmtMoney(l.amount, 'TWD', false)}
        </span>
      ))}
      {txnMissingCategory(t) && <span className="badge warn">沒有分類</span>}
      {noBudget && <span className="badge warn">沒有預算</span>}
      {isRecordOnlyTxn(t) && <span className="badge info">僅記錄</span>}
    </>
  );
}

export function subText(t: Txn, tags: SharedTag[], withBadges = true) {
  const parts: string[] = [];
  if (t.direction === '轉帳') parts.push(t.cardPayments.length ? `${t.account} → ${[...new Set(t.cardPayments.map((x) => x.account))].join('、')}` : `${t.account} → ${t.toAccount}`);
  else if (t.payments?.length) parts.push(t.payments.map((x) => x.account).join('＋'));
  else if (t.account) parts.push(t.account);
  if (t.paidBy) parts.push(`${t.paidBy} 先付`);
  // 有分類又有人物 → 註明人物（只有人物時標題已經寫了；列表用小標籤顯示）
  if (withBadges && t.lines.some((l) => l.kind === '支出')) {
    const shared = t.lines.filter((l) => l.kind === '他欠我').map((l) => l.person);
    if (shared.length) parts.push(`含 ${shared.join('、')} 的份`);
  }
  if (t.store) parts.push(t.branch ? `${t.store}（${t.branch}）` : t.store);
  if (t.note) parts.push(t.note);
  // 明細的備註（拆成多個分類時每一行可以有自己的備註）
  const lineNotes = t.lines.map((l) => l.note).filter((x): x is string => !!x && x !== t.note);
  if (lineNotes.length) parts.push(lineNotes.join('／'));
  if (t.tagIds.length) parts.push(t.tagIds.map((id) => tagLabel(tags, id)).join(' '));
  if (withBadges && !isRecordOnlyTxn(t) && t.lines.some((l) => l.kind === '支出' && !l.budget)) parts.unshift('⚠️ 沒有預算');
  if (withBadges && txnMissingCategory(t)) parts.unshift('⚠️ 沒有分類');
  return parts.join('・');
}

export function TxList({ list, snap, onEdit }: { list: Txn[]; snap: MoneySnapshot; onEdit: (e: Editing) => void }) {
  return (
    <ul className="tx-list">
      {list.map((t) => (
        <li key={t.id} className="tx-row" onClick={() => onEdit({ form: emptyForm(), txn: t })}>
          <TxIcon t={t} snap={snap} />
          <div className="tx-main">
            <div className="tx-title">
              {txnTitle(t)} <TxBadges t={t} />
            </div>
            <div className="tx-sub">{[toHHmm(t.time), subText(t, snap.sharedTags, false)].filter(Boolean).join('・')}</div>
          </div>
          <TxAmount t={t} snap={snap} />
        </li>
      ))}
    </ul>
  );
}

/**
 * 上方的總計卡（2026-11-19 改版）：一天 → 這天支出（大字）、收入、本月支出；整月 → 本月支出、收入。
 * 只算新台幣；外幣另外一行。
 */
export function SummaryCard({ snap, date, view }: { snap: MoneySnapshot; date: string; view: 'day' | 'month' }) {
  const twdOf = (prefix: string) => monthStats(snap.txns, snap.categories, snap.accounts, prefix).find((s) => s.currency === 'TWD');
  const month = date.slice(0, 7);
  const m = twdOf(month);
  const main = view === 'day' ? twdOf(date) : m;
  const [, mm, dd] = date.split('-').map(Number);
  const label = view === 'month' ? `${mm} 月支出` : date === todayKey() ? '今天支出' : `${mm}/${dd} 支出`;
  const foreign = monthStats(snap.txns, snap.categories, snap.accounts, view === 'day' ? date : month).filter((s) => s.currency !== 'TWD');
  return (
    <>
      <div className="sum-card">
        <div className="grow">
          <div className="sum-label">{label}</div>
          <div className="sum-big num">{fmtMoney(main?.expense ?? 0)}</div>
        </div>
        <div className="sum-side">
          <div className="sum-label">收入</div>
          <div className="num">{fmtMoney(main?.income ?? 0)}</div>
        </div>
        {view === 'day' && (
          <div className="sum-side">
            <div className="sum-label">本月支出</div>
            <div className="num">{fmtMoney(m?.expense ?? 0)}</div>
          </div>
        )}
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
  const calendarInfo = (calendarDate: string) => {
    const count = snap.txns.filter((txn) => txn.date === calendarDate).length;
    return count ? { marks: [{ color: 'var(--accent)', kind: 'dot' as const }], label: `${count} 筆記帳紀錄` } : null;
  };

  return (
    <>
      {/* 2026-11-19 改版：右下角「＋」記一筆，進去再選支出 / 收入 / 轉帳 / 還款 */}
      {!editing && (
        <button className="fab" onClick={() => newEntry('支出')} aria-label="記一筆" title="記一筆">
          <Icon name="plus" size={28} strokeWidth={2.2} />
        </button>
      )}
      {!snap.accounts.length && <p className="hint warn">還沒有帳戶：請先到「帳戶」新增帳戶（例：台幣現金、信用卡）。</p>}

      <MonthCalendar selected={date} setDate={setDate} dayInfo={calendarInfo} maxDate={todayKey()} />

      <section className="ledger-head-wrap">
        <div className="ledger-head">
          <div className="seg">
            <button className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}>
              日
            </button>
            <button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>
              月
            </button>
          </div>
        </div>

      </section>
      <SummaryCard snap={snap} date={date} view={view} />
      <section className="card tx-card">
        {view === 'day' ? (
          snap.txns.some((t) => t.date === date) ? (
            <TxList list={snap.txns.filter((t) => t.date === date)} snap={snap} onEdit={onEdit} />
          ) : (
            <p className="muted center-text">這天沒有紀錄</p>
          )
        ) : (
          <MonthList snap={snap} month={month} onEdit={onEdit} onDay={(d) => (setDate(d), setView('day'))} />
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
