import { useState } from 'react';
import type { BodyFieldKey, BodyMeasurement, BodyTrendPeriod, HealthSnapshot } from '@life/db';
import { BODY_TIMINGS, bodyField, bodyTrendAverages, bodyValue, HEIGHT_CODE, heightAt, mismatchFields, previousBodyValue } from '@life/db';
import type { HealthApi } from '../useHealth';
import type { Nav } from '../App';
import { fieldLabel, fmt, fmtDateTime, hasTwin } from '../format';
import { TrendChart } from './TrendChart';

const RANGES = [
  { key: 30, label: '30 天' },
  { key: 90, label: '90 天' },
  { key: 365, label: '1 年' },
  { key: 0, label: '全部' },
] as const;

/** 身體分頁：最新數值、趨勢、紀錄 */
export function BodyTab({ api, snap, nav }: { api: HealthApi; snap: HealthSnapshot; nav: Nav }) {
  const fields = snap.settings.bodyFields;
  const latest = snap.body[snap.body.length - 1] ?? null;
  const mismatches = snap.body.filter((m) => mismatchFields(m, snap).length > 0);
  const noHeight = heightAt(snap, Date.now()) == null;
  const heightName = snap.items.find((i) => i.code === HEIGHT_CODE)?.name ?? '身高';

  return (
    <div className="body-tab">
      <div className="messages">
        {mismatches.length > 0 && (
          <button className="msg warn" onClick={() => nav.edit(mismatches[mismatches.length - 1])}>
            ⚠️ 有 {mismatches.length} 筆數值對不起來（BMI 或 % 和 kg），點這裡看{mismatches.length > 1 ? '最新一筆' : ''} ›
          </button>
        )}
        {noHeight && (
          <button className="msg info" onClick={() => nav.occ(heightName)}>
            填身高就能自動算 BMI ›
          </button>
        )}
      </div>

      <button className="primary big full" onClick={() => nav.newBody()}>
        ⚖️ 記一筆身體量測
      </button>

      {latest ? (
        <>
          <LatestCard snap={snap} latest={latest} fields={fields} onEdit={() => nav.edit(latest)} />
          <TrendCard snap={snap} fields={fields} />
          <HistoryCard snap={snap} fields={fields} onEdit={nav.edit} />
        </>
      ) : (
        <p className="muted center-text">還沒有身體量測紀錄</p>
      )}
      {api.busy && <p className="muted small center-text">更新中⋯⋯</p>}
    </div>
  );
}

function LatestCard({ snap, latest, fields, onEdit }: { snap: HealthSnapshot; latest: BodyMeasurement; fields: BodyFieldKey[]; onEdit: () => void }) {
  return (
    <section className="card">
      <div className="chart-head">
        <h2>最新・{latest.timing} · {fmtDateTime(latest.time)}</h2>
        <button className="link" onClick={onEdit}>
          修改
        </button>
      </div>
      <div className="stat-grid">
        {fields.map((k) => {
          const v = bodyValue(latest, k, snap);
          const prev = v == null ? null : previousBodyValue(snap, latest, k);
          const diff = v != null && prev != null ? v - prev : null;
          const f = bodyField(k);
          const shown = diff == null ? null : Number(diff.toFixed(f.decimals));
          return (
            <div key={k} className="stat-tile">
              <div className="stat-label">{fieldLabel(k)}</div>
              <div className="stat-value">
                {fmt(k, v)}
                {f.unit && v != null && <small> {f.unit}</small>}
              </div>
              {v != null && prev == null && <div className="stat-diff">第一次{latest.timing}紀錄</div>}
              {shown != null && (
                <div className="stat-diff">
                  {shown === 0 ? '持平' : `${shown > 0 ? '▲' : '▼'} ${Math.abs(shown).toFixed(f.decimals)}`}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {latest.note && <p className="small muted">📝 {latest.note}</p>}
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

function HistoryCard({ snap, fields, onEdit }: { snap: HealthSnapshot; fields: BodyFieldKey[]; onEdit: (m: BodyMeasurement) => void }) {
  const [limit, setLimit] = useState(20);
  const rows = [...snap.body].reverse();
  return (
    <section className="card">
      <h2>紀錄</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>時間</th>
              <th>時段</th>
              {fields.map((k) => (
                <th key={k}>
                  {fieldLabel(k)}
                  {bodyField(k).unit && !hasTwin(k) && <small> {bodyField(k).unit}</small>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((m) => {
              const warn = mismatchFields(m, snap);
              return (
                <tr key={m.id} onClick={() => onEdit(m)} title="點一下修改">
                  <td className="nowrap">
                    {fmtDateTime(m.time)}
                    {m.note && ' 📝'}
                  </td>
                  <td className="nowrap">{m.timing}</td>
                  {fields.map((k) => (
                    <td key={k} className="num">
                      {fmt(k, bodyValue(m, k, snap))}
                      {warn.includes(k) && ' ⚠️'}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <button className="link" onClick={() => setLimit(limit + 50)}>
          顯示更多（還有 {rows.length - limit} 筆）
        </button>
      )}
    </section>
  );
}

const shortDate = (date: string) => {
  const [, month, day] = date.split('-').map(Number);
  return `${month}/${day}`;
};
