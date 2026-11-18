import { useState } from 'react';
import type { BowelSnapshot, BowelType, CalendarDay } from '@life/db';
import { addDays, bowelMonth, bowelStats, todayKey, typeLabel } from '@life/db';
import { TypeIcon } from './icons';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const LEVEL_TEXT = { ok: '正常', warn: '注意', bad: '異常' } as const;

function shiftMonth(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function dayTitle(c: CalendarDay) {
  const [, m, d] = c.date.split('-').map(Number);
  if (c.onlyNotPassed) return `${m}/${d} 有便意沒排出`;
  if (!c.count) return `${m}/${d} 沒有排便`;
  return `${m}/${d} 排便 ${c.count} 次${c.level ? `，${LEVEL_TEXT[c.level]}` : ''}`;
}

/** 統計：月曆＋近 7 / 30 天（2026-11-18 確認；不做趨勢圖） */
export function StatsView({ snap, openDay }: { snap: BowelSnapshot; openDay: (date: string) => void }) {
  const today = todayKey();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [range, setRange] = useState<7 | 30>(7);
  const days = bowelMonth(snap.logs, month);
  const lead = new Date(`${month}-01T00:00`).getDay();
  const s = bowelStats(snap.logs, addDays(today, -(range - 1)), today);
  const typeRows: { type: BowelType | null; count: number }[] = [...s.types, { type: null, count: s.noType }];
  const maxCount = Math.max(1, ...typeRows.map((r) => r.count));
  const [y, m] = month.split('-').map(Number);

  return (
    <div className="stats">
      <section className="card">
        <div className="month-nav">
          <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="上個月">
            ‹
          </button>
          <span className="date-label">
            {y} 年 {m} 月
          </span>
          <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= today.slice(0, 7)} aria-label="下個月">
            ›
          </button>
        </div>
        <div className="cal" role="grid">
          {WEEK.map((w) => (
            <div key={w} className="cal-head">
              {w}
            </div>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <div key={`e${i}`} />
          ))}
          {days.map((c) => {
            const future = c.date > today;
            const mark = c.onlyNotPassed ? 'ring' : c.count ? (c.level ?? 'none') : '';
            return (
              <button key={c.date} className={`cal-day${c.date === today ? ' today' : ''}`} disabled={future} onClick={() => openDay(c.date)} title={dayTitle(c)} aria-label={dayTitle(c)}>
                <span className="cal-num">{Number(c.date.slice(8))}</span>
                {!future && <span className={`cal-dot ${mark}`}>{c.count > 1 ? c.count : ''}</span>}
              </button>
            );
          })}
        </div>
        <div className="cal-legend">
          <span>
            <i className="cal-dot ok" />
            正常
          </span>
          <span>
            <i className="cal-dot warn" />
            注意
          </span>
          <span>
            <i className="cal-dot bad" />
            異常
          </span>
          <span>
            <i className="cal-dot none" />
            沒填型態
          </span>
          <span>
            <i className="cal-dot ring" />
            沒排出
          </span>
        </div>
        <p className="muted small">每天的顏色用那天最嚴重的一次；數字是次數。點一天看那天的紀錄。</p>
      </section>

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
