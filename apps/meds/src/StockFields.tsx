import { newId, todayKey, type MedBatchInput } from '@life/db';

export type BatchDraft = Omit<MedBatchInput, 'quantity'> & { id: string; quantity: string };

export const blankBatch = (): BatchDraft => ({
  id: newId(), receivedDate: todayKey(), expiryDate: '', quantity: '', ingredients: '',
});

export function QuantityField({ label, value, onChange, allowZero = false, required = false }: {
  label: string; value: string; onChange: (value: string) => void; allowZero?: boolean; required?: boolean;
}) {
  return <label className="field">{label}
    <input type="number" inputMode="decimal" min={allowZero ? 0 : 0.000000001} step="any" required={required}
      value={value} onChange={(event) => onChange(event.target.value)} />
  </label>;
}

export function BatchFields({ value, onChange, unit }: {
  value: BatchDraft; onChange: (value: BatchDraft) => void; unit: string;
}) {
  return <div className="med-stock-fields">
    <div className="med-fields">
      <label className="field">領藥／購買日期<input type="date" required value={value.receivedDate}
        onChange={(e) => onChange({ ...value, receivedDate: e.target.value })} /></label>
      <label className="field">使用期限<input type="date" value={value.expiryDate}
        onChange={(e) => onChange({ ...value, expiryDate: e.target.value })} /></label>
    </div>
    <QuantityField label={`數量（${unit}）`} value={value.quantity} required
      onChange={(quantity) => onChange({ ...value, quantity })} />
    <label className="field">成分明細<textarea rows={3} value={value.ingredients}
      onChange={(e) => onChange({ ...value, ingredients: e.target.value })} /></label>
  </div>;
}
