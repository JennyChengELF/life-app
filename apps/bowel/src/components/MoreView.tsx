import { Icon, type IconName } from '@life/ui/icon';

export type MoreSection = 'settings' | 'data' | 'issues';

export function MoreView({ issueCount, open }: { issueCount: number; open: (section: MoreSection) => void }) {
  return (
    <div className="more-list">
      <h2>更多</h2>
      <MoreButton icon="settings" title="判斷與提醒設定" detail="便秘天數與首頁體重提醒" onClick={() => open('settings')} />
      <MoreButton icon="clipboard" title="資料與試算表" detail="開啟排便資料與連線設定" onClick={() => open('data')} />
      {issueCount > 0 && <MoreButton icon="alert" title="需要處理的資料" detail={`${issueCount} 筆資料需要確認`} onClick={() => open('issues')} warn />}
    </div>
  );
}

function MoreButton({ icon, title, detail, onClick, warn = false }: { icon: IconName; title: string; detail: string; onClick: () => void; warn?: boolean }) {
  return <button type="button" className={warn ? 'warn' : ''} onClick={onClick}><span className="more-label"><Icon name={icon} /><span><b>{title}</b><small>{detail}</small></span></span><Icon name="right" /></button>;
}
