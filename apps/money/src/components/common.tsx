import type { Account, MoneySnapshot, Person } from '@life/db';

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(month: string) {
  const [y, m] = month.split('-').map(Number);
  return `${y} 年 ${m} 月`;
}

export function MonthNav({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  return (
    <div className="month-nav">
      <button className="link" onClick={() => setMonth(addMonths(month, -1))} aria-label="上個月">
        ◀
      </button>
      <span className="date-label">{monthLabel(month)}</span>
      <button className="link" onClick={() => setMonth(addMonths(month, 1))} aria-label="下個月">
        ▶
      </button>
    </div>
  );
}

/** 輸入框的文字 → 數字（空白 = null；可以有逗號） */
export function parseAmount(s: string): number | null {
  // 全形數字、各種負號（−、－）也看得懂
  const t = s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[−－﹣‐]/g, '-')
    .replace(/[．。]/g, '.')
    .replace(/[,，\s]/g, '')
    .trim();
  if (t === '-') return null;
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
export const amountText = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? '' : String(n));

/** 帳戶選單：依機構分組，停用的不出現（目前選的除外） */
export function AccountSelect({
  snap,
  value,
  onChange,
  placeholder = '選擇帳戶',
  extra,
}: {
  snap: MoneySnapshot;
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
  extra?: React.ReactNode;
}) {
  const list = snap.accounts.filter((a) => !a.archived || a.name === value);
  const groups = new Map<string, Account[]>();
  for (const a of list) {
    const g = a.org ?? a.type;
    groups.set(g, [...(groups.get(g) ?? []), a]);
  }
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{placeholder}</option>
      {[...groups].map(([g, accs]) => (
        <optgroup key={g} label={g}>
          {accs.map((a) => (
            <option key={a.id} value={a.name}>
              {a.name}
              {a.currency !== 'TWD' ? `（${a.currency}）` : ''}
            </option>
          ))}
        </optgroup>
      ))}
      {extra}
    </select>
  );
}


const NEW_PERSON = '\u0000new';

/** 人物選單；最後一個選項「＋新增人物」 */
export function PersonSelect({
  people,
  value,
  onChange,
  onAdd,
  placeholder = '選擇人物',
}: {
  people: Person[];
  value: string | null;
  onChange: (v: string | null) => void;
  onAdd: (name: string) => Promise<string | undefined>;
  placeholder?: string;
}) {
  const list = people.filter((p) => !p.isSelf && (!p.archived || p.name === value));
  return (
    <select
      value={value ?? ''}
      onChange={async (e) => {
        const v = e.target.value;
        if (v !== NEW_PERSON) return onChange(v || null);
        const name = prompt('新增人物（名稱）')?.trim();
        if (!name) return;
        const added = await onAdd(name);
        if (added) onChange(added);
      }}
    >
      <option value="">{placeholder}</option>
      {list.map((p) => (
        <option key={p.id} value={p.name}>
          {p.name}
        </option>
      ))}
      <option value={NEW_PERSON}>＋ 新增人物⋯</option>
    </select>
  );
}
