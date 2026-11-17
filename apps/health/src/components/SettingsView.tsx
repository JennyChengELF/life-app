import { useState } from 'react';
import type { BodyFieldKey, HealthSnapshot, OccItem } from '@life/db';
import { BODY_FIELDS, bodyField, HEIGHT_CODE } from '@life/db';
import type { HealthApi } from '../useHealth';
import { fieldLabel, hasTwin } from '../format';

export function SettingsView({ api, snap }: { api: HealthApi; snap: HealthSnapshot }) {
  return (
    <div className="settings">
      <FieldsCard api={api} snap={snap} />
      <ItemsCard api={api} snap={snap} />
      <DataCard api={api} />
      <p className="muted small center-text">數值僅供記錄參考，不能取代醫療建議。</p>
    </div>
  );
}

const move = <T,>(arr: T[], i: number, d: number): T[] => {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const a = [...arr];
  [a[i], a[j]] = [a[j], a[i]];
  return a;
};

/** 身體量測：顯示哪些項目、順序 */
function FieldsCard({ api, snap }: { api: HealthApi; snap: HealthSnapshot }) {
  const saved = snap.settings.bodyFields;
  const initial = () => {
    const rest = BODY_FIELDS.map((f) => f.key).filter((k) => !saved.includes(k));
    return { order: [...saved, ...rest], on: new Set(saved) };
  };
  const [state, setState] = useState(initial);
  const result = state.order.filter((k) => state.on.has(k));
  const changed = result.join(',') !== saved.join(',');

  const toggle = (k: BodyFieldKey) =>
    setState((s) => {
      const on = new Set(s.on);
      if (on.has(k)) on.delete(k);
      else on.add(k);
      return { ...s, on };
    });

  return (
    <section className="card">
      <h2>身體量測：顯示的項目</h2>
      <p className="muted small">打勾的項目會出現在輸入畫面、總覽和紀錄，依這裡的順序排列。沒打勾的收在輸入畫面的「更多」。</p>
      <ul className="order-list">
        {state.order.map((k, i) => (
          <li key={k} className={state.on.has(k) ? '' : 'off'}>
            <label className="check">
              <input type="checkbox" checked={state.on.has(k)} disabled={k === 'kg'} onChange={() => toggle(k)} />
              {fieldLabel(k)}
              {bodyField(k).unit && !hasTwin(k) && <span className="muted small">（{bodyField(k).unit}）</span>}
              {k === 'kg' && <span className="muted small">（必填，一定顯示）</span>}
              {k === 'bmi' && <span className="muted small">（用身高自動算）</span>}
            </label>
            <button className="icon-small" onClick={() => setState((s) => ({ ...s, order: move(s.order, i, -1) }))} disabled={i === 0} aria-label="往上">
              ↑
            </button>
            <button
              className="icon-small"
              onClick={() => setState((s) => ({ ...s, order: move(s.order, i, 1) }))}
              disabled={i === state.order.length - 1}
              aria-label="往下"
            >
              ↓
            </button>
          </li>
        ))}
      </ul>
      <div className="editor-actions">
        <button
          className="primary"
          disabled={!changed || api.busy}
          onClick={async () => {
            await api.run((s) => s.saveBodyFields(result));
            api.showToast({ kind: 'info', text: '已儲存' });
          }}
        >
          儲存
        </button>
        {changed && <button onClick={() => setState(initial())}>還原</button>}
      </div>
    </section>
  );
}

/** 偶爾量測的項目清單 */
function ItemsCard({ api, snap }: { api: HealthApi; snap: HealthSnapshot }) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('cm');
  const [editing, setEditing] = useState<string | null>(null);

  const add = async () => {
    if (!name.trim()) return;
    const ok = await api.run((s) => s.addItem(name, unit, snap.items).then(() => true));
    if (ok) setName('');
  };

  return (
    <section className="card">
      <h2>偶爾量測的項目</h2>
      <p className="muted small">身高、圍度等久久量一次的項目。可以自己新增（例：頸圍）。</p>
      <ul className="order-list">
        {snap.items.map((it, i) =>
          editing === it.id ? (
            <ItemEditor
              key={it.id}
              item={it}
              onSave={(patch) => {
                setEditing(null);
                api.run((s) => s.updateItem(it, patch, snap.items));
              }}
              onDelete={() => {
                setEditing(null);
                api.run((s) => s.deleteItem(it, snap.occ));
              }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <li key={it.id}>
              <span className="grow">
                {it.name} {it.unit && <span className="muted small">（{it.unit}）</span>}
                {it.code === HEIGHT_CODE && <span className="muted small"> · 用來算 BMI</span>}
              </span>
              <button className="link" onClick={() => setEditing(it.id)}>
                修改
              </button>
              <button className="icon-small" onClick={() => api.run((s) => s.reorderItems(move(snap.items, i, -1)))} disabled={i === 0 || api.busy} aria-label="往上">
                ↑
              </button>
              <button
                className="icon-small"
                onClick={() => api.run((s) => s.reorderItems(move(snap.items, i, 1)))}
                disabled={i === snap.items.length - 1 || api.busy}
                aria-label="往下"
              >
                ↓
              </button>
            </li>
          ),
        )}
      </ul>
      <div className="row">
        <input placeholder="新增項目（例：頸圍）" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <input placeholder="單位" value={unit} onChange={(e) => setUnit(e.target.value)} className="narrow" />
        <button className="primary" onClick={add} disabled={!name.trim()}>
          新增
        </button>
      </div>
    </section>
  );
}

function ItemEditor(props: { item: OccItem; onSave: (p: { name: string; unit: string }) => void; onDelete: () => void; onCancel: () => void }) {
  const [name, setName] = useState(props.item.name);
  const [unit, setUnit] = useState(props.item.unit);
  return (
    <li className="editor">
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <input value={unit} onChange={(e) => setUnit(e.target.value)} className="narrow" placeholder="單位" />
      </div>
      <p className="muted small">改名稱的話，已記的紀錄也會一起改。</p>
      <div className="editor-actions">
        <button className="primary" onClick={() => props.onSave({ name, unit })} disabled={!name.trim()}>
          儲存
        </button>
        <button onClick={props.onCancel}>取消</button>
        {props.item.code !== HEIGHT_CODE && (
          <button className="danger" onClick={props.onDelete}>
            刪除
          </button>
        )}
      </div>
    </li>
  );
}

function DataCard({ api }: { api: HealthApi }) {
  const health = api.fileUrl('health');
  return (
    <section className="card">
      <h2>資料</h2>
      {api.mode === 'local' ? (
        <p className="muted">本機測試模式：資料只存在這個瀏覽器。設定好 Google 後會改存到你的 Google 試算表。</p>
      ) : (
        <>
          <p className="muted small">
            資料存在你的 Google 試算表「生活APP-健康」。可以直接在試算表最下方新增：身體量測只要填 time 和 kg；偶爾量測填 time、item（項目名稱）、value。APP 打開或重新整理時會自動補齊。
          </p>
          {health && (
            <a className="btn" href={health} target="_blank" rel="noreferrer">
              開啟健康試算表 ↗
            </a>
          )}
          <div>
            <button className="link danger-text" onClick={api.signOut}>
              中斷 Google 連線
            </button>
          </div>
        </>
      )}
    </section>
  );
}
