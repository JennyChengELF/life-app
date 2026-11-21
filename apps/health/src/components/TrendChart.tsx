import { useRef, useState } from 'react';
import { fmtDateTime } from '../format';

export interface Point {
  time: number;
  value: number;
  /** 週／月平均等彙整點可自行提供提示日期文字。 */
  label?: string;
}

export interface Series {
  label: string;
  points: Point[];
}

const W = 480;
const H = 220;
const PAD = { l: 40, r: 10, t: 12, b: 24 };

/** 「好看」的刻度：1、2、5 × 10ⁿ */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const d = Math.abs(min) * 0.05 || 1;
    min -= d;
    max += d;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) ticks.push(Number(v.toFixed(6)));
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

const shortDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/**
 * 趨勢折線圖（滑過 / 點一下看數值）。
 * 一條線用 points；多條線（例：收縮壓、舒張壓）用 series，會顯示圖例。
 * refs：參考線（例：血壓 130 / 80），只畫在資料範圍附近。
 */
export function TrendChart(props: {
  points?: Point[];
  series?: Series[];
  unit: string;
  format: (v: number) => string;
  refs?: { value: number; label: string }[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const series: Series[] = props.series ?? [{ label: '', points: props.points ?? [] }];
  const multi = series.length > 1;
  const all = series.flatMap((s) => s.points);

  if (all.length === 0) return <p className="muted center-text small">這段期間沒有資料</p>;

  // 滑過時對齊的時間點（所有線的時間合在一起）
  const times = [...new Set(all.map((p) => p.time))].sort((a, b) => a - b);
  const t0 = times[0];
  const t1 = times[times.length - 1];
  const vals = all.map((p) => p.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  // 參考線離資料太遠就不畫（避免把圖壓扁）
  const span = Math.max(hi - lo, Math.abs(hi) * 0.1, 1);
  const refs = (props.refs ?? []).filter((r) => r.value >= lo - span * 0.5 && r.value <= hi + span * 0.5);
  const ticks = niceTicks(Math.min(lo, ...refs.map((r) => r.value)), Math.max(hi, ...refs.map((r) => r.value)));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const x = (t: number) => (t1 === t0 ? (PAD.l + W - PAD.r) / 2 : PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);
  const pathOf = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.time).toFixed(1)},${y(p.value).toFixed(1)}`).join('');

  const onMove = (e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    times.forEach((t, i) => {
      if (Math.abs(x(t) - px) < Math.abs(x(times[best]) - px)) best = i;
    });
    setHover(best);
  };

  const ht = hover != null ? times[hover] : null;
  const atHover = ht == null ? [] : series.map((s) => ({ s, p: s.points.find((p) => p.time === ht) ?? null }));
  const unit = props.unit ? ` ${props.unit}` : '';

  return (
    <div className="chart">
      {multi && (
        <div className="legend">
          {series.map((s, i) => (
            <span key={s.label}>
              <i className={`sw s${i + 1}`} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div className="chart-plot">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`趨勢圖，共 ${times.length} 個時間點`}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
              <text className="axis" x={PAD.l - 6} y={y(t) + 4} textAnchor="end">
                {props.format(t)}
              </text>
            </g>
          ))}
          {refs.map((r) => (
            <g key={r.label}>
              <line className="ref" x1={PAD.l} x2={W - PAD.r} y1={y(r.value)} y2={y(r.value)} />
              <text className="ref-label" x={PAD.l + 4} y={y(r.value) - 4} textAnchor="start">
                {r.label}
              </text>
            </g>
          ))}
          <text className="axis" x={PAD.l} y={H - 6} textAnchor="start">
            {shortDate(t0)}
          </text>
          {t1 !== t0 && (
            <text className="axis" x={W - PAD.r} y={H - 6} textAnchor="end">
              {shortDate(t1)}
            </text>
          )}
          {series.map((s, i) => {
            const cls = multi ? ` s${i + 1}` : '';
            const last = s.points[s.points.length - 1];
            return (
              <g key={s.label || i}>
                <path className={`line${cls}`} d={pathOf(s.points)} />
                {s.points.length <= 40 && s.points.map((p) => <circle key={p.time} className={`pt${cls}`} cx={x(p.time)} cy={y(p.value)} r={2.5} />)}
                {last && <circle className={`pt-last${cls}`} cx={x(last.time)} cy={y(last.value)} r={4.5} />}
              </g>
            );
          })}
          {ht != null && (
            <g>
              <line className="cross" x1={x(ht)} x2={x(ht)} y1={PAD.t} y2={H - PAD.b} />
              {atHover.map(({ s, p }, i) => p && <circle key={s.label || i} className={`pt-hover${multi ? ` s${i + 1}` : ''}`} cx={x(p.time)} cy={y(p.value)} r={5} />)}
            </g>
          )}
        </svg>
        {ht != null && (
          <div className="tip" style={{ left: `${(x(ht) / W) * 100}%` }}>
            {atHover.map(
              ({ s, p }, i) =>
                p && (
                  <b key={s.label || i}>
                    {multi && `${s.label} `}
                    {props.format(p.value)}
                    {unit}
                  </b>
                ),
            )}
            <span>{atHover.find(({ p }) => p?.label)?.p?.label ?? fmtDateTime(ht)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
