import { Icon } from '@life/ui/icon';
import { WeekDateStrip } from '@life/ui/week-date-strip';
import type { HealthSnapshot } from '@life/db';
import { startOfDay, todayKey } from '@life/db';
import type { Nav } from '../App';

function timeForDate(date: string) {
  const now = new Date();
  const value = new Date(startOfDay(date));
  value.setHours(now.getHours(), now.getMinutes(), 0, 0);
  return value.getTime();
}

/** 健康新增入口：先選日期與項目，再開啟對應表單。 */
export function AddView({ snap, nav, date, setDate }: { snap: HealthSnapshot; nav: Nav; date: string; setDate: (date: string) => void }) {
  const at = () => timeForDate(date);
  const lastTemp = snap.temps[snap.temps.length - 1];
  return (
    <div className="health-add">
      <WeekDateStrip selected={date} setDate={setDate} maxDate={todayKey()} />
      <h2>新增健康紀錄</h2>
      <div className="health-entry-grid">
        <button type="button" onClick={() => nav.newBody('calendar', at())}><Icon name="weight" /><b>體重紀錄</b><small>體重、體脂、肌肉、水分、BMI</small></button>
        <button type="button" onClick={() => nav.vital('bp', { rec: null, initialTime: at() }, 'calendar')}><Icon name="heartPulse" /><b>血壓</b><small>收縮壓、舒張壓與脈搏</small></button>
        <button type="button" onClick={() => nav.vital('glucose', { rec: null, initialTime: at() }, 'calendar')}><Icon name="candy" /><b>血糖</b><small>數值、時機與餐別</small></button>
        <button type="button" onClick={() => nav.vital('temp', { rec: null, tempKind: lastTemp?.kind ?? '一般', initialTime: at() }, 'calendar')}><Icon name="thermometer" /><b>體溫</b><small>一般體溫或基礎體溫</small></button>
        <button type="button" onClick={() => nav.occ(null, at(), 'calendar')}><Icon name="ruler" /><b>身體尺寸</b><small>身高、腰圍及其他自訂項目</small></button>
        <button type="button" onClick={() => nav.lab({ mode: 'form', id: null, date }, 'calendar')}><Icon name="testTube" /><b>健檢／檢驗</b><small>報告與檢驗結果</small></button>
      </div>
    </div>
  );
}
