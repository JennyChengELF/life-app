import { useState } from 'react';
import type { BowelSnapshot, BowelType } from '@life/db';
import { addDays, bowelStats, todayKey, typeLabel } from '@life/db';
import { TypeIcon } from './icons';

/** 統計：近 7 / 30 天；整月日曆已移到獨立的日曆分頁。 */
export function StatsView({ snap }: { snap: BowelSnapshot }) {
  const today = todayKey();
  const [range, setRange] = useState<7 | 30>(7);
  const s = bowelStats(snap.logs, addDays(today, -(range - 1)), today);
  const typeRows: { type: BowelType | null; count: number }[] = [...s.types, { type: null, count: s.noType }];
  const maxCount = Math.max(1, ...typeRows.map((r) => r.count));

  return (
    <div className="stats">
      <section className="card">
        <div className="chart-head">
          <h2>最近 {range} 天</h2>
          <div className="seg">
            {([7, 30] as const).map((r) => (
              <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>
                {r} 天
              </button>
            ))}
          </div>
        </div>
        <div className="stat-grid">
          <Stat label="排便次數" value={s.count} unit="次" />
          <Stat label="有排便的天數" value={s.days} unit={`/ ${s.totalDays} 天`} />
          <Stat label="平均每天" value={Math.round((s.count / s.totalDays) * 10) / 10} unit="次" />
          <Stat label="有便意沒排出" value={s.notPassed} unit="次" />
        </div>
        <h2 className="sub">型態分布</h2>
        {s.count === 0 ? (
          <p className="muted">這段時間沒有排便紀錄</p>
        ) : (
          <ul className="dist">
            {typeRows.map((r) => (
              <li key={r.type ?? 'none'} title={`${r.type ? typeLabel(r.type) : '沒填型態'}：${r.count} 次`}>
                <span className="dist-label">
                  {r.type && <TypeIcon type={r.type} />}
                  {r.type ? typeLabel(r.type) : '沒填型態'}
                </span>
                <span className="dist-bar">
                  <i style={{ width: `${(r.count / maxCount) * 100}%` }} />
                </span>
                <span className="dist-num">{r.count}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">複選型態的每個都算一次；3–5 型是正常範圍。</p>
      </section>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value} <small>{unit}</small>
      </div>
    </div>
  );
}
