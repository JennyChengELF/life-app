/** 一天的時間軸、日期切換（健康總覽、綜合首頁共用）；樣式在 base.css */
import type { TimelineEntry } from '@life/db';
import { addDays, startOfDay, todayKey, toHHmm } from '@life/db';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

export function dateLabel(d: string) {
  const today = todayKey();
  const wd = WEEK[new Date(startOfDay(d)).getDay()];
  const [, m, day] = d.split('-').map(Number);
  const rel = d === today ? '今天' : d === addDays(today, -1) ? '昨天' : '';
  return `${m}/${day}（${wd}）${rel}`;
}

export function DateNav({ date, setDate }: { date: string; setDate: (d: string) => void }) {
  const isToday = date >= todayKey();
  return (
    <div className="date-nav">
      <button className="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="前一天">
        ‹
      </button>
      <span className="date-label">{dateLabel(date)}</span>
      <button className="icon-btn" onClick={() => setDate(addDays(date, 1))} disabled={isToday} aria-label="後一天">
        ›
      </button>
      {!isToday && (
        <button className="link" onClick={() => setDate(todayKey())}>
          回今天
        </button>
      )}
    </div>
  );
}

/** 依時間排好的紀錄；onPick：點一列（修改那一筆） */
export function Timeline({ entries, onPick }: { entries: TimelineEntry[]; onPick: (e: TimelineEntry) => void }) {
  if (entries.length === 0) return <p className="muted center-text">這天沒有紀錄</p>;
  return (
    <ul className="timeline">
      {entries.map((e) => (
        <li key={e.key} onClick={() => onPick(e)} title="點一下修改">
          <span className="tl-time">{e.allDay ? '' : toHHmm(e.time)}</span>
          <span className="tl-icon">{e.icon}</span>
          <span className="tl-main">
            <span className="tl-name">{e.name}</span> <span className="tl-value">{e.value}</span>
            {e.warn && ' ⚠️'}
            {e.extra && <div className="tl-extra">{e.extra}</div>}
            {e.note && <div className="tl-extra">📝 {e.note}</div>}
          </span>
          {e.judge && <span className={`lv ${e.judge.level}`}>{e.judge.label}</span>}
        </li>
      ))}
    </ul>
  );
}
