import type { MoneySnapshot } from '@life/db';

/**
 * 選預算。支出：沒選也能存（2026-11-18 使用者要求不擋存檔），列表和預算頁會提醒補填。
 * 收入：選了就放進那個預算，沒選 = 待分配。
 */
export function BudgetSelect({
  snap,
  kind,
  value,
  onChange,
}: {
  snap: MoneySnapshot;
  kind: '支出' | '收入';
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  if (!snap.budgets.length) return null;
  const list = snap.budgets.filter((b) => !b.archived || b.name === value);
  return (
    <label className={`budget-select ${kind === '支出' && !value ? 'missing' : ''}`}>
      <span>{kind === '支出' ? '預算' : '放進預算'}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{kind === '支出' ? '⚠️ 還沒選（之後可補）' : '不放（待分配）'}</option>
        {list.map((b) => (
          <option key={b.id} value={b.name}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}
