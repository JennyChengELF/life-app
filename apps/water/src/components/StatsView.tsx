import { useState } from 'react';
import type { WaterSnapshot } from '@life/db';
import { addDays, drinkOf, todayKey } from '@life/db';
import { drinkColor, totalsByDrink } from '../drinkColors';

const RANGES = [14, 30, 90];

export function StatsView({ snap, onPickDate }: { snap: WaterSnapshot; onPickDate: (d: string) => void }) {
  const [range, setRange] = useState(14);
  const today = todayKey();

  const dates = Array.from({ length: range }, (_, i) => addDays(today, i - range + 1));
  const first = dates[0];
  const items = snap.logs.filter((l) => l.date >= first && l.date <= today).map((l) => ({ date: l.date, drink: drinkOf(l, snap.drinks), ml: l.ml }));
  const rows = dates.map((d) => {
    const day = snap.days.get(d);
    const parts = totalsByDrink(items.filter((it) => it.date === d), snap.drinks);
    return { date: d, total: day?.total ?? 0, goal: day?.goal ?? null, achieved: day?.achieved ?? false, parts };
  });
  const rangeByDrink = totalsByDrink(items, snap.drinks);
  const rangeTotal = rangeByDrink.reduce((s, b) => s + b.ml, 0);
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
                <div className="bar" style={{ height: `${(r.total / max) * 100}%` }}>
                  {r.parts.map((p) => (
                    <div key={p.drink} style={{ flexGrow: p.ml, background: drinkColor(p.drink, snap.drinks) }} />
                  ))}
                </div>
              </div>
              <span className={`bar-label ${r.achieved ? 'done' : ''}`}>{r.achieved ? '✓' : Number(r.date.slice(8))}</span>
            </button>
          ))}
        </div>
        <p className="muted small legend-row">
          {rangeByDrink.map((b) => (
            <span key={b.drink}>
              <i className="dot" style={{ background: drinkColor(b.drink, snap.drinks) }} />
              {b.drink}
            </span>
          ))}
          <span>
            <span className="legend goal" /> 當天目標
          </span>
          <span className="ok-text">✓ 達標</span>
        </p>
        <p className="muted small">點長條可看那天的紀錄</p>
      </section>

      {rangeTotal > 0 && (
        <section className="card">
          <h2>近 {range} 天喝了什麼</h2>
          <ul className="drink-share">
            {rangeByDrink.map((b) => (
              <li key={b.drink}>
                <span className="drink-tag">
                  <i className="dot" style={{ background: drinkColor(b.drink, snap.drinks) }} />
                  {b.drink}
                </span>
                <span className="share-bar">
                  <span style={{ width: `${(b.ml / rangeTotal) * 100}%`, background: drinkColor(b.drink, snap.drinks) }} />
                </span>
                <span className="share-num">
                  {b.ml.toLocaleString()} ml<small>（{Math.round((b.ml / rangeTotal) * 100)}%）</small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
