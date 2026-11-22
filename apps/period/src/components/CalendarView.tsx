import type { ConditionSnapshot, PeriodSnapshot } from '@life/db';
import { estimatedCycleEnd, isDateInCycle, projectPeriods, todayKey } from '@life/db';
import { MonthCalendar, type MonthCalendarMark } from '@life/ui/month-calendar';
import { DaySummary, periodDateContext } from './DaySummary';

const FLOW_COLORS: Record<string, string> = {
  點狀: '#f8cbd5', 極少: '#f8cbd5', 少量: '#f29bae', 普通: '#e86f89', 偏多: '#cf3f62', 大量: '#a92349',
};

/** 2026-11-22 使用者決定：生理期改用共用月曆，實際經期以紅色粗色條表示。 */
export function CalendarView({ snap, selected, setDate, conditions, editDate }: { snap: PeriodSnapshot; selected: string; setDate: (date: string) => void; conditions: ConditionSnapshot; editDate: (date: string) => void }) {
  const sorted = [...snap.cycles].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const projections = projectPeriods(snap, `${Number(selected.slice(0, 4)) + 2}-12-31`);
  const info = (date: string) => {
    const day = snap.days.find((value) => value.date === date) ?? null;
    const completed = sorted.some((cycle) => !!cycle.endDate && isDateInCycle(date, cycle));
    const pending = sorted.find((cycle) => !cycle.endDate && date >= cycle.startDate && date <= estimatedCycleEnd(sorted, snap.settings, cycle)) ?? null;
    const actual = completed || (!!pending && (date <= todayKey() || date === pending.startDate || !!day?.flow));
    const predicted = !actual && (!!pending || projections.some((value) => date >= value.startDate && date <= value.endDate));
    const ovulation = projections.some((value) => value.ovulationDate === date);
    const fertile = projections.some((value) => !!value.fertileFrom && date >= value.fertileFrom && date <= value.fertileTo!);
    const bleed = !!day && !actual;
    const marks: MonthCalendarMark[] = [];
    if (actual) marks.push({ kind: 'bar', color: FLOW_COLORS[day?.flow ?? ''] ?? '#ef9eb0', progress: .78, label: day?.flow ? `實際經期・${day.flow}` : '實際經期・未填經血量' });
    else if (predicted) marks.push({ kind: 'bar', color: '#e79ab7', progress: .78, dashed: true, label: '預測經期' });
    if (bleed) marks.push({ kind: 'dot', color: '#c92f55', label: '非經期出血' });
    if (ovulation) marks.push({ kind: 'ring', color: '#8064b5', label: '估計排卵日' });
    else if (fertile) marks.push({ kind: 'bar', color: '#9b82c7', progress: .45, label: '估計易孕期' });
    if (!marks.length) return null;
    return { marks, label: marks.map((mark) => mark.label).join('、') };
  };
  const context = periodDateContext(snap, selected);
  const day = snap.days.find((value) => value.date === selected) ?? null;
  return <div className="period-calendar-view">
    <MonthCalendar selected={selected} setDate={setDate} dayInfo={info} />
    <div className="cal-legend"><span><i className="legend-bar actual" />實際經期（深淺代表經血量）</span><span><i className="legend-bar predicted" />預測經期</span><span><i className="bleed-dot" />非經期出血</span><span><i className="legend-ring" />估計排卵日</span><span><i className="legend-line" />估計易孕期</span></div>
    {snap.settings.ovulationEnabled && <p className="muted small disclaimer">估計排卵日與易孕期僅依週期推算，不能確認實際排卵，也不適合作為避孕依據。</p>}
    <div className="calendar-day-details"><DaySummary conditions={conditions} date={selected} cycle={context.cycle} predictionLabel={context.predictionLabel} day={day} onEdit={() => editDate(selected)} /></div>
  </div>;
}
