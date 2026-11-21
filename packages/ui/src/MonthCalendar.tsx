import { useEffect, useState, type CSSProperties } from 'react';
import { addDays, startOfDay, todayKey } from '@life/db';
import { Icon } from './Icon';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

export interface MonthCalendarMark {
  /** CSS 顏色；可使用 var(--ok) 等共用色彩變數。 */
  color?: string;
  label?: string;
  kind?: 'dot' | 'bar';
}

export interface MonthCalendarDayInfo {
  marks?: MonthCalendarMark[];
  label?: string;
}

const monthOf = (date: string) => date.slice(0, 7);

function shiftMonth(month: string, delta: number) {
  const [year, value] = month.split('-').map(Number);
  const date = new Date(year, value - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthDates(month: string) {
  const first = `${month}-01`;
  const start = addDays(first, -new Date(startOfDay(first)).getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

/**
 * 各 APP 首頁共用的整月月曆（2026-11-21 使用者決定）。
 * 月曆只負責選日期；各 APP 用 dayInfo 提供自己的簡潔日期標記。
 */
export function MonthCalendar({
  selected,
  setDate,
  dayInfo,
  maxDate,
}: {
  selected: string;
  setDate: (date: string) => void;
  dayInfo?: (date: string) => MonthCalendarDayInfo | null;
  /** 有值時，之後的日期不能選（維持原本不能往未來補記的規則）。 */
  maxDate?: string;
}) {
  const [month, setMonth] = useState(monthOf(selected));
  useEffect(() => setMonth(monthOf(selected)), [selected]);

  const today = todayKey();
  const dates = monthDates(month);
  const nextMonth = shiftMonth(month, 1);
  const nextDisabled = !!maxDate && nextMonth > monthOf(maxDate);
  const goToday = () => {
    setMonth(monthOf(today));
    setDate(today);
  };

  return (
    <section className="card date-calendar-card">
      <div className="date-calendar-nav">
        <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="上個月">
          <Icon name="left" />
        </button>
        <button className="date-calendar-title" onClick={goToday}>
          {month.replace('-', ' 年 ')} 月
          <small>回到今天</small>
        </button>
        <button className="icon-btn" onClick={() => setMonth(nextMonth)} disabled={nextDisabled} aria-label="下個月">
          <Icon name="right" />
        </button>
      </div>
      <div className="date-calendar-grid">
        {WEEK.map((weekday) => <div className="date-calendar-weekday" key={weekday}>{weekday}</div>)}
        {dates.map((date) => {
          const info = dayInfo?.(date) ?? null;
          const disabled = !!maxDate && date > maxDate;
          const outside = !date.startsWith(month);
          const marks = info?.marks?.slice(0, 3) ?? [];
          return (
            <button
              key={date}
              className={[
                'date-calendar-day',
                date === selected && 'selected',
                date === today && 'today',
                outside && 'outside',
              ].filter(Boolean).join(' ')}
              onClick={() => setDate(date)}
              disabled={disabled}
              aria-label={[date, info?.label].filter(Boolean).join('，')}
              title={info?.label}
            >
              <span>{Number(date.slice(8))}</span>
              <span className="date-calendar-marks" aria-hidden="true">
                {marks.map((mark, index) => (
                  <i
                    key={`${mark.label ?? mark.color ?? 'mark'}-${index}`}
                    className={mark.kind === 'bar' ? 'bar' : 'dot'}
                    style={{ '--mark-color': mark.color ?? 'var(--accent)' } as CSSProperties}
                    title={mark.label}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
