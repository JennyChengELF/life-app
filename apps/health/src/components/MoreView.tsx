import type { HealthSnapshot } from '@life/db';
import { mismatchFields } from '@life/db';
import { Icon, type IconName } from '@life/ui/icon';
import type { Nav } from '../App';
import type { HealthSettingSection } from './SettingsView';

/** 健康更多：先顯示功能清單，各設定再進獨立子頁。 */
export function MoreView({ snap, nav, onSettings }: { snap: HealthSnapshot; nav: Nav; onSettings: (section: HealthSettingSection) => void }) {
  const issueCount = snap.issues.length + snap.body.filter((measurement) => mismatchFields(measurement, snap).length > 0).length;
  return (
    <div className="more-list health-more">
      <h2>更多</h2>
      <MoreButton icon="weight" title="體重紀錄設定" detail="顯示欄位與順序" onClick={() => onSettings('body')} />
      <MoreButton icon="heartPulse" title="血壓設定" detail="722 早晚量測時段" onClick={() => onSettings('bp')} />
      <MoreButton icon="thermometer" title="體溫設定" detail="一般／基礎體溫預設部位" onClick={() => onSettings('temp')} />
      <MoreButton icon="ruler" title="身體尺寸項目" detail="名稱、單位、排序與停用" onClick={() => onSettings('occ')} />
      <MoreButton icon="testTube" title="健檢／檢驗項目" detail="類型、單位與參考範圍" onClick={() => nav.lab({ mode: 'items' }, 'more')} />
      <MoreButton icon="clipboard" title="資料與試算表" detail="開啟健康資料與連線設定" onClick={() => onSettings('data')} />
      {issueCount > 0 && <MoreButton icon="alert" title="需要處理的資料" detail={`${issueCount} 筆資料需要確認`} onClick={() => nav.go('issues')} warn />}
    </div>
  );
}

function MoreButton({ icon, title, detail, onClick, warn = false }: { icon: IconName; title: string; detail: string; onClick: () => void; warn?: boolean }) {
  return <button type="button" className={warn ? 'warn' : ''} onClick={onClick}><span className="more-label"><Icon name={icon} /><span><b>{title}</b><small>{detail}</small></span></span><Icon name="right" /></button>;
}
