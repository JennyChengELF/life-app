import { Icon } from '@life/ui/icon';
import type { Nav } from '../App';

/** 健康統計入口；各種類圖表留在獨立子頁。 */
export function StatsMenu({ nav }: { nav: Nav }) {
  return (
    <div className="health-stats-menu">
      <h2>健康統計</h2>
      <div className="entry-card-grid">
        <button type="button" onClick={() => nav.go('body')}><Icon name="weight" /><b>體重紀錄</b><small>依量測時段查看趨勢</small></button>
        <button type="button" onClick={() => nav.go('bp')}><Icon name="heartPulse" /><b>血壓</b><small>平均、趨勢與需注意紀錄</small></button>
        <button type="button" onClick={() => nav.go('glucose')}><Icon name="candy" /><b>血糖</b><small>依時機查看趨勢</small></button>
        <button type="button" onClick={() => nav.go('temp')}><Icon name="thermometer" /><b>體溫</b><small>一般與基礎體溫分開</small></button>
        <button type="button" onClick={() => nav.go('occStats')}><Icon name="ruler" /><b>身體尺寸</b><small>各項目最新值與歷史</small></button>
        <button type="button" onClick={() => nav.lab({ mode: 'stats' }, 'stats')}><Icon name="testTube" /><b>健檢／檢驗</b><small>依項目查看歷年趨勢</small></button>
      </div>
    </div>
  );
}
