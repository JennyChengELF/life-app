import type { HealthSnapshot, TimelineEntry } from '@life/db';
import { healthEntries, mismatchFields, sortEntries, todayKey } from '@life/db';
import { DateNav, Timeline } from '@life/ui/timeline';
import type { HealthApi } from '../useHealth';
import type { Nav } from '../App';

/** 總覽：一天一天看，那天記的所有東西依時間排（2026-11-17 使用者決定） */
export function OverviewView(props: { api: HealthApi; snap: HealthSnapshot; nav: Nav; date: string; setDate: (d: string) => void }) {
  const { api, snap, nav, date, setDate } = props;
  const mismatches = snap.body.filter((m) => mismatchFields(m, snap).length > 0);
  const lastTemp = snap.temps[snap.temps.length - 1];
  const entries = sortEntries(healthEntries(snap, date));

  const pick = (e: TimelineEntry) => {
    if (e.ref.app === 'health') nav.openRecord(e.ref.kind, e.ref.id, 'overview');
  };

  return (
    <div className="overview">
      <div className="messages">
        {snap.issues.length > 0 && (
          <button className="msg warn" onClick={() => nav.go('issues')}>
            ⚠️ 健康試算表有 {snap.issues.length} 筆資料需要補齊 ›
          </button>
        )}
        {mismatches.length > 0 && (
          <button className="msg warn" onClick={() => nav.edit(mismatches[mismatches.length - 1], 'overview')}>
            ⚠️ 有 {mismatches.length} 筆身體量測的數值對不起來（BMI 或 % 和 kg） ›
          </button>
        )}
      </div>

      {/* 快速記錄：記的是現在，記完回到今天 */}
      <div className="quick" onClickCapture={() => setDate(todayKey())}>
        <button onClick={() => nav.newBody('overview')}>
          <span className="q-icon">⚖️</span>記身體
        </button>
        <button onClick={() => nav.vital('bp', undefined, 'overview')}>
          <span className="q-icon">🩸</span>記血壓
        </button>
        <button onClick={() => nav.vital('glucose', undefined, 'overview')}>
          <span className="q-icon">🍬</span>記血糖
        </button>
        <button onClick={() => nav.vital('temp', { rec: null, tempKind: lastTemp?.kind ?? '一般' }, 'overview')}>
          <span className="q-icon">🌡️</span>記體溫
        </button>
      </div>

      <section className="card">
        <DateNav date={date} setDate={setDate} />
        <Timeline entries={entries} onPick={pick} />
      </section>
      {api.busy && <p className="muted small center-text">更新中⋯⋯</p>}
      <p className="muted small center-text">數值僅供記錄參考，不能取代醫療建議。</p>
    </div>
  );
}
