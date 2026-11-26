import { useEffect, useState } from 'react';
import {
  availableMedBatches, canPickMed, newId, parseDateTimeText, toInputDateTime,
  type MedCombo, type MedItem, type MedLog, type MedSnapshot, type MedStockChanges,
} from '@life/db';
import { DateTimeField } from '@life/ui/date-time-field';
import { Icon } from '@life/ui/icon';
import { WeekDateStrip } from '@life/ui/week-date-strip';
import { BatchFields, blankBatch, QuantityField, type BatchDraft } from './StockFields';
import type { MedApi } from './useMeds';

type Draft = {
  itemId: string;
  quantity: string;
  batchId: string;
  stockBatchId: string;
  newBatch?: BatchDraft;
  increase: string;
  skipStock: boolean;
};
const blankDose = (itemId: string, quantity = ''): Draft => ({
  itemId, quantity, batchId: '', stockBatchId: '', increase: '', skipStock: false,
});

function EntryRow({ item, draft, snap, combo, canReplenish, previouslyChosen, beforeStockStart, onChange, onRemove }: {
  item: MedItem;
  draft: Draft;
  snap: MedSnapshot;
  combo: boolean;
  canReplenish: boolean;
  previouslyChosen?: string | null;
  beforeStockStart: boolean;
  onChange: (value: Draft) => void;
  onRemove: () => void;
}) {
  const change = (value: Partial<Draft>) => onChange({ ...draft, ...value });
  const allBatches = snap.batches.filter((batch) => batch.itemId === item.id);
  const available = availableMedBatches(snap.batches, item.id);
  const selected = draft.batchId || (available.length === 1 ? available[0].id : '');
  // （2026-11-26 使用者決定：既有批次可保留，新的選擇僅顯示有庫存批次。）
  const choices = allBatches.filter((batch) => batch.remaining > 0 || batch.id === previouslyChosen);
  const chosen = allBatches.find((batch) => batch.id === selected);
  const remaining = item.mode === 'batch' && !combo && chosen ? chosen.remaining : item.remaining;
  const lowStock = remaining != null && remaining <= 0;
  const emptyBatches = allBatches.filter((batch) => batch.remaining <= 0);
  const canAddAmount = canReplenish && lowStock && (item.mode === 'total' || emptyBatches.length > 0);
  const label = (batch: typeof allBatches[number]) => `${batch.receivedDate}（剩 ${batch.remaining} ${item.unit}）`;

  return <div className="med-entry">
    <div className="med-row">
      <div><strong>{item.name}</strong><span className="muted small"> · {item.kind}</span></div>
      <button type="button" className="icon-btn" aria-label={`移除 ${item.name}`} onClick={onRemove}><Icon name="x" size={18} /></button>
    </div>
    {lowStock && <p className="med-warning">庫存不足 · 剩 {remaining} {item.unit}</p>}
    <QuantityField label={combo ? `常用劑量（${item.unit}）` : `服用量（${item.unit}）`}
      value={draft.quantity} required onChange={(quantity) => change({ quantity })} />
    {!combo && item.mode === 'batch' && !draft.newBatch && <>
      {choices.length > 0 ? <label className="field">服用批次
        <select value={selected} required={!draft.skipStock && (available.length > 0 || !!previouslyChosen)}
          onChange={(e) => change({ batchId: e.target.value })}>
          <option value="">請選擇批次</option>
          {choices.map((batch) => <option key={batch.id} value={batch.id}>{label(batch)}</option>)}
        </select>
      </label> : <p className="muted small">{draft.skipStock ? '這筆只補紀錄' : '目前沒有可選批次，儲存後會標示「待補批次」。'}</p>}
    </>}
    {!combo && item.mode !== 'none' && !beforeStockStart && <label className="med-check">
      <input type="checkbox" checked={draft.skipStock} onChange={(e) => change({ skipStock: e.target.checked })} />
      只補紀錄，不扣庫存
    </label>}
    {!combo && beforeStockStart && <p className="muted small">這筆早於庫存起始時間，會保留紀錄。</p>}
    {canAddAmount && !draft.newBatch && <div className="med-stock-fields">
      {item.mode === 'batch' && <label className="field">補到原批次
        <select value={draft.stockBatchId || (emptyBatches.length === 1 ? emptyBatches[0].id : '')} required={!!draft.increase}
          onChange={(e) => change({ stockBatchId: e.target.value })}>
          <option value="">請選擇批次</option>
          {emptyBatches.map((batch) => <option key={batch.id} value={batch.id}>{label(batch)}</option>)}
        </select>
      </label>}
      <QuantityField label={`增加數量（${item.unit}）`} value={draft.increase} onChange={(increase) => change({ increase })} />
    </div>}
    {canReplenish && item.mode === 'batch' && <>
      <button type="button" className="link" onClick={() => change({
        newBatch: draft.newBatch ? undefined : blankBatch(), increase: '', stockBatchId: '',
      })}>{draft.newBatch ? '取消新增批次' : '新增一批'}</button>
      {draft.newBatch && <BatchFields unit={item.unit} value={draft.newBatch} onChange={(newBatch) => change({ newBatch })} />}
    </>}
  </div>;
}

export function EntryEditor({ api, snap, date, log, combo, editingCombo, onDateChange, onDirtyChange, onClose, onSaved }: {
  api: MedApi;
  snap: MedSnapshot;
  date: string;
  log?: MedLog;
  combo?: MedCombo;
  editingCombo: boolean;
  onDateChange?: (date: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onClose: () => void;
  onSaved: (date: string) => void;
}) {
  const [commandId] = useState(newId);
  const [deleteId] = useState(newId);
  const [initialTime] = useState(() => log?.time ?? Date.now());
  const [dateTime, setDateTime] = useState(() => toInputDateTime(initialTime));
  const [localDate, setLocalDate] = useState(log?.date ?? date);
  const logDate = onDateChange ? date : localDate;
  const setLogDate = (value: string) => {
    if (!value) return;
    if (onDateChange) onDateChange(value);
    else setLocalDate(value);
  };
  const [name, setName] = useState(combo?.name ?? '');
  const [entries, setEntries] = useState<Draft[]>(() => {
    if (log) return [{
      ...blankDose(log.itemId, String(log.quantity)), batchId: log.batchId ?? '', skipStock: log.skipStock,
    }];
    return combo?.entries.map((entry) => blankDose(entry.itemId, String(entry.quantity))) ?? [];
  });
  const [problem, setProblem] = useState('');
  const time = dateTime === toInputDateTime(initialTime) ? initialTime :
    (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dateTime) ? parseDateTimeText(dateTime) : null);
  const pickable = snap.items.filter((item) => canPickMed(item) && !entries.some((entry) => entry.itemId === item.id));
  const isEdit = !!(log || combo);
  const dirty = entries.length > 0 || dateTime !== toInputDateTime(initialTime);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const save = async () => {
    setProblem('');
    if (!entries.length) return setProblem('請選至少一個品項');
    if (!editingCombo && time == null) return setProblem('請確認實際服用的日期和時間');
    const changes: MedStockChanges = { batches: [], additions: [] };
    const logs = entries.map((entry) => {
      const item = snap.items.find(({ id }) => id === entry.itemId)!;
      let batchId = entry.batchId || null;
      if (entry.newBatch) {
        const { quantity, ...batch } = entry.newBatch;
        changes.batches!.push({ ...batch, itemId: item.id, quantity: Number(quantity) });
        batchId = batch.id;
      }
      if (entry.increase) {
        const empty = snap.batches.filter((batch) => batch.itemId === item.id && batch.remaining <= 0);
        const target = entry.stockBatchId || (item.mode === 'batch' && empty.length === 1 ? empty[0].id : null);
        changes.additions!.push({ itemId: item.id, batchId: target, quantity: Number(entry.increase) });
      }
      return { itemId: item.id, quantity: Number(entry.quantity), time: time ?? 0, date: logDate, batchId, skipStock: entry.skipStock };
    });
    const ok = await api.save(() => editingCombo
      ? api.store.saveCombo(commandId, name, logs, changes, combo?.id)
      : api.store.saveLogs(commandId, logs, changes, log?.id));
    if (ok) onSaved(logDate);
  };

  const remove = async () => {
    const target = combo ?? log;
    if (!target || !confirm(editingCombo ? '刪除這個常用組合？' : '刪除這筆服用紀錄？')) return;
    if (await api.save(() => api.store.remove(deleteId, editingCombo ? 'medCombos' : 'medLogs', target.id), '已刪除')) onClose();
  };

  const itemPicker = <div className="med-group">
    <h3>加選品項</h3>
    {pickable.length ? <div className="med-actions">{pickable.map((item) => <button type="button" key={item.id}
      onClick={() => setEntries((old) => [...old, blankDose(item.id)])}><Icon name="plus" size={16} /> {item.name}</button>)}</div>
      : <p className="muted small">目前沒有其他可選品項。可到「藥品與庫存」新增品項或補貨。</p>}
  </div>;

  return <>
    {onDateChange && <fieldset className="med-form-body med-add-week" disabled={api.busy}>
      <WeekDateStrip selected={logDate} setDate={setLogDate} />
    </fieldset>}
    <form className="card med-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <div className="med-row"><h2>{editingCombo ? (isEdit ? '修改常用組合' : '新增常用組合') : (isEdit ? '修改服用紀錄' : '記一筆服用')}</h2>
      <button type="button" className="icon-btn" aria-label="關閉編輯" onClick={onClose} disabled={api.busy}><Icon name="x" /></button>
    </div>
    <fieldset className="med-form-body" disabled={api.busy}>
      {editingCombo ? <label className="field">組合名稱<input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></label> : <>
        <label className="field">歸屬日期<input type="date" required value={logDate} onChange={(e) => setLogDate(e.target.value)} /></label>
        <DateTimeField label="實際服用日期" value={dateTime} onChange={setDateTime} />
        {!log && snap.combos.length > 0 && <div className="med-group">
          <h3>常用組合</h3>
          <div className="med-actions">{snap.combos.map((group) => <button type="button" key={group.id} onClick={() => {
            if (entries.length && !confirm('要用這個組合取代目前選的品項和劑量嗎？')) return;
            setEntries(group.entries.map((entry) => blankDose(entry.itemId, String(entry.quantity))));
          }}>{group.name}</button>)}</div>
        </div>}
      </>}
      {/* （2026-11-26 使用者決定：常用組合的加選品項放在名稱下方、已選品項上方。） */}
      {editingCombo && itemPicker}
      {entries.map((entry) => {
        const item = snap.items.find((candidate) => candidate.id === entry.itemId);
        if (!item) return null;
        return <EntryRow key={item.id} item={item} draft={entry} snap={snap} combo={editingCombo} canReplenish={isEdit}
          previouslyChosen={log?.itemId === item.id ? log.batchId : null}
          beforeStockStart={time != null && item.stockSince != null && time < item.stockSince}
          onChange={(value) => setEntries((old) => old.map((e) => e.itemId === item.id ? value : e))}
          onRemove={() => setEntries((old) => old.filter((e) => e.itemId !== item.id))} />;
      })}
      {!editingCombo && itemPicker}
      {problem && <p className="error-text" role="alert">{problem}</p>}
      <div className="med-actions med-footer">
        <button className="primary" type="submit">儲存</button>
        <button type="button" onClick={onClose}>取消</button>
        {isEdit && <button type="button" className="danger med-push" onClick={() => void remove()}>刪除</button>}
      </div>
    </fieldset>
    </form>
  </>;
}
