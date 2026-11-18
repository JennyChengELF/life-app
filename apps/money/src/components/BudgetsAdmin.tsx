import { useState } from 'react';
import type { Budget, MoneySnapshot } from '@life/db';
import { fmtMoney } from '@life/db';
import type { MoneyApi } from '../useMoney';
import { amountText, parseAmount } from './common';

type Draft = { name: string; ideal: string; basic: string; monthly: boolean; goal: string; archived: boolean; note: string };
const toDraft = (b?: Budget): Draft => ({
  name: b?.name ?? '',
  ideal: amountText(b?.ideal),
  basic: amountText(b?.basic),
  monthly: b?.monthly ?? true,
  goal: amountText(b?.goal),
  archived: b?.archived ?? false,
  note: b?.note ?? '',
});

function BudgetForm({ api, b, onDone }: { api: MoneyApi; b?: Budget; onDone: () => void }) {
  const [d, setD] = useState<Draft>(() => toDraft(b));
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const save = async () => {
    const nums = { ideal: parseAmount(d.ideal), basic: parseAmount(d.basic), goal: parseAmount(d.goal) };
    if (Object.values(nums).some((n) => Number.isNaN(n))) return api.showToast({ kind: 'error', text: '金額請填數字' });
    const ok = await api.run((s) => s.saveBudget({ name: d.name, ...nums, monthly: d.monthly, archived: d.archived, note: d.note || null }, b).then(() => true));
    if (ok) onDone();
  };
  return (
    <div className="subbox">
      <label className="field">
        名稱
        <input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="例：日常雜支" />
      </label>
      <div className="row">
        <label className="field" style={{ flex: 1 }}>
          基本金額（每月）
          <input inputMode="numeric" value={d.basic} onChange={(e) => set({ basic: e.target.value })} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          理想金額（每月）
          <input inputMode="numeric" value={d.ideal} onChange={(e) => set({ ideal: e.target.value })} />
        </label>
      </div>
      <p className="hint">基本＝依每月花費（加總不超過薪資）；理想＝預計要放的（加總可以超過薪資，靠年終補）。每月草稿先帶基本。</p>
      <label className="check">
        <input type="checkbox" checked={d.monthly} onChange={(e) => set({ monthly: e.target.checked })} />
        每月預算（不勾 = 不是每月都放，例：年度保險費，不會出現在每月草稿）
      </label>
      <label className="field">
        長期目標金額（選填，顯示累積進度）
        <input inputMode="numeric" value={d.goal} onChange={(e) => set({ goal: e.target.value })} />
      </label>
      <label className="field">
        備註
        <input value={d.note} onChange={(e) => set({ note: e.target.value })} />
      </label>
      {b && (
        <label className="check">
          <input type="checkbox" checked={d.archived} onChange={(e) => set({ archived: e.target.checked })} />
          停用（記帳時不出現，舊紀錄保留）
        </label>
      )}
      <div className="editor-actions">
        <button className="primary" onClick={save} disabled={api.busy}>
          儲存
        </button>
        <button onClick={onDone}>取消</button>
      </div>
    </div>
  );
}

export function BudgetsAdmin({ api, snap, onBack }: { api: MoneyApi; snap: MoneySnapshot; onBack: () => void }) {
  const [edit, setEdit] = useState<Budget | 'new' | null>(null);
  const sumOf = (k: 'ideal' | 'basic') => snap.budgets.filter((b) => b.monthly && !b.archived).reduce((a, b) => a + (b[k] ?? 0), 0);
  return (
    <section className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <button className="link" onClick={onBack}>
          ‹ 返回
        </button>
        <h2 style={{ margin: 0 }}>預算設定</h2>
        <span />
      </div>
      {snap.budgets.map((b, i) =>
        edit !== 'new' && edit?.id === b.id ? (
          <BudgetForm key={b.id} api={api} b={b} onDone={() => setEdit(null)} />
        ) : (
          <div className={`list-row ${b.archived ? 'archived' : ''}`} key={b.id}>
            <span className="grow">
              {b.name}{' '}
              <span className="muted small">
                基本 {fmtMoney(b.basic ?? 0, 'TWD', false)}・理想 {fmtMoney(b.ideal ?? 0, 'TWD', false)}
                {!b.monthly && '・非每月'}
                {b.archived && '・停用'}
              </span>
            </span>
            <button disabled={i === 0} onClick={() => api.run((s) => s.moveBudget(b, -1))} aria-label="上移">
              ↑
            </button>
            <button disabled={i === snap.budgets.length - 1} onClick={() => api.run((s) => s.moveBudget(b, 1))} aria-label="下移">
              ↓
            </button>
            <button onClick={() => setEdit(b)}>修改</button>
          </div>
        ),
      )}
      <p className="hint">
        每月預算合計：基本 {fmtMoney(sumOf('basic'))}、理想 {fmtMoney(sumOf('ideal'))}
      </p>
      {edit === 'new' ? (
        <BudgetForm api={api} onDone={() => setEdit(null)} />
      ) : (
        <div className="editor-actions">
          <button className="primary" onClick={() => setEdit('new')}>
            ＋ 新增預算
          </button>
        </div>
      )}
      <p className="hint">分類的預設預算在「🏷️ 分類」每個分類的 ⋯ 裡設定；記帳時選了分類會自動帶入。</p>
    </section>
  );
}
