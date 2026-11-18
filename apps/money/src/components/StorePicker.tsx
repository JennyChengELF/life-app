import { useState } from 'react';
import type { MoneySnapshot } from '@life/db';
import { recentStores } from '@life/db';

/**
 * 店家 / 對象（2026-11-18 確認）：打字搜尋＋最近用過；找不到就直接用打的名字（存檔時自動加進機構）。
 */
export function StorePicker({
  snap,
  value,
  branch,
  onChange,
  onBranch,
}: {
  snap: MoneySnapshot;
  value: string | null;
  branch: string | null;
  onChange: (v: string | null) => void;
  onBranch: (v: string | null) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const text = q.trim();
  const names = snap.orgs.filter((o) => !o.archived).map((o) => o.name);
  const list = text ? names.filter((n) => n.toLowerCase().includes(text.toLowerCase())).slice(0, 10) : recentStores(snap.txns);
  const pick = (name: string) => {
    onChange(name);
    setQ('');
    setOpen(false);
  };

  return (
    <div className="field">
      店家 / 對象
      {value && !open ? (
        <div className="row">
          <button type="button" className="cat-current" onClick={() => setOpen(true)}>
            {value} <span className="muted">▾</span>
          </button>
          <button type="button" className="x-btn" onClick={() => onChange(null)} aria-label="清除">
            ✕
          </button>
        </div>
      ) : (
        <div className="cat-picker">
          <input autoFocus={open} placeholder="打字搜尋，或直接輸入新的" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="chips">
            {!text && list.length > 0 && <span className="chips-label">最近</span>}
            {list.map((n) => (
              <button type="button" key={n} className={`chip ${n === value ? 'active' : ''}`} onClick={() => pick(n)}>
                {n}
              </button>
            ))}
            {text && !names.includes(text) && (
              <button type="button" className="chip add" onClick={() => pick(text)}>
                ＋ 新增「{text}」
              </button>
            )}
            {value && (
              <button type="button" className="link small" onClick={() => setOpen(false)}>
                取消
              </button>
            )}
          </div>
        </div>
      )}
      {value && (
        <input className="branch" placeholder="分店（選填）" value={branch ?? ''} onChange={(e) => onBranch(e.target.value || null)} />
      )}
    </div>
  );
}
