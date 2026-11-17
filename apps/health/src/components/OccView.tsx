import { useState } from 'react';
import type { HealthSnapshot, OccItem, OccMeasurement } from '@life/db';
import { toInputDateTime } from '@life/db';
import type { HealthApi } from '../useHealth';
import { fmtDateTime, parseNum } from '../format';

const fmtVal = (v: number) => String(Number(v.toFixed(2)));

/** 偶爾量測：身高、圍度⋯⋯（一個項目一列） */
export function OccView({ api, snap, focusItem }: { api: HealthApi; snap: HealthSnapshot; focusItem: string | null }) {
  return (
    <div className="occ">
      <OccForm api={api} snap={snap} focusItem={focusItem} />
      <LatestCard snap={snap} />
      <HistoryCard api={api} snap={snap} />
    </div>
  );
}

function OccForm({ api, snap, focusItem }: { api: HealthApi; snap: HealthSnapshot; focusItem: string | null }) {
  const [time, setTime] = useState(toInputDateTime(Date.now()));
  const [vals, setVals] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');

  const save = async () => {
    const t = new Date(time).getTime();
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
    }
  };

  return (
    <section className="card">
      <h2>記錄偶爾量測</h2>
      <p className="muted small">有量的才填，沒量的空著。項目可以在「設定」新增。</p>
      <label className="field">
        量的時間
        <input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
      </label>
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
      <button className="primary big" onClick={save} disabled={api.busy}>
        儲存
      </button>
    </section>
  );
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

/** 依時間分組（同一個時間 = 同一次量的） */
function HistoryCard({ api, snap }: { api: HealthApi; snap: HealthSnapshot }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [limit, setLimit] = useState(15);
  const groups = new Map<number, OccMeasurement[]>();
  for (const o of [...snap.occ].reverse()) groups.set(o.time, [...(groups.get(o.time) ?? []), o]);
  const list = [...groups.entries()];
  if (!list.length) return null;
  const unitOf = (name: string) => snap.items.find((i: OccItem) => i.name === name)?.unit ?? '';
  return (
    <section className="card">
      <h2>紀錄</h2>
      <ul className="log-list">
        {list.slice(0, limit).map(([time, os]) => (
          <li key={time} className="occ-group">
            <div className="log-time">{fmtDateTime(time)}</div>
            <div className="occ-values">
              {os.map((o) =>
                editing === o.id ? (
                  <OccEditor
                    key={o.id}
                    o={o}
                    unit={unitOf(o.item)}
                    onSave={(value) => {
                      setEditing(null);
                      api.run((s) => s.updateOcc(o, { value }));
                    }}
                    onDelete={() => {
                      setEditing(null);
                      api.run((s) => s.deleteOcc(o));
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <button key={o.id} className="chip" onClick={() => setEditing(o.id)} title="點一下修改">
                    {o.item} <b>{fmtVal(o.value)}</b>
                    {unitOf(o.item) && <small> {unitOf(o.item)}</small>}
                  </button>
                ),
              )}
            </div>
            {os[0].note && <div className="small muted">📝 {os[0].note}</div>}
          </li>
        ))}
      </ul>
      {list.length > limit && (
        <button className="link" onClick={() => setLimit(limit + 30)}>
          顯示更多
        </button>
      )}
    </section>
  );
}

function OccEditor(props: { o: OccMeasurement; unit: string; onSave: (v: number) => void; onDelete: () => void; onCancel: () => void }) {
  const [v, setV] = useState(String(props.o.value));
  const n = Number(v);
  return (
    <div className="editor occ-editor">
      <span>{props.o.item}</span>
      <input type="number" inputMode="decimal" step="0.1" value={v} onChange={(e) => setV(e.target.value)} className="narrow" autoFocus />
      <span className="muted">{props.unit}</span>
      <button className="primary" onClick={() => props.onSave(n)} disabled={!(n > 0)}>
        儲存
      </button>
      <button onClick={props.onCancel}>取消</button>
      <button className="danger" onClick={() => confirm(`刪除這筆${props.o.item}？`) && props.onDelete()}>
        刪除
      </button>
    </div>
  );
}
