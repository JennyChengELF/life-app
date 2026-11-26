import { useState } from 'react';
import { defaultMedMode, MED_KINDS, MED_MODES, newId, type MedItem, type MedItemInput, type MedMode, type MedSnapshot } from '@life/db';
import { Icon } from '@life/ui/icon';
import { BatchFields, blankBatch, QuantityField } from './StockFields';
import type { MedApi } from './useMeds';

const modeLabels: Record<MedMode, string> = { batch: '分批管理', total: '直接累加', none: '只記服用' };

export function Inventory({ api, snap, edit, open, close }: {
  api: MedApi; snap: MedSnapshot; edit: string | null; open: (id: string) => void; close: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const item = snap.items.find(({ id }) => id === selected);
  const current = snap.items.find(({ id }) => id === edit);
  return <>
    {edit != null ? <ItemEditor key={edit} api={api} item={current} onClose={close} /> : <>
      <section className="card">
        <div className="med-row"><h2>藥品與庫存</h2><button className="primary" onClick={() => open('new')}><Icon name="plus" size={17} /> 新增品項</button></div>
        {snap.items.length === 0 ? <p className="muted">先新增要記錄的藥品或保健品。</p> : <ul className="med-list">
          {snap.items.map((entry) => <li key={entry.id}>
            <button type="button" className="med-list-button" onClick={() => setSelected(entry.id === selected ? null : entry.id)} aria-expanded={selected === entry.id}>
              <span><strong>{entry.name}</strong><small>{entry.kind} · {modeLabels[entry.mode]}</small></span>
              {entry.remaining != null && <span className={entry.remaining <= 0 ? 'med-warn-text' : ''}>剩 {entry.remaining} {entry.unit}</span>}
              <Icon name="right" size={17} />
            </button>
          </li>)}
        </ul>}
      </section>
      {item && <ItemStock key={item.id} api={api} item={item} snap={snap} onEdit={() => open(item.id)} />}
    </>}
  </>;
}

function ItemEditor({ api, item, onClose }: { api: MedApi; item?: MedItem; onClose: () => void }) {
  const [commandId] = useState(newId);
  const [input, setInput] = useState<MedItemInput>(() => item ?? { name: '', kind: '中藥', unit: '', mode: 'batch', note: '' });
  const [quantity, setQuantity] = useState('');
  const switching = item?.mode === 'none' && input.mode === 'total';
  const showQuantity = input.mode === 'total' && (!item || switching);
  const modes = !item ? MED_MODES : item.mode === 'none' ? ['none', 'total'] as const : [item.mode];
  const update = (patch: Partial<MedItemInput>) => setInput((old) => ({ ...old, ...patch }));
  return <form className="card med-form" onSubmit={async (e) => {
    e.preventDefault();
    // 只傳入要儲存的欄位，保留系統編號和庫存計算欄。
    const { name, kind, unit, mode, note } = input;
    const saved = await api.save(() => api.store.saveItem(commandId, { name, kind, unit, mode, note }, item?.id,
      showQuantity && quantity !== '' ? Number(quantity) : undefined));
    if (saved) onClose();
  }}>
    <h2>{item ? '修改品項' : '新增品項'}</h2>
    <fieldset className="med-form-body" disabled={api.busy}>
      <label className="field">品項名稱<input required maxLength={100} value={input.name} onChange={(e) => update({ name: e.target.value })} /></label>
      <div className="med-fields">
        <label className="field">類型<select value={input.kind} onChange={(e) => {
          const kind = e.target.value as MedItemInput['kind'];
          update(item ? { kind } : { kind, mode: defaultMedMode(kind) });
        }}>{MED_KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
        <label className="field">單位<input required maxLength={16} value={input.unit} readOnly={!!item && item.mode !== 'none'}
          placeholder="例如包、粒、顆" onChange={(e) => update({ unit: e.target.value })} /></label>
      </div>
      <label className="field">庫存管理方式<select value={input.mode} onChange={(e) => update({ mode: e.target.value as MedMode })}>
        {modes.map((mode) => <option key={mode} value={mode}>{modeLabels[mode]}</option>)}
      </select></label>
      {showQuantity && <QuantityField label={`目前數量（${input.unit || '單位'}）`} value={quantity} onChange={setQuantity} allowZero required={switching} />}
      {switching && <p className="muted small">這個數量會成為庫存起點，切換前的服用紀錄會保留。</p>}
      {!item && input.mode === 'batch' && <p className="muted small">品項儲存後，點進品項就能新增第一批。</p>}
      <label className="field">備註<textarea rows={2} value={input.note} onChange={(e) => update({ note: e.target.value })} /></label>
      <div className="med-actions med-footer"><button type="submit" className="primary">儲存</button><button type="button" onClick={onClose}>取消</button></div>
    </fieldset>
  </form>;
}

function ItemStock({ api, item, snap, onEdit }: { api: MedApi; item: MedItem; snap: MedSnapshot; onEdit: () => void }) {
  const [action, setAction] = useState<{ commandId: string; kind: 'batch' | 'addition'; batchId: string | null } | null>(null);
  const [batch, setBatch] = useState(blankBatch);
  const [increase, setIncrease] = useState('');
  const batches = snap.batches.filter((row) => row.itemId === item.id);
  const start = (kind: 'batch' | 'addition', batchId: string | null = null) => {
    setBatch(blankBatch());
    setIncrease('');
    setAction({ commandId: newId(), kind, batchId });
  };

  return <section className="card">
    <div className="med-row"><h2>{item.name}</h2><button type="button" onClick={onEdit} disabled={api.busy}>修改品項</button></div>
    {item.note && <p className="med-note">{item.note}</p>}
    {item.mode === 'none' ? <p className="muted">只記服用</p> : <>
      <p>總剩餘 <strong>{item.remaining} {item.unit}</strong></p>
      <p className="muted small">總數量 {item.received} {item.unit} · 已用 {item.used} {item.unit}</p>
      {!action && <div className="med-actions">
        {item.mode === 'batch' ? <button type="button" onClick={() => start('batch')}>新增一批</button>
          : <button type="button" onClick={() => start('addition')}>增加數量</button>}
      </div>}
    </>}
    {action && <form className="med-entry" onSubmit={async (e) => {
      e.preventDefault();
      const changes = action.kind === 'batch'
        ? { batches: [{ ...batch, itemId: item.id, quantity: Number(batch.quantity) }] }
        : { additions: [{ itemId: item.id, batchId: action.batchId, quantity: Number(increase) }] };
      if (await api.save(() => api.store.saveStock(action.commandId, changes))) setAction(null);
    }}>
      <fieldset className="med-form-body" disabled={api.busy}>
        <h3>{action.kind === 'batch' ? '新增批次' :
          action.batchId ? `補到 ${batches.find(({ id }) => id === action.batchId)?.receivedDate} 的批次` : '增加數量'}</h3>
        {action.kind === 'batch' ? <BatchFields value={batch} onChange={setBatch} unit={item.unit} />
          : <QuantityField label={`增加數量（${item.unit}）`} value={increase} onChange={setIncrease} required />}
        <div className="med-actions"><button type="submit" className="primary">儲存</button><button type="button" onClick={() => setAction(null)}>取消</button></div>
      </fieldset>
    </form>}
    {batches.map((entry) => <article className="med-entry" key={entry.id}>
      <div className="med-row"><strong>{entry.receivedDate}</strong><span className={entry.remaining <= 0 ? 'med-warn-text' : ''}>剩 {entry.remaining} {item.unit}</span></div>
      <p className="muted small">總數量 {entry.received} {item.unit} · 已用 {entry.used} {item.unit}</p>
      {entry.expiryDate && <p className="muted small">使用期限 {entry.expiryDate}</p>}
      {entry.ingredients && <p className="med-note">{entry.ingredients}</p>}
      {!action && <button type="button" className="link" onClick={() => start('addition', entry.id)}>補到這批</button>}
    </article>)}
  </section>;
}
