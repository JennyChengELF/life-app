import type { MoneySnapshot, Txn } from '@life/db';
import { txnCurrency, txnMyNet, todayKey } from '@life/db';
import { MonthCalendar, type MonthCalendarMark } from '@life/ui/month-calendar';
import { Icon } from '@life/ui/icon';
import type { Editing } from '../App';
import { SummaryCard, TxList, dayLabel } from './LedgerView';

const hasExpense = (txn: Txn) => txn.lines.some((line) => line.kind === '支出') || txnMyNet(txn).expense > 0;
const hasIncome = (txn: Txn) => txn.lines.some((line) => line.kind === '收入') || txnMyNet(txn).income > 0;

/** 2026-11-22 使用者決定：記帳日曆依支出、收入、轉帳顯示小點，下方列所選日期記錄。 */
export function CalendarView({ snap, date, setDate, onEdit, onAdd }: { snap: MoneySnapshot; date: string; setDate: (date: string) => void; onEdit: (editing: Editing) => void; onAdd: () => void }) {
  const list = snap.txns.filter((txn) => txn.date === date);
  const info = (value: string) => {
    const txns = snap.txns.filter((txn) => txn.date === value);
    if (!txns.length) return null;
    const marks: MonthCalendarMark[] = [];
    if (txns.some(hasExpense)) marks.push({ color: 'var(--out)', kind: 'dot', label: '支出' });
    if (txns.some(hasIncome)) marks.push({ color: 'var(--in)', kind: 'dot', label: '收入' });
    if (txns.some((txn) => txn.direction === '轉帳')) marks.push({ color: 'var(--accent)', kind: 'dot', label: '轉帳／繳卡費' });
    return { marks, label: `${txns.length} 筆記帳紀錄：${marks.map((mark) => mark.label).join('、')}` };
  };
  const baseGroups = [
    { label: '支出', list: list.filter((txn) => txn.direction !== '轉帳' && hasExpense(txn)) },
    { label: '收入', list: list.filter((txn) => txn.direction !== '轉帳' && hasIncome(txn)) },
    { label: '轉帳／繳卡費', list: list.filter((txn) => txn.direction === '轉帳') },
  ].filter((group) => group.list.length);
  /** 2026-11-22 使用者決定：不同幣別分開顯示、分開計算。 */
  const groups = baseGroups.flatMap((group) => [...new Set(group.list.map((txn) => txnCurrency(txn, snap.accounts)))].map((currency) => ({
    label: `${group.label}（${currency}）`,
    list: group.list.filter((txn) => txnCurrency(txn, snap.accounts) === currency),
  })));
  return <div className="money-calendar"><MonthCalendar selected={date} setDate={setDate} dayInfo={info} maxDate={todayKey()} /><h2>{dayLabel(date)}記帳紀錄</h2><SummaryCard snap={snap} date={date} view="day" />{groups.length ? groups.map((group) => <section className="card tx-card" key={group.label}><h2>{group.label}</h2><TxList list={group.list} snap={snap} onEdit={onEdit} /></section>) : <section className="card"><p className="muted center-text">這天沒有紀錄</p></section>}<button className="calendar-add-button" onClick={onAdd} aria-label={`新增 ${date} 記帳`}><Icon name="plus" size={28} /></button></div>;
}
