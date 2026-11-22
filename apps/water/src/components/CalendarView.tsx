import { Icon } from '@life/ui/icon';
import { MonthCalendar } from '@life/ui/month-calendar';
import { dateLabel } from '@life/ui/timeline';
import type { WaterSnapshot } from '@life/db';
import { computeGoal, drinkOf, goalWeight, todayKey, toHHmm } from '@life/db';
import { drinkColor, totalsByDrink } from '../drinkColors';
import { ProgressRing } from './ProgressRing';

export function CalendarView({ snap, date, setDate, onAdd, onEdit }: { snap: WaterSnapshot; date: string; setDate: (date: string) => void; onAdd: () => void; onEdit: (id: string) => void }) {
  const logs = snap.logs.filter((item) => item.date === date).sort((a, b) => b.time - a.time);
  const total = logs.reduce((sum, item) => sum + item.ml, 0);
  const day = snap.days.get(date);
  const goal = day?.goal ?? computeGoal(goalWeight(snap.weights, date)?.kg ?? null, snap.settings).goal;
  const byDrink = totalsByDrink(logs.map((item) => ({ drink: drinkOf(item, snap.drinks), ml: item.ml })), snap.drinks);

  const dayInfo = (calendarDate: string) => {
    const dateLogs = snap.logs.filter((item) => item.date === calendarDate);
    if (dateLogs.length === 0) return null;
    const dateTotal = dateLogs.reduce((sum, item) => sum + item.ml, 0);
    const savedDay = snap.days.get(calendarDate);
    const dateGoal = savedDay?.goal ?? computeGoal(goalWeight(snap.weights, calendarDate)?.kg ?? null, snap.settings).goal;
    const progress = dateGoal > 0 ? Math.min(1, dateTotal / dateGoal) : 0;
    const reached = progress >= 1;
    return {
      marks: [{ color: reached ? 'var(--ok)' : 'var(--accent)', kind: 'bar' as const, progress, text: reached ? '✓' : undefined }],
      label: `喝水 ${dateTotal.toLocaleString()}／${dateGoal.toLocaleString()} ml${reached ? '，已達標' : ''}`,
    };
  };

  return (
    <div className="calendar-view">
      <MonthCalendar selected={date} setDate={setDate} dayInfo={dayInfo} maxDate={todayKey()} />
      <section className="card">
        <h2>{dateLabel(date)}喝水紀錄</h2>
        <ProgressRing total={total} goal={goal} />
        {byDrink.length > 0 && (
          <p className="by-drink">{byDrink.map((item) => <span key={item.drink}><i className="dot" style={{ background: drinkColor(item.drink, snap.drinks) }} />{item.drink} {item.ml.toLocaleString()}</span>)}</p>
        )}
        {day?.locked && <p className="muted small center-text">這天的目標已鎖定（{goal.toLocaleString()} ml）</p>}
        {logs.length === 0 ? <p className="muted center-text">這天沒有紀錄</p> : (
          <ul className="log-list">
            {logs.map((item) => (
              <li key={item.id} className="log-row">
                <span className="log-time">{toHHmm(item.time)}</span>
                <span className="drink-tag"><i className="dot" style={{ background: drinkColor(drinkOf(item, snap.drinks), snap.drinks) }} />{drinkOf(item, snap.drinks)}</span>
                {item.note && <span className="log-note">{item.note}</span>}
                <span className="log-ml">{item.ml} ml</span>
                {item.createdVia === 'sheet' && <span className="badge">試算表</span>}
                <button type="button" className="link" onClick={() => onEdit(item.id)} disabled={item.rowNumber < 0}>編輯</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <button type="button" className="fab" onClick={onAdd} aria-label={`新增 ${date} 喝水紀錄`}><Icon name="plus" size={28} /></button>
    </div>
  );
}
