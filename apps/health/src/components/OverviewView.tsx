import type { HealthSnapshot } from '@life/db';
import { Icon } from '@life/ui/icon';
import { healthEntries, mismatchFields, sortEntries, todayKey } from '@life/db';
import { MonthCalendar } from '@life/ui/month-calendar';
import { dateLabel, Timeline } from '@life/ui/timeline';
import type { HealthApi } from '../useHealth';
import type { Nav } from '../App';

/** 總覽：一天一天看，那天記的所有東西依時間排（2026-11-17 使用者決定） */
export function OverviewView(props: { api: HealthApi; snap: HealthSnapshot; nav: Nav; date: string; setDate: (d: string) => void }) {
  const { api, snap, nav, date, setDate } = props;
  const mismatches = snap.body.filter((m) => mismatchFields(m, snap).length > 0);
  const entries = sortEntries(healthEntries(snap, date));
  const groups = [
    { kinds: ['body'], label: '體重紀錄' },
    { kinds: ['bp'], label: '血壓' },
    { kinds: ['glucose'], label: '血糖' },
    { kinds: ['temp'], label: '體溫' },
    { kinds: ['occ'], label: '身體尺寸' },
    { kinds: ['lab'], label: '健檢／檢驗' },
  ].map((group) => ({ ...group, entries: entries.filter((entry) => group.kinds.includes(entry.ref.kind)) })).filter((group) => group.entries.length > 0);
  const calendarInfo = (calendarDate: string) => {
    const dayEntries = healthEntries(snap, calendarDate);
    if (dayEntries.length === 0) return null;
    const level = dayEntries.some((entry) => entry.judge?.level === 'bad')
      ? 'bad'
      : dayEntries.some((entry) => entry.warn || entry.judge?.level === 'warn') ? 'warn' : 'ok';
    return {
      marks: [
        { color: 'var(--accent)', kind: 'text' as const, text: `${dayEntries.length}筆` },
        ...(level === 'ok' ? [] : [{ color: 'var(--danger)', kind: 'text' as const, text: '!' }]),
      ],
      label: `${dayEntries.length} 筆健康紀錄${level === 'ok' ? '' : '，有需注意的數值'}`,
    };
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
          <button className="msg warn" onClick={() => nav.edit(mismatches[mismatches.length - 1], 'calendar')}>
            ⚠️ 有 {mismatches.length} 筆身體量測的數值對不起來（BMI 或 % 和 kg） ›
          </button>
        )}
      </div>

      <MonthCalendar selected={date} setDate={setDate} dayInfo={calendarInfo} maxDate={todayKey()} />

      <h2>{dateLabel(date)}健康紀錄</h2>
      {/* 2026-11-22 使用者決定：日曆下方的紀錄只能查看，不在這裡修改。 */}
      {groups.length === 0 ? <section className="card"><p className="muted center-text">這天沒有紀錄</p></section> : groups.map((group) => <section className="card" key={group.label}><h2>{group.label}</h2><Timeline entries={group.entries} /></section>)}
      <button type="button" className="fab" onClick={() => nav.go('add')} aria-label={`新增 ${date} 健康紀錄`}><Icon name="plus" size={28} /></button>
      {api.busy && <p className="muted small center-text">更新中⋯⋯</p>}
      <p className="muted small center-text">數值僅供記錄參考，不能取代醫療建議。</p>
    </div>
  );
}
