import { useState } from 'react';
import type { AdvanceSettlement, pendingAdvances } from '@life/db';
import { advancePaymentAmount, fmtMoney, txnTitle, validAgreedRate } from '@life/db';

type Advance = ReturnType<typeof pendingAdvances>[number];

export function repaymentTotal(advances: Advance[], selections: AdvanceSettlement[], currency: string): number | null {
  const byId = new Map(advances.map((a) => [a.txn.id, a]));
  let total = 0;
  for (const selection of selections) {
    const advance = byId.get(selection.transaction);
    const amount = advance && advancePaymentAmount(advance.amount, advance.currency, currency, selection.rate);
    if (amount == null) return null;
    total += amount;
  }
  return Number.isFinite(total) ? total : null;
}

export function RateInput({ value, onChange, label }: { value: number | null; onChange: (value: number | null) => void; label: string }) {
  return <label className="field">{label}
    <input type="number" step="any" inputMode="decimal" value={value ?? ''} placeholder="例如 0.21" onChange={(e) => {
      const value = e.target.valueAsNumber;
      onChange(Number.isFinite(value) ? value : null);
    }} />
  </label>;
}

export function AdvanceRepayment({ advances, selections, currency, onChange }: {
  advances: Advance[];
  selections: AdvanceSettlement[];
  currency: string;
  onChange: (selections: AdvanceSettlement[]) => void;
}) {
  const [batchRate, setBatchRate] = useState<number | null>(null);
  const byId = new Map(selections.map((selection) => [selection.transaction, selection]));
  const notRated = advances.filter((a) => a.currency !== 'TWD' && byId.get(a.txn.id)?.rate === null);
  const batchIds = new Set(notRated.map((a) => a.txn.id));
  const canApplyBatch = new Set(notRated.map((a) => a.currency)).size === 1;
  const total = repaymentTotal(advances, selections, currency);
  if (!advances.length) return null;
  return <section className="subbox">
    <h3>代付明細</h3>
    <p className="hint">勾選這次要整筆結清的支出。舊還款只記總額，未連到個別明細。</p>
    <ul className="batch-list">
      {advances.map(({ txn, amount, currency: original, rate }) => {
        const selection = byId.get(txn.id);
        const currentRate = selection ? selection.rate : rate;
        const expected = advancePaymentAmount(amount, original, currency, currentRate);
        const update = (nextRate: number | null) => onChange(selections.map((x) => x.transaction === txn.id ? { ...x, rate: nextRate } : x));
        return <li key={txn.id}>
          <label className="check">
            <input type="checkbox" checked={!!selection} onChange={(e) => onChange(e.target.checked
              ? [...selections, { transaction: txn.id, rate }]
              : selections.filter((x) => x.transaction !== txn.id))} />
            <span>{txn.date}　{txn.store || txnTitle(txn)}　{fmtMoney(amount, original)}</span>
          </label>
          {selection && original !== 'TWD' && <RateInput label={`約定匯率（1 ${original} 等於多少台幣）`} value={currentRate} onChange={update} />}
          {original !== 'TWD' && !selection && <div className="hint">{currentRate == null ? '匯率待補' : `1 ${original} = NT$ ${currentRate}`}</div>}
          {expected != null && original !== currency && <div className="hint">換算後 {fmtMoney(expected, currency)}</div>}
        </li>;
      })}
    </ul>
    {batchIds.size > 1 && canApplyBatch && <div className="row">
      <RateInput label="批次匯率（只補已勾選且匯率空白的同幣別明細）" value={batchRate} onChange={setBatchRate} />
      <button type="button" disabled={!validAgreedRate(batchRate)} onClick={() => {
        onChange(selections.map((x) => batchIds.has(x.transaction) ? { ...x, rate: batchRate } : x));
        setBatchRate(null);
      }}>套用匯率</button>
    </div>}
    {selections.length > 0 && <p className="hint">{total == null ? '請選同幣別帳戶，或用台幣還款並填齊約定匯率。' : `已選 ${selections.length} 筆，應還 ${fmtMoney(total, currency)}`}</p>}
  </section>;
}
