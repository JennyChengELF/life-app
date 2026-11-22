import { addDays, startOfDay, todayKey } from '@life/db';
import { Icon } from './Icon';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function weekStart(date: string) {
  return addDays(date, -new Date(startOfDay(date)).getDay());
}

/** 新增頁共用的一週日期列（星期日至星期六）。 */
export function WeekDateStrip({
  selected,
  setDate,
  maxDate,
}: {
  selected: string;
  setDate: (date: string) => void;
  maxDate?: string;
}) {
  const today = todayKey();
  const start = weekStart(selected);
  const dates = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const nextStart = addDays(start, 7);
  const nextDisabled = !!maxDate && nextStart > weekStart(maxDate);

  return (
    <section className="week-strip-card" aria-label="選擇記錄日期">
      <div className="week-strip-head">
        <button type="button" className="icon-btn" onClick={() => setDate(addDays(selected, -7))} aria-label="上一週">
          <Icon name="left" />
        </button>
        <strong>{start.slice(0, 7).replace('-', ' 年 ')} 月</strong>
        <button type="button" className="icon-btn" onClick={() => setDate(addDays(selected, 7))} disabled={nextDisabled} aria-label="下一週">
          <Icon name="right" />
        </button>
      </div>
      <div className="week-strip-days">
        {dates.map((date, index) => {
          const disabled = !!maxDate && date > maxDate;
          return (
            <button
              type="button"
              key={date}
              className={[date === selected && 'selected', date === today && 'today'].filter(Boolean).join(' ')}
              disabled={disabled}
              onClick={() => setDate(date)}
              aria-label={`${date} 星期${WEEK[index]}`}
            >
              <small>{WEEK[index]}</small>
              <span>{Number(date.slice(8))}</span>
            </button>
          );
        })}
      </div>
      {selected !== today && (
        <button type="button" className="link week-strip-today" onClick={() => setDate(today)}>回今天</button>
      )}
    </section>
  );
}
