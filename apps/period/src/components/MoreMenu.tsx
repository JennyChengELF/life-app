import { Icon, type IconName } from '@life/ui/icon';

export type PeriodMoreKey = 'cycle' | 'reminders' | 'conditions' | 'data' | 'issues';
const ITEMS: { key: PeriodMoreKey; icon: IconName; label: string; note: string }[] = [
  { key: 'cycle', icon: 'calendar', label: '週期與預測設定', note: '預設週期、經期、排卵與易孕期' },
  { key: 'reminders', icon: 'alert', label: '提醒設定', note: '經期將至、開始日詢問與用品提醒' },
  { key: 'conditions', icon: 'heartPulse', label: '身體狀況項目', note: '顯示、新增、改名與停用' },
  { key: 'data', icon: 'book', label: '資料與試算表', note: '生理期與健康共用資料' },
];

export function MoreMenu({ issues, open }: { issues: number; open: (key: PeriodMoreKey) => void }) {
  const rows = issues ? [...ITEMS, { key: 'issues' as const, icon: 'alert' as IconName, label: '需要處理的資料', note: `${issues} 列需要修正` }] : ITEMS;
  return <div className="more-menu"><h2>設定與資料</h2>{rows.map((item) => <button className="more-menu-item" key={item.key} onClick={() => open(item.key)}><Icon name={item.icon} /><span><strong>{item.label}</strong><small>{item.note}</small></span><Icon name="right" size={18} /></button>)}</div>;
}
