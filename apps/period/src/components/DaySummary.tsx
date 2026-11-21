import type { ConditionSnapshot, PeriodCycle, PeriodDay, PeriodSnapshot } from '@life/db';
import { dateDiff, isDateInCycle, projectPeriods, todayKey, toHHmm } from '@life/db';
import { Icon } from '@life/ui/icon';

export function periodDateContext(snap: PeriodSnapshot, date: string): { cycle: PeriodCycle | null; predictionLabel: string | null } {
  const today = todayKey();
  const sorted = [...snap.cycles].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const lastCycle = sorted.at(-1) ?? null;
  const completed = sorted.find((cycle) => !!cycle.endDate && isDateInCycle(date, cycle)) ?? null;
  const pending = [...sorted].reverse().find((cycle, reverseIndex) => {
    if (cycle.endDate || date < cycle.startDate) return false;
    const originalIndex = sorted.length - 1 - reverseIndex;
    const nextStart = sorted[originalIndex + 1]?.startDate ?? null;
    return !nextStart || date < nextStart;
  }) ?? null;
  const cycle = completed ?? pending;
  const projections = date > today ? projectPeriods(snap, date) : [];
  const projectedPeriod = projections.find((x) => date >= x.startDate && date <= x.endDate) ?? null;
  const projectedStarts = projections.filter((x) => x.startDate <= date).map((x) => x.startDate);
  const predictionBase = projectedStarts.at(-1) ?? lastCycle?.startDate ?? null;
  const predictionLabel = date > today
    ? projectedPeriod
      ? `預計經期第 ${dateDiff(projectedPeriod.startDate, date) + 1} 天`
      : predictionBase ? `預測週期第 ${dateDiff(predictionBase, date) + 1} 天` : null
    : null;
  return { cycle, predictionLabel };
}

export function DaySummary({ conditions, date, cycle, predictionLabel, day, onEdit }: {
  conditions: ConditionSnapshot;
  date: string;
  cycle: PeriodCycle | null;
  predictionLabel: string | null;
  day: PeriodDay | null;
  onEdit: () => void;
}) {
  const currentLogs = conditions.logs.filter((x) => x.date === date && conditions.items.find((i) => i.name === x.symptom)?.showInPeriod);
  const latestWeight = conditions.weights.filter((x) => x.date === date).at(-1) ?? null;
  return <>
    <section className="card day-summary-card">
      <div className="day-summary-heading"><div><h2>{formatLongDate(date)}</h2>{cycle ? <p className="muted small">{cycle.endDate ? `經期第 ${dateDiff(cycle.startDate, date) + 1} 天` : `經期第 ${dateDiff(cycle.startDate, date) + 1} 天・待確認結束日`}</p> : predictionLabel && <p className="muted small">{predictionLabel}</p>}</div></div>
      <dl className="day-summary-list">
        <div><dt>體重</dt><dd>{latestWeight ? `${latestWeight.kg} kg` : '沒有紀錄'}</dd></div>
        <div><dt>經血量</dt><dd>{day?.flow ?? '沒有紀錄'}</dd></div>
        <div><dt>血色</dt><dd>{day?.colors.length ? day.colors.join('、') : '沒有紀錄'}</dd></div>
        <div><dt>最大血塊</dt><dd>{day?.clotSize ?? '沒有紀錄'}</dd></div>
      </dl>
    </section>
    <section className="card"><h2>備註</h2><p className={day?.note ? '' : 'muted'}>{day?.note ?? '沒有紀錄'}</p></section>
    <section className="card"><h2>身體狀況</h2>{currentLogs.length ? <ul className="condition-summary-list">{currentLogs.map((log) => <li key={log.id}><strong>{log.symptom}</strong>{log.severity && <span>程度：{log.severity}</span>}{log.time != null && <span>時間：{toHHmm(log.time)}</span>}{log.note && <span>備註：{log.note}</span>}</li>)}</ul> : <p className="muted">沒有紀錄</p>}</section>
    <button className="day-edit-fab" aria-label="編輯這天的紀錄" title="編輯這天的紀錄" onClick={onEdit}><Icon name="pencil" size={22} /><span>編輯</span></button>
  </>;
}

const formatLongDate = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return `${year} 年 ${month} 月 ${day} 日`;
};
