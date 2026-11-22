import { Icon, type IconName } from '@life/ui/icon';

export type MoreKey = 'budgets' | 'accounts' | 'categories' | 'people' | 'stores' | 'settings' | 'data' | 'issues';
const Button = ({ icon, title, detail, onClick, warn = false }: { icon: IconName; title: string; detail: string; onClick: () => void; warn?: boolean }) => <button className={warn ? 'warn' : ''} onClick={onClick}><span className="more-label"><Icon name={icon} /><span><b>{title}</b><small>{detail}</small></span></span><Icon name="right" /></button>;

export function MoreMenu({ issues, open }: { issues: number; open: (key: MoreKey) => void }) {
  return <div className="more-list money-more"><h2>主要功能</h2><Button icon="wallet" title="預算" detail="每月、追加、重新盤點與期初" onClick={() => open('budgets')} /><Button icon="bank" title="帳戶" detail="餘額、卡費、對帳、盤點與定存" onClick={() => open('accounts')} /><Button icon="tag" title="分類" detail="收入、支出、子分類與預設預算" onClick={() => open('categories')} /><h2>管理與設定</h2><Button icon="user" title="人物" detail="代墊與借還款對象" onClick={() => open('people')} /><Button icon="home" title="店家／機構" detail="店家、銀行與醫療機構" onClick={() => open('stores')} /><Button icon="settings" title="記帳設定" detail="預算收入比較與欠款提醒" onClick={() => open('settings')} /><Button icon="clipboard" title="資料與試算表" detail="記帳資料與 Google 連線" onClick={() => open('data')} />{issues > 0 && <Button icon="alert" title="需要處理的資料" detail={`${issues} 筆資料需要確認`} onClick={() => open('issues')} warn />}</div>;
}
