import { useState } from 'react';
import type { HealthSnapshot } from '@life/db';
import { startOfDay, toDateKey, toHHmm } from '@life/db';
import { TimeField } from '@life/ui/time-field';
import type { HealthApi } from '../useHealth';
import { parseNum } from '../format';
import { TrendChart } from './TrendChart';
import { sinceOf } from './vital';

const fmtVal = (v: number) => String(Number(v.toFixed(2)));

/** 身體尺寸：身高、圍度⋯⋯（一個項目一列） */
export function OccView({ api, snap, focusItem, mode = 'add', initialTime, onDone }: { api: HealthApi; snap: HealthSnapshot; focusItem: string | null; mode?: 'add' | 'stats'; initialTime?: number; onDone?: () => void }) {
  return (
    <div className="occ">
      {mode === 'add' && <OccForm api={api} snap={snap} focusItem={focusItem} initialTime={initialTime} onDone={onDone} />}
      {mode === 'stats' && <><LatestCard snap={snap} /><OccTrend snap={snap} /></>}
    </div>
  );
}
function OccForm({ api, snap, focusItem, initialTime, onDone }: { api: HealthApi; snap: HealthSnapshot; focusItem: string | null; initialTime?: number; onDone?: () => void }) {
  const initial = initialTime ?? Date.now();
  const [date, setDate] = useState(toDateKey(initial));
  const [time, setTime] = useState(toHHmm(initial));
  const [vals, setVals] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');

  const save = async () => {
    const [hour, minute] = time.split(':').map(Number);
    const value = new Date(startOfDay(date));
    value.setHours(hour, minute, 0, 0);
    const t = value.getTime();
    if (!Number.isFinite(t)) return api.showToast({ kind: 'error', text: '請輸入時間' });
    const entries: { item: string; value: number }[] = [];
    for (const i of snap.items) {
      const n = parseNum(vals[i.name] ?? '');
      if (n == null) continue;
      if (Number.isNaN(n) || n <= 0) return api.showToast({ kind: 'error', text: `${i.name}的數值不合理` });
      entries.push({ item: i.name, value: n });
    }
    if (!entries.length) return api.showToast({ kind: 'error', text: '請至少填一個項目' });
    const ok = await api.run((s) => s.addOcc(entries, t, note).then(() => true));
    if (ok) {
      setVals({});
      setNote('');
      api.showToast({ kind: 'info', text: `已記錄 ${entries.map((e) => e.item).join('、')}` });
      onDone?.();
    }
  };

  return (
    <section className="card">
      <h2>記錄身體尺寸</h2>
      <p className="muted small">有量的才填，沒量的空著。項目可以在「設定」新增。</p>
      <label className="field">量測日期<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <TimeField value={time} onChange={setTime} label="量的時間" />
      <div className="form-grid">
        {snap.items.map((i) => (
          <label key={i.id} className="field">
            {i.name}
            <div className="input-unit">
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={vals[i.name] ?? ''}
                onChange={(e) => setVals((v) => ({ ...v, [i.name]: e.target.value }))}
                autoFocus={i.name === focusItem}
              />
              {i.unit && <span className="unit">{i.unit}</span>}
            </div>
          </label>
        ))}
      </div>
      <label className="field">
        備註
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="editor-actions"><button className="primary big" onClick={save} disabled={api.busy}>儲存</button>{onDone && <button type="button" onClick={onDone}>取消</button>}</div>
    </section>
  );
}
function OccTrend({ snap }: { snap: HealthSnapshot }) {
  const names = snap.items.filter((item) => snap.occ.some((record) => record.item === item.name));
  const [item, setItem] = useState(names[0]?.name ?? '');
  const [range, setRange] = useState(365);
  if (!names.length) return null;
  const selected = names.some((entry) => entry.name === item) ? item : names[0].name;
  const unit = names.find((entry) => entry.name === selected)?.unit ?? '';
  const points = snap.occ.filter((record) => record.item === selected && record.time >= sinceOf(range)).map((record) => ({ time: record.time, value: record.value }));
  return <section className="card"><div className="chart-head"><h2>趨勢</h2><div className="seg">{([90, 365, 0] as const).map((days) => <button key={days} className={range === days ? 'active' : ''} onClick={() => setRange(days)}>{days === 0 ? '全部' : days === 365 ? '1 年' : '90 天'}</button>)}</div></div><div className="chips">{names.map((entry) => <button key={entry.id} className={entry.name === selected ? 'active' : ''} onClick={() => setItem(entry.name)}>{entry.name}</button>)}</div><TrendChart points={points} unit={unit} format={(value) => String(Number(value.toFixed(2)))} /></section>;
}
/** 各項目最新的值和上一次比較 */
function LatestCard({ snap }: { snap: HealthSnapshot }) {
  const rows = snap.items
    .map((i) => {
      const list = snap.occ.filter((o) => o.item === i.name);
      return { i, last: list[list.length - 1], prev: list[list.length - 2] };
    })
    .filter((r) => r.last);
  if (!rows.length) return null;
  return (
    <section className="card">
      <h2>各項目最新</h2>
      <table className="data-table">
        <tbody>
          {rows.map(({ i, last, prev }) => {
            const diff = prev ? Number((last.value - prev.value).toFixed(2)) : null;
            return (
              <tr key={i.id}>
                <td>{i.name}</td>
                <td className="num">
                  <b>{fmtVal(last.value)}</b> <small className="muted">{i.unit}</small>
                </td>
                <td className="muted small">{diff == null ? '' : diff === 0 ? '持平' : `${diff > 0 ? '▲' : '▼'} ${fmtVal(Math.abs(diff))}`}</td>
                <td className="muted small nowrap">{last.date.replace(/-/g, '/')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
