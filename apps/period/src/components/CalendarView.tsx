import { useEffect, useState } from 'react';
import type { ConditionSnapshot, PeriodSnapshot } from '@life/db';
import { addDays, estimatedCycleEnd, isDateInCycle, projectPeriods, startOfDay, todayKey } from '@life/db';
import { DaySummary, periodDateContext } from './DaySummary';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const monthOf = (date: string) => date.slice(0, 7);
const moveMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export function CalendarView({ snap, openDate, selected, conditions, editDate }: { snap: PeriodSnapshot; openDate?: (date: string) => void; selected?: string; conditions?: ConditionSnapshot; editDate?: (date: string) => void }) {
  const [month, setMonth] = useState(monthOf(selected ?? todayKey()));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  useEffect(() => {
    if (selected) setMonth(monthOf(selected));
  }, [selected]);
  const first = `${month}-01`;
  const start = addDays(first, -new Date(startOfDay(first)).getDay());
  const dates = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const today = todayKey();
  const sortedCycles = [...snap.cycles].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const latestCycle = sortedCycles.at(-1) ?? null;
  const projections = projectPeriods(snap, dates.at(-1)!);
  const chooseDate = (date: string) => {
    if (conditions && editDate) setSelectedDate(date);
    else openDate?.(date);
  };
  const chooseMonth = (nextMonth: string) => {
    setMonth(nextMonth);
    setSelectedDate(null);
  };
  const displayedDate = selectedDate ?? selected;
  const context = selectedDate ? periodDateContext(snap, selectedDate) : null;
  return <>
  <section className="card calendar-card">
    <div className="month-nav"><button className="icon-btn" onClick={() => chooseMonth(moveMonth(month, -1))}>‹</button><strong>{month.replace('-', ' 年 ')} 月</strong><button className="icon-btn" onClick={() => chooseMonth(moveMonth(month, 1))}>›</button><button className="link" onClick={() => chooseMonth(monthOf(today))}>本月</button></div>
    <div className="period-calendar">{WEEK.map((w) => <div className="cal-head" key={w}>{w}</div>)}
      {dates.map((date) => {
        const day = snap.days.find((d) => d.date === date) ?? null;
        const completedActual = sortedCycles.some((c) => !!c.endDate && isDateInCycle(date, c));
        const latestOngoingActual = !!latestCycle && !latestCycle.endDate && date >= latestCycle.startDate && date <= today;
        const pendingCycle = sortedCycles.find((c) => !c.endDate && date >= c.startDate && date <= estimatedCycleEnd(sortedCycles, snap.settings, c)) ?? null;
        const confirmedPendingDay = !!pendingCycle && (date === pendingCycle.startDate || !!day?.flow);
        const actual = completedActual || latestOngoingActual || confirmedPendingDay;
        const provisional = !!pendingCycle && !actual;
        const futurePrediction = projections.some((p) => date >= p.startDate && date <= p.endDate);
        const predicted = !actual && (provisional || futurePrediction);
        const bleed = !!day && !actual;
        const ovulation = projections.some((p) => p.ovulationDate === date);
        const fertile = projections.some((p) => !!p.fertileFrom && date >= p.fertileFrom && date <= p.fertileTo!);
        const other = !date.startsWith(month);
        const flowClass = actual ? flowShade(day?.flow ?? null) : '';
        return <button key={date} className={['period-cal-day', actual && 'actual', flowClass, predicted && 'predicted', ovulation && 'ovulation', fertile && 'fertile', date === today && 'today', date === displayedDate && 'selected', other && 'other'].filter(Boolean).join(' ')} onClick={() => chooseDate(date)}>
          <span>{Number(date.slice(8))}</span>{bleed && <i className="bleed-dot" />}{ovulation && <small>估計排卵</small>}
        </button>;
      })}
    </div>
    <div className="cal-legend"><span><i className="legend-box actual" />實際經期</span><span><i className="legend-box predicted" />預測經期</span><span><i className="bleed-dot" />非經期出血</span><span><i className="legend-ring" />估計排卵日</span><span><i className="legend-line" />估計易孕期</span></div>
    <p className="muted small disclaimer">估計排卵日與易孕期僅依週期推算，不能確認實際排卵，也不適合作為避孕依據。</p>
  </section>
  {selectedDate && conditions && editDate && context && <div className="calendar-day-details"><DaySummary conditions={conditions} date={selectedDate} cycle={context.cycle} predictionLabel={context.predictionLabel} day={snap.days.find((x) => x.date === selectedDate) ?? null} onEdit={() => editDate(selectedDate)} /></div>}
  </>;
}

function flowShade(flow: string | null) {
  if (flow === '點狀' || flow === '極少') return 'flow-very-light';
  if (flow === '少量') return 'flow-light';
  if (flow === '普通') return 'flow-normal';
  if (flow === '偏多') return 'flow-heavy';
  if (flow === '大量') return 'flow-very-heavy';
  return 'flow-unknown';
}
