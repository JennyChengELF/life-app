import { useState } from 'react';
import type { BodyFieldKey, BodyMeasurement, BodyTrendPeriod, HealthSnapshot } from '@life/db';
import { BODY_TIMINGS, bodyField, bodyTrendAverages, bodyValue, previousBodyValue } from '@life/db';
import type { HealthApi } from '../useHealth';
import { fieldLabel, fmt, fmtDateTime } from '../format';
import { TrendChart } from './TrendChart';

const RANGES = [
  { key: 30, label: '30 天' },
  { key: 90, label: '90 天' },
  { key: 365, label: '1 年' },
  { key: 0, label: '全部' },
] as const;

/** 身體分頁：最新數值、趨勢、紀錄 */
export function BodyTab({ api, snap }: { api: HealthApi; snap: HealthSnapshot }) {
  const fields = snap.settings.bodyFields;
  const latest = BODY_TIMINGS.map((timing) => [...snap.body].reverse().find((item) => item.timing === timing) ?? null).filter((item): item is BodyMeasurement => !!item);

  return (
    <div className="body-tab">
      {latest.length ? (
        <>
          <LatestCard snap={snap} latest={latest} fields={fields} />
          <TrendCard snap={snap} fields={fields} />
        </>
      ) : (
        <p className="muted center-text">還沒有身體量測紀錄</p>
      )}
      {api.busy && <p className="muted small center-text">更新中⋯⋯</p>}
    </div>
  );
}

function LatestCard({ snap, latest, fields }: { snap: HealthSnapshot; latest: BodyMeasurement[]; fields: BodyFieldKey[] }) {
  return (
    <section className="card">
      <h2>各時段最近一次</h2>
      {latest.map((measurement) => <div key={measurement.id} className="latest-timing"><div className="sum-head"><b>{measurement.timing}</b><span className="muted small">{fmtDateTime(measurement.time)}</span></div><div className="stat-grid">{fields.map((k) => {
        const v = bodyValue(measurement, k, snap);
        const prev = v == null ? null : previousBodyValue(snap, measurement, k);
        const diff = v != null && prev != null ? Number((v - prev).toFixed(bodyField(k).decimals)) : null;
        return <div key={k} className="stat-tile"><div className="stat-label">{fieldLabel(k)}</div><div className="stat-value">{fmt(k, v)}{bodyField(k).unit && v != null && <small> {bodyField(k).unit}</small>}</div><div className="stat-diff">{v != null && prev == null ? `第一次${measurement.timing}紀錄` : diff == null ? '' : diff === 0 ? '持平' : `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff).toFixed(bodyField(k).decimals)}`}</div></div>;
      })}</div></div>)}
    </section>
  );
}

function TrendCard({ snap, fields }: { snap: HealthSnapshot; fields: BodyFieldKey[] }) {
  const [key, setKey] = useState<BodyFieldKey>(fields[0] ?? 'kg');
  const [range, setRange] = useState<number>(90);
  const [mode, setMode] = useState<'record' | BodyTrendPeriod>('record');
  const k = fields.includes(key) ? key : 'kg';
  const since = range ? Date.now() - range * 86400000 : -Infinity;
  const source = snap.body
    .map((m) => ({ time: m.time, date: m.date, timing: m.timing, value: bodyValue(m, k, snap) }))
    .filter((p): p is typeof p & { value: number } => p.value != null);
  const averages = mode === 'record' ? [] : bodyTrendAverages(source, mode);
  const series = BODY_TIMINGS.map((timing) => ({
    label: timing,
    points: mode === 'record'
      ? source.filter((p) => p.timing === timing && p.time >= since).map((p) => ({ time: p.time, value: p.value }))
      : averages.filter((p) => p.timing === timing && p.time >= since).map((p) => ({
        time: p.time,
        value: p.value,
        label: mode === 'week'
          ? `${shortDate(p.startDate)}～${shortDate(p.endDate)}（${p.days} 天）`
          : `${p.startDate.slice(0, 7).replace('-', '/')}（${p.days} 天）`,
      })),
  }));
  const f = bodyField(k);
  return (
    <section className="card">
      <div className="chart-head">
        <h2>趨勢</h2>
        <div className="seg">
          {RANGES.map((r) => (
            <button key={r.key} className={range === r.key ? 'active' : ''} onClick={() => setRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="seg trend-mode">
        <button className={mode === 'record' ? 'active' : ''} onClick={() => setMode('record')}>每筆</button>
        <button className={mode === 'week' ? 'active' : ''} onClick={() => setMode('week')}>每週平均</button>
        <button className={mode === 'month' ? 'active' : ''} onClick={() => setMode('month')}>每月平均</button>
      </div>
      <div className="chips">
        {fields.map((x) => (
          <button key={x} className={x === k ? 'active' : ''} onClick={() => setKey(x)}>
            {fieldLabel(x)}
          </button>
        ))}
      </div>
      <TrendChart series={series} unit={f.unit} format={(v) => fmt(k, v)} />
      {mode !== 'record' && <p className="muted small">同一天同一時段有多筆時先取當天平均；沒有量的日期不列入平均天數。</p>}
    </section>
  );
}

const shortDate = (date: string) => {
  const [, month, day] = date.split('-').map(Number);
  return `${month}/${day}`;
};
