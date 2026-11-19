import { useState } from 'react';
import type { MoneyIssue, MoneySnapshot, OrphanHead } from '@life/db';
import { fmtMoney, orphanTxn, serialToMs, toInputDateTime, toSheetDateTime } from '@life/db';
import type { MoneyApi } from '../useMoney';
import { AccountSelect, PersonSelect } from './common';
import { CategoryPicker } from './CategoryPicker';
import { BudgetSelect } from './BudgetSelect';

const TABLE_LABEL: Record<string, string> = { moneyTransactions: '交易', moneyLines: '明細', moneyAccounts: '帳戶', moneyCategories: '分類', hubPeople: '人物', hubOrganizations: '機構' };
/** 試算表的日期時間是序號（例 46343.71）→ 顯示成看得懂的 */
const TIME_COLS = ['time', 'createdAt', 'updatedAt', 'deletedAt', 'date', 'openingDate', 'expiryDate'];
const show = (k: string, v: unknown) => {
  if (v === undefined || v === null || v === '') return '（空白）';
  if (TIME_COLS.includes(k) && typeof v === 'number' && v > 1) {
    const t = toSheetDateTime(serialToMs(v));
    return k === 'time' || k.endsWith('At') ? t.slice(0, 16) : t.slice(0, 10);
  }
  return String(v);
};

export function IssuesView({ api, snap, onDone, onFix }: { api: MoneyApi; snap: MoneySnapshot; onDone: () => void; onFix: (i: MoneyIssue) => void }) {
  const url = api.fileUrl();
  if (snap.issues.length === 0) {
    return (
      <div className="center">
        <p>✅ 沒有需要補齊的資料</p>
        <button className="primary" onClick={onDone}>
          回記帳
        </button>
      </div>
    );
  }
  // 2026-11-19 使用者決定：沒有交易的明細、只缺分類的交易可以整批補；其他的一筆一筆看
  const orphans = snap.issues.filter((i) => i.orphan);
  const needOut = snap.issues.filter((i) => i.needsCategory === '支出');
  const needIn = snap.issues.filter((i) => i.needsCategory === '收入');
  const rest = snap.issues.filter((i) => !i.orphan && !i.needsCategory);
  return (
    <div className="issues">
      <p className="muted">
        下面是在試算表直接輸入、但缺內容或格式看不懂的資料。可以勾選後在這裡整批補齊；其他的請到試算表修改，再按右上角「重新整理」，或按「不要這筆」標記刪除。
      </p>
      {url && (
        <a className="btn" href={url} target="_blank" rel="noreferrer">
          開啟記帳試算表 ↗
        </a>
      )}
      {orphans.length > 0 && <OrphanBatch key={`o-${snap.loadedAt}`} api={api} snap={snap} list={orphans} />}
      {needOut.length > 0 && <CategoryBatch key={`out-${snap.loadedAt}`} api={api} snap={snap} kind="支出" list={needOut} />}
      {needIn.length > 0 && <CategoryBatch key={`in-${snap.loadedAt}`} api={api} snap={snap} kind="收入" list={needIn} />}
      {rest.map((i) => (
        <IssueCard key={`${i.table}-${i.rowNumber}`} issue={i} api={api} onFix={onFix} />
      ))}
    </div>
  );
}

const keyOf = (i: MoneyIssue) => `${i.table}-${i.rowNumber}`;

/** 勾選用的狀態 */
function useSelection(list: MoneyIssue[]) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggle = (items: MoneyIssue[], on: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      for (const i of items) (on ? n.add(keyOf(i)) : n.delete(keyOf(i)));
      return n;
    });
  const picked = list.filter((i) => sel.has(keyOf(i)));
  return { sel, toggle, picked };
}

/** 不要勾選的這幾列 */
function DiscardPicked({ api, picked }: { api: MoneyApi; picked: MoneyIssue[] }) {
  return (
    <button
      className="link danger-text"
      disabled={!picked.length || api.busy}
      onClick={() =>
        confirm(`確定不要勾選的 ${picked.length} 列嗎？`) &&
        api.run(async (s) => {
          for (const i of picked) await s.discardIssue(i);
        })
      }
    >
      不要勾選的這幾列
    </button>
  );
}

/** 沒有交易的明細：勾選 → 填交易資料 → 合成一筆交易 */
function OrphanBatch({ api, snap, list }: { api: MoneyApi; snap: MoneySnapshot; list: MoneyIssue[] }) {
  const { sel, toggle, picked } = useSelection(list);
  const [head, setHead] = useState<OrphanHead>({ time: Date.now(), account: null, paidBy: null, store: null, note: null });
  const [friend, setFriend] = useState(false);
  const set = (p: Partial<OrphanHead>) => setHead((h) => ({ ...h, ...p }));

  // 同一個交易代號的排在一起；沒填的放最後
  const groups = new Map<string, MoneyIssue[]>();
  for (const i of list) {
    const g = i.orphan!.group ?? '';
    groups.set(g, [...(groups.get(g) ?? []), i]);
  }
  const ordered = [...groups].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : 0));

  const preview = picked.length ? orphanTxn(picked.map((i) => i.orphan!.line), { ...head, account: friend ? null : head.account, paidBy: friend ? head.paidBy : null }) : null;
  const canSave = picked.length > 0 && (friend ? !!head.paidBy : !!head.account) && !api.busy;

  return (
    <section className="card batch">
      <h2>沒有交易的明細（{list.length} 行）</h2>
      <p className="muted small">勾選屬於同一筆的明細，填上時間、帳戶，就會合成一筆交易。</p>
      {ordered.map(([g, items]) => {
        const all = items.every((i) => sel.has(keyOf(i)));
        return (
          <div key={g} className="batch-group">
            <label className="check batch-head">
              <input type="checkbox" checked={all} onChange={(e) => toggle(items, e.target.checked)} />
              {g ? `交易代號「${g}」（試算表找不到這筆交易）` : '沒填交易代號'}
            </label>
            <ul className="batch-list">
              {items.map((i) => {
                const l = i.orphan!.line;
                return (
                  <li key={keyOf(i)}>
                    <label className="check">
                      <input type="checkbox" checked={sel.has(keyOf(i))} onChange={(e) => toggle([i], e.target.checked)} />
                      <span className="grow">
                        {l.kind ?? '（沒填種類）'}　{l.category ?? l.person ?? ''}
                        {l.note ? <span className="muted">　{l.note}</span> : null}
                      </span>
                      <span className="num">{Number.isFinite(l.amount) ? fmtMoney(l.amount) : '（沒填金額）'}</span>
                    </label>
                    <div className="muted small batch-row">第 {i.rowNumber} 列</div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {picked.length > 0 && (
        <div className="batch-form">
          <h3>補交易資料（{picked.length} 行）</h3>
          <label className="field">
            時間
            <input
              type="datetime-local"
              value={toInputDateTime(head.time)}
              onChange={(e) => {
                const t = new Date(e.target.value).getTime();
                if (Number.isFinite(t)) set({ time: t });
              }}
            />
          </label>
          <div className="seg modes">
            <button className={friend ? '' : 'active'} onClick={() => setFriend(false)}>
              我付 / 我收
            </button>
            <button className={friend ? 'active' : ''} onClick={() => setFriend(true)}>
              朋友幫我付
            </button>
          </div>
          {friend ? (
            <label className="field">
              誰幫我付
              <PersonSelect people={snap.people} value={head.paidBy} onChange={(v) => set({ paidBy: v })} onAdd={(name) => api.run((s) => s.addPerson(name))} />
            </label>
          ) : (
            <label className="field">
              帳戶
              <AccountSelect snap={snap} value={head.account} onChange={(v) => set({ account: v })} />
            </label>
          )}
          <label className="field">
            店家 / 對象（可不填）
            <input list="batch-stores" value={head.store ?? ''} onChange={(e) => set({ store: e.target.value || null })} />
            <datalist id="batch-stores">
              {snap.orgs
                .filter((o) => !o.archived)
                .map((o) => (
                  <option key={o.id} value={o.name} />
                ))}
            </datalist>
          </label>
          <label className="field">
            備註（可不填）
            <input value={head.note ?? ''} onChange={(e) => set({ note: e.target.value || null })} />
          </label>
          {preview && (
            <p className="batch-preview">
              {preview.paidBy
                ? `${preview.paidBy} 幫我付，明細 ${preview.lines.length} 行（含和他之間的欠款）`
                : `${preview.direction === '入' ? '收入' : '支出'} ${fmtMoney(preview.amount ?? 0)}，明細 ${preview.lines.length} 行`}
            </p>
          )}
          <div className="editor-actions">
            <button
              className="primary"
              disabled={!canSave}
              onClick={() => api.run((s) => s.attachLines(picked, { ...head, account: friend ? null : head.account, paidBy: friend ? head.paidBy : null }))}
            >
              合成一筆交易
            </button>
            <DiscardPicked api={api} picked={picked} />
          </div>
        </div>
      )}
    </section>
  );
}

/** 只缺分類的交易：勾多筆、選同一個分類一次補完 */
function CategoryBatch({ api, snap, kind, list }: { api: MoneyApi; snap: MoneySnapshot; kind: '支出' | '收入'; list: MoneyIssue[] }) {
  const { sel, toggle, picked } = useSelection(list);
  const [category, setCategory] = useState<string | null>(null);
  const [budget, setBudget] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ issue: MoneyIssue; problems: string[] }[]>([]);
  const all = list.every((i) => sel.has(keyOf(i)));

  return (
    <section className="card batch">
      <h2>
        沒有分類的{kind}（{list.length} 筆）
      </h2>
      <label className="check batch-head">
        <input type="checkbox" checked={all} onChange={(e) => toggle(list, e.target.checked)} />
        全選
      </label>
      <ul className="batch-list">
        {list.map((i) => {
          const d = i.draft!;
          const amt = d.cats[0]?.amount;
          return (
            <li key={keyOf(i)}>
              <label className="check">
                <input type="checkbox" checked={sel.has(keyOf(i))} onChange={(e) => toggle([i], e.target.checked)} />
                <span className="grow">
                  <span className="muted small num">{toSheetDateTime(d.time).slice(0, 16)}</span> {d.store ?? ''}
                  {d.note ? <span className="muted">　{d.note}</span> : null}
                </span>
                <span className="num">{amt == null ? '（沒填金額）' : fmtMoney(amt)}</span>
              </label>
              <div className="muted small batch-row">
                {d.account ?? ''}　第 {i.rowNumber} 列
              </div>
            </li>
          );
        })}
      </ul>

      {picked.length > 0 && (
        <div className="batch-form">
          <h3>補分類（{picked.length} 筆）</h3>
          <CategoryPicker
            api={api}
            snap={snap}
            kind={kind}
            value={category}
            onChange={(v) => {
              setCategory(v);
              // 預算先帶分類的預設，可以再改
              setBudget(snap.categories.find((c) => c.path === v)?.defaultBudget ?? null);
            }}
          />
          <BudgetSelect snap={snap} kind={kind} value={budget} onChange={setBudget} />
          <div className="editor-actions">
            <button
              className="primary"
              disabled={!category || api.busy}
              onClick={async () => {
                const r = await api.run((s) => s.fillCategories(picked, category!, budget));
                if (r) setFailed(r);
              }}
            >
              補上分類
            </button>
            <DiscardPicked api={api} picked={picked} />
          </div>
        </div>
      )}
      {failed.length > 0 && (
        <div className="problems">
          有 {failed.length} 筆沒補成功：
          <ul>
            {failed.map((f) => (
              <li key={keyOf(f.issue)}>
                第 {f.issue.rowNumber} 列：{f.problems.join('；')}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function IssueCard({ issue, api, onFix }: { issue: MoneyIssue; api: MoneyApi; onFix: (i: MoneyIssue) => void }) {
  const filled = Object.entries(issue.raw).filter(([k, v]) => v !== undefined && v !== null && v !== '' && k !== 'createdAt' && k !== 'updatedAt');
  return (
    <section className="card">
      <h2>
        {TABLE_LABEL[issue.table] ?? issue.table}（{issue.table}）第 {issue.rowNumber} 列
      </h2>
      <p className="small">原本內容：{filled.length ? filled.map(([k, v]) => `${k} = ${show(k, v)}`).join('、') : '（空白）'}</p>
      <ul className="problems">
        {issue.problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <div className="editor-actions">
        {issue.draft && (
          <button className="primary" onClick={() => onFix(issue)}>
            在 APP 裡補完
          </button>
        )}
        <button className="danger" onClick={() => confirm('確定不要這一列嗎？') && api.run((s) => s.discardIssue(issue))}>
          不要這筆
        </button>
      </div>
    </section>
  );
}
