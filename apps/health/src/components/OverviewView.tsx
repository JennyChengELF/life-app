import type { HealthSnapshot, TimelineEntry } from '@life/db';
import { Icon } from '@life/ui/icon';
import { healthEntries, mismatchFields, sortEntries, startOfDay, todayKey } from '@life/db';
import { MonthCalendar } from '@life/ui/month-calendar';
import { dateLabel, Timeline } from '@life/ui/timeline';
import type { HealthApi } from '../useHealth';
import type { Nav } from '../App';

/** 總覽：一天一天看，那天記的所有東西依時間排（2026-11-17 使用者決定） */
export function OverviewView(props: { api: HealthApi; snap: HealthSnapshot; nav: Nav; date: string; setDate: (d: string) => void }) {
  const { api, snap, nav, date, setDate } = props;
  const mismatches = snap.body.filter((m) => mismatchFields(m, snap).length > 0);
  const lastTemp = snap.temps[snap.temps.length - 1];
  const entries = sortEntries(healthEntries(snap, date));
  const calendarInfo = (calendarDate: string) => {
    const dayEntries = healthEntries(snap, calendarDate);
    if (dayEntries.length === 0) return null;
    const level = dayEntries.some((entry) => entry.judge?.level === 'bad')
      ? 'bad'
      : dayEntries.some((entry) => entry.warn || entry.judge?.level === 'warn') ? 'warn' : 'ok';
    const color = level === 'bad' ? 'var(--danger)' : level === 'warn' ? 'var(--warn)' : 'var(--accent)';
    return {
      marks: [{ color, kind: 'dot' as const }],
      label: `${dayEntries.length} 筆健康紀錄${level === 'ok' ? '' : '，有需注意的數值'}`,
    };
  };

  const pick = (e: TimelineEntry) => {
    if (e.ref.app === 'health') nav.openRecord(e.ref.kind, e.ref.id, 'overview');
  };
  const timeForSelectedDate = () => {
    const now = Date.now();
    return date === todayKey() ? now : startOfDay(date) + (now - startOfDay(todayKey()));
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

      <MonthCalendar selected={date} setDate={setDate} dayInfo={calendarInfo} maxDate={todayKey()} />

      {/* 快速記錄：日期預設使用月曆選取日（2026-11-21 使用者決定） */}
      <div className="quick">
        <button onClick={() => nav.newBody('overview', timeForSelectedDate())}>
          <Icon name="weight" className="q-icon" />記身體
        </button>
        <button onClick={() => nav.vital('bp', { rec: null, initialTime: timeForSelectedDate() }, 'overview')}>
          <Icon name="heartPulse" className="q-icon" />記血壓
        </button>
        <button onClick={() => nav.vital('glucose', { rec: null, initialTime: timeForSelectedDate() }, 'overview')}>
          <Icon name="candy" className="q-icon" />記血糖
        </button>
        <button onClick={() => nav.vital('temp', { rec: null, tempKind: lastTemp?.kind ?? '一般', initialTime: timeForSelectedDate() }, 'overview')}>
          <Icon name="thermometer" className="q-icon" />記體溫
        </button>
      </div>

      <section className="card">
        <h2>{dateLabel(date)}健康紀錄</h2>
        <Timeline entries={entries} onPick={pick} />
      </section>
      {api.busy && <p className="muted small center-text">更新中⋯⋯</p>}
      <p className="muted small center-text">數值僅供記錄參考，不能取代醫療建議。</p>
    </div>
  );
}
