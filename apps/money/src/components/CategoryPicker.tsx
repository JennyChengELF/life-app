import { useState } from 'react';
import type { CategoryKind, CategoryNode, MoneySnapshot } from '@life/db';
import { ancestorPaths, categoryTree, MAX_CATEGORY_DEPTH, recentCategories } from '@life/db';
import type { MoneyApi } from '../useMoney';

/** 找到某個路徑的節點 */
function findNode(nodes: CategoryNode[], path: string): CategoryNode | null {
  for (const n of nodes) {
    if (n.cat.path === path) return n;
    const c = findNode(n.children, path);
    if (c) return c;
  }
  return null;
}

/**
 * 選分類：一層一層點（2026-11-18 確認）。可以只選到上層；有「最近用過」；每一層都能直接新增。
 */
export function CategoryPicker({
  api,
  snap,
  kind,
  value,
  onChange,
}: {
  api: MoneyApi;
  snap: MoneySnapshot;
  kind: CategoryKind;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(!value);
  const tree = categoryTree(snap.categories, kind);
  const recent = recentCategories(snap.txns, kind).filter((p) => p !== value && findNode(tree, p) && !findNode(tree, p)!.hidden);

  const pick = (path: string) => {
    onChange(path);
    const n = findNode(tree, path);
    if (!n || !n.children.some((c) => !c.hidden)) setOpen(false);
  };

  const add = async (parent: CategoryNode | null) => {
    const name = prompt(parent ? `在「${parent.cat.path}」底下新增分類（只填名字）` : `新增${kind}主分類（只填名字）`)?.trim();
    if (!name) return;
    const path = await api.run((s) => s.addCategory(parent?.cat.path ?? null, name, kind));
    if (path) {
      onChange(path);
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="cat-current" onClick={() => setOpen(true)}>
        {value ?? '選擇分類'} <span className="muted">▾</span>
      </button>
    );
  }

  // 每一層：主分類，以及目前選到的每一層底下
  const chain = value ? [...ancestorPaths(value), value] : [];
  const levels: { parent: CategoryNode | null; nodes: CategoryNode[] }[] = [{ parent: null, nodes: tree }];
  for (const p of chain) {
    const n = findNode(tree, p);
    if (!n || n.depth >= MAX_CATEGORY_DEPTH) break;
    levels.push({ parent: n, nodes: n.children });
  }

  return (
    <div className="cat-picker">
      {recent.length > 0 && (
        <div className="chips">
          <span className="chips-label">最近</span>
          {recent.map((p) => (
            <button type="button" key={p} className="chip" onClick={() => pick(p)}>
              {p}
            </button>
          ))}
        </div>
      )}
      {levels.map(({ parent, nodes }, i) => (
        <div className="chips" key={parent?.cat.path ?? 'root'}>
          {i > 0 && <span className="chips-label">└</span>}
          {nodes
            .filter((n) => !n.hidden)
            .map((n) => (
              <button type="button" key={n.cat.id} className={`chip ${chain.includes(n.cat.path) ? 'active' : ''}`} onClick={() => pick(n.cat.path)}>
                {n.name}
                {n.children.some((c) => !c.hidden) ? ' ›' : ''}
              </button>
            ))}
          <button type="button" className="chip add" onClick={() => add(parent)} title="新增分類">
            ＋
          </button>
        </div>
      ))}
      {value && (
        <button type="button" className="link small" onClick={() => setOpen(false)}>
          選好了：{value}
        </button>
      )}
    </div>
  );
}
