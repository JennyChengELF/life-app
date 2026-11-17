import { useRef, useState } from 'react';
import { fmtDateTime } from '../format';

export interface Point {
  time: number;
  value: number;
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

/** 單一項目的趨勢折線圖（滑過 / 點一下看數值） */
export function TrendChart({ points, unit, format }: { points: Point[]; unit: string; format: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (points.length === 0) return <p className="muted center-text small">這段期間沒有資料</p>;

  const t0 = points[0].time;
  const t1 = points[points.length - 1].time;
  const vals = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const x = (t: number) => (t1 === t0 ? (PAD.l + W - PAD.r) / 2 : PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.time).toFixed(1)},${y(p.value).toFixed(1)}`).join('');

  const onMove = (e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.time) - px) < Math.abs(x(points[best].time) - px)) best = i;
    });
    setHover(best);
  };

  const h = hover != null ? points[hover] : null;
  const last = points[points.length - 1];

  return (
    <div className="chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`趨勢圖，共 ${points.length} 筆`}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
            <text className="axis" x={PAD.l - 6} y={y(t) + 4} textAnchor="end">
              {format(t)}
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
        <path className="line" d={path} />
        {points.length <= 40 && points.map((p) => <circle key={p.time} className="pt" cx={x(p.time)} cy={y(p.value)} r={2.5} />)}
        <circle className="pt-last" cx={x(last.time)} cy={y(last.value)} r={4.5} />
        {h && (
          <g>
            <line className="cross" x1={x(h.time)} x2={x(h.time)} y1={PAD.t} y2={H - PAD.b} />
            <circle className="pt-hover" cx={x(h.time)} cy={y(h.value)} r={5} />
          </g>
        )}
      </svg>
      {h && (
        <div className="tip" style={{ left: `${(x(h.time) / W) * 100}%` }}>
          <b>
            {format(h.value)}
            {unit && ` ${unit}`}
          </b>
          <span>{fmtDateTime(h.time)}</span>
        </div>
      )}
    </div>
  );
}
