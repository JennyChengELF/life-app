import { useState } from 'react';
import type { BodyFieldKey, BodyMeasurement, HealthSnapshot } from '@life/db';
import { bodyField, bodyValue, HEIGHT_CODE, heightAt, mismatchFields } from '@life/db';
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

export function OverviewView({ api, snap, nav }: { api: HealthApi; snap: HealthSnapshot; nav: Nav }) {
  const fields = snap.settings.bodyFields;
  const latest = snap.body[snap.body.length - 1] ?? null;
  const mismatches = snap.body.filter((m) => mismatchFields(m, snap).length > 0);
  const noHeight = heightAt(snap, Date.now()) == null;
  const heightName = snap.items.find((i) => i.code === HEIGHT_CODE)?.name ?? '身高';

  return (
    <div className="overview">
      <div className="messages">
        {snap.issues.length > 0 && (
          <button className="msg warn" onClick={() => nav.go('issues')}>
            ⚠️ 健康試算表有 {snap.issues.length} 筆資料需要補齊 ›
          </button>
        )}
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

      <button className="primary big full" onClick={nav.newBody}>
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

/** 前一筆有這個項目的紀錄 */
function previousValue(snap: HealthSnapshot, m: BodyMeasurement, key: BodyFieldKey): number | null {
  const idx = snap.body.indexOf(m);
  for (let i = idx - 1; i >= 0; i--) {
    const v = bodyValue(snap.body[i], key, snap);
    if (v != null) return v;
  }
  return null;
}

function LatestCard({ snap, latest, fields, onEdit }: { snap: HealthSnapshot; latest: BodyMeasurement; fields: BodyFieldKey[]; onEdit: () => void }) {
  return (
    <section className="card">
      <div className="chart-head">
        <h2>最新 · {fmtDateTime(latest.time)}</h2>
        <button className="link" onClick={onEdit}>
          修改
        </button>
      </div>
      <div className="stat-grid">
        {fields.map((k) => {
          const v = bodyValue(latest, k, snap);
          const prev = v == null ? null : previousValue(snap, latest, k);
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
  const k = fields.includes(key) ? key : 'kg';
  const since = range ? Date.now() - range * 86400000 : -Infinity;
  const points = snap.body
    .filter((m) => m.time >= since)
    .map((m) => ({ time: m.time, value: bodyValue(m, k, snap) }))
    .filter((p): p is { time: number; value: number } => p.value != null);
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
      <div className="chips">
        {fields.map((x) => (
          <button key={x} className={x === k ? 'active' : ''} onClick={() => setKey(x)}>
            {fieldLabel(x)}
          </button>
        ))}
      </div>
      <TrendChart points={points} unit={f.unit} format={(v) => fmt(k, v)} />
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
