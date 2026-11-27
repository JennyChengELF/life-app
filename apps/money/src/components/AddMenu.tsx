import type { EntryForm } from '@life/db';
import { WeekDateStrip } from '@life/ui/week-date-strip';
import { Icon, type IconName } from '@life/ui/icon';

const ENTRIES: { mode: EntryForm['mode']; icon: IconName; title: string; detail: string }[] = [
  { mode: '支出', icon: 'wallet', title: '支出', detail: '可加入折抵或收入項目' },
  { mode: '收入', icon: 'cash', title: '收入', detail: '可加入扣除或支出項目' },
  { mode: '轉帳', icon: 'transfer', title: '轉帳／繳卡費', detail: '帳戶互轉或分配多張卡費' },
  { mode: '還款', icon: 'user', title: '還款', detail: '人物之間的借還款' },
];

export function AddMenu({ date, setDate, open, openInvestment }: {
  date: string; setDate: (date: string) => void; open: (mode: EntryForm['mode']) => void; openInvestment: () => void;
}) {
  return <div className="money-add"><WeekDateStrip selected={date} setDate={setDate} /><h2>新增記帳</h2>
    <div className="money-entry-grid">{ENTRIES.map((entry) => <button key={entry.mode} type="button" onClick={() => open(entry.mode)}>
      <Icon name={entry.icon} /><b>{entry.title}</b><small>{entry.detail}</small></button>)}
      <button type="button" onClick={openInvestment}><Icon name="chart" /><b>投資交易</b><small>買進、賣出或贖回</small></button>
    </div>
  </div>;
}
