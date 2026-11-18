import { useState } from 'react';
import type { CategoryKind, CategoryNode, MoneySnapshot } from '@life/db';
import { categoryTree, MAX_CATEGORY_DEPTH } from '@life/db';
import type { MoneyApi } from '../useMoney';

/**
 * 分類管理（2026-11-18 確認：獨立頁面、樹狀）。新增只填這一層的名字；改名只改這一層，底下跟著改。
 */
export function CategoriesView({ api, snap }: { api: MoneyApi; snap: MoneySnapshot }) {
  const [kind, setKind] = useState<CategoryKind>('支出');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<string | null>(null);
  const tree = categoryTree(snap.categories, kind);

  const toggle = (path: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

  const add = async (parent: CategoryNode | null) => {
    const name = prompt(parent ? `在「${parent.cat.path}」底下新增分類（只填名字）` : `新增${kind}主分類（只填名字）`)?.trim();
    if (!name) return;
    const ok = await api.run((s) => s.addCategory(parent?.cat.path ?? null, name, kind));
    if (ok && parent) setExpanded((s) => new Set(s).add(parent.cat.path));
  };

  const Row = ({ n, index, siblings }: { n: CategoryNode; index: number; siblings: number }) => {
    const c = n.cat;
    const isOpen = expanded.has(c.path);
    const hasKids = n.children.length > 0;
    return (
      <li>
        <div className={`tree-row ${n.hidden ? 'archived' : ''}`} style={{ paddingLeft: (n.depth - 1) * 20 }}>
          <button className="tree-toggle" onClick={() => hasKids && toggle(c.path)} disabled={!hasKids} aria-label={isOpen ? '收起' : '展開'}>
            {hasKids ? (isOpen ? '▼' : '▶') : '・'}
          </button>
          <span className="grow" onClick={() => hasKids && toggle(c.path)}>
            {n.name}
            {hasKids && !isOpen && <span className="muted small">（{n.children.length}）</span>}{' '}
            {c.isInvest && <span className="tag">投資類</span>} {c.defaultBudget && <span className="muted small">💼 {c.defaultBudget}</span>}{' '}
            {c.archived && <span className="muted small">停用</span>}
          </span>
          {n.depth < MAX_CATEGORY_DEPTH && (
            <button onClick={() => add(n)} title="新增子分類">
              ＋子分類
            </button>
          )}
          <button onClick={() => setMenu(menu === c.id ? null : c.id)} aria-label="更多">
            ⋯
          </button>
        </div>
        {menu === c.id && (
          <div className="tree-menu" style={{ paddingLeft: (n.depth - 1) * 20 + 28 }}>
            <button
              onClick={() => {
                const name = prompt('新的名稱（只改這一層；底下的分類、用到的紀錄會一起改）', n.name)?.trim();
                if (name && name !== n.name) api.run((s) => s.renameCategory(c, name));
              }}
            >
              改名
            </button>
            <button onClick={() => api.run((s) => s.updateCategory(c, { isInvest: !c.isInvest }))}>{c.isInvest ? '取消投資類' : '設成投資類'}</button>
            {snap.budgets.length > 0 && (
              <select className="kind-select" value={c.defaultBudget ?? ''} onChange={(e) => api.run((s) => s.setCategoryBudget(c, e.target.value || null))}>
                <option value="">預設預算：無</option>
                {snap.budgets
                  .filter((b) => !b.archived || b.name === c.defaultBudget)
                  .map((b) => (
                    <option key={b.id} value={b.name}>
                      預設預算：{b.name}
                    </option>
                  ))}
              </select>
            )}
            <button onClick={() => api.run((s) => s.updateCategory(c, { archived: !c.archived }))}>
              {c.archived ? '恢復' : hasKids ? '停用（底下一起）' : '停用'}
            </button>
            <button disabled={index === 0} onClick={() => api.run((s) => s.moveCategory(c, -1))} aria-label="上移">
              ↑
            </button>
            <button disabled={index === siblings - 1} onClick={() => api.run((s) => s.moveCategory(c, 1))} aria-label="下移">
              ↓
            </button>
          </div>
        )}
        {hasKids && isOpen && <Tree nodes={n.children} />}
      </li>
    );
  };

  const Tree = ({ nodes }: { nodes: CategoryNode[] }) => (
    <ul className="tree">
      {nodes.map((n, i) => (
        <Row key={n.cat.id} n={n} index={i} siblings={nodes.length} />
      ))}
    </ul>
  );

  return (
    <section className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>分類</h2>
        <div className="seg">
          {(['支出', '收入'] as const).map((k) => (
            <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
              {k}
            </button>
          ))}
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="link small" onClick={() => setExpanded(new Set(snap.categories.map((c) => c.path)))}>
          全部展開
        </button>
        <button className="link small" onClick={() => setExpanded(new Set())}>
          全部收起
        </button>
      </div>
      {tree.length ? <Tree nodes={tree} /> : <p className="muted">還沒有{kind}分類</p>}
      <div className="editor-actions">
        <button className="primary" onClick={() => add(null)}>
          ＋ 新增{kind}主分類
        </button>
      </div>
      <p className="hint">
        最多 {MAX_CATEGORY_DEPTH} 層。新增時只填這一層的名字（例：在「食 / 三餐」按＋子分類，填「早餐」）。記帳時可以只選到上層。
        「投資類」不算進實際收支。
      </p>
    </section>
  );
}
