import { useState } from 'react';
import type { WaterSnapshot } from '@life/db';
import { addDays, todayKey } from '@life/db';

const RANGES = [14, 30, 90];

export function StatsView({ snap, onPickDate }: { snap: WaterSnapshot; onPickDate: (d: string) => void }) {
  const [range, setRange] = useState(14);
  const today = todayKey();

  const dates = Array.from({ length: range }, (_, i) => addDays(today, i - range + 1));
  const rows = dates.map((d) => {
    const day = snap.days.get(d);
    return { date: d, total: day?.total ?? 0, goal: day?.goal ?? null, achieved: day?.achieved ?? false };
  });
  const max = Math.max(1, ...rows.map((r) => Math.max(r.total, r.goal ?? 0)));

  // 統計只算「有目標紀錄」的天（開始使用之後）
  const tracked = rows.filter((r) => r.goal != null);
  const achievedDays = tracked.filter((r) => r.achieved).length;
  const avg = tracked.length ? Math.round(tracked.reduce((s, r) => s + r.total, 0) / tracked.length) : 0;

  const month = today.slice(0, 7);
  const monthDays = [...snap.days.values()].filter((d) => d.date.startsWith(month) && d.date <= today);
  const monthAchieved = monthDays.filter((d) => d.achieved).length;

  return (
    <div className="stats">
      <div className="summary">
        <div className="card stat">
          <div className="stat-num">
            {monthAchieved}
            <small> / {monthDays.length} 天</small>
          </div>
          <div className="muted small">本月達標</div>
        </div>
        <div className="card stat">
          <div className="stat-num">
            {achievedDays}
            <small> / {tracked.length} 天</small>
          </div>
          <div className="muted small">近 {range} 天達標</div>
        </div>
        <div className="card stat">
          <div className="stat-num">
            {avg.toLocaleString()}
            <small> ml</small>
          </div>
          <div className="muted small">近 {range} 天平均</div>
        </div>
      </div>

      <section className="card">
        <div className="chart-head">
          <h2>每日喝水量</h2>
          <div className="seg">
            {RANGES.map((r) => (
              <button key={r} className={r === range ? 'active' : ''} onClick={() => setRange(r)}>
                {r} 天
              </button>
            ))}
          </div>
        </div>
        <div className={`bars n${range}`}>
          {rows.map((r) => (
            <button
              key={r.date}
              className="bar-col"
              onClick={() => onPickDate(r.date)}
              title={`${r.date}：${r.total} ml${r.goal ? ` / 目標 ${r.goal}` : ''}`}
            >
              <div className="bar-area">
                {r.goal != null && <div className="goal-mark" style={{ bottom: `${(r.goal / max) * 100}%` }} />}
                <div className={`bar ${r.achieved ? 'done' : ''}`} style={{ height: `${(r.total / max) * 100}%` }} />
              </div>
              <span className="bar-label">{Number(r.date.slice(8))}</span>
            </button>
          ))}
        </div>
        <p className="muted small">
          <span className="legend done" /> 達標　<span className="legend" /> 未達標　<span className="legend goal" /> 當天目標　（點長條可看那天的紀錄）
        </p>
      </section>
    </div>
  );
}
