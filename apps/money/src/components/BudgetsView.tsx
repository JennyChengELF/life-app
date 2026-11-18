import { useState } from 'react';
import type { BudgetMonth, BudgetMonthRow, MoneySnapshot } from '@life/db';
import { budgetDraft, budgetMonth, emptyForm, fmtMoney, loansOutstanding, todayKey, toHHmm, txnTitle, yearGaps } from '@life/db';
import type { Editing } from '../App';
import type { MoneyApi } from '../useMoney';
import { amountText, MonthNav, parseAmount } from './common';
import { BudgetSelect } from './BudgetSelect';

const n0 = (n: number) => fmtMoney(n, 'TWD', false);
const neg = (n: number) => (n < 0 ? 'amt-out' : '');

/** 一列數字輸入（存字串，按確認時才轉） */
function NumInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input className="num-input" inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} />;
}

type Panel = null | 'draft' | 'topup' | 'bonus' | 'baseline';

export function BudgetsView({
  api,
  snap,
  onEdit,
  goAccounts,
  goAdmin,
}: {
  api: MoneyApi;
  snap: MoneySnapshot;
  onEdit: (e: Editing) => void;
  goAccounts: () => void;
  goAdmin: () => void;
}) {
  const [month, setMonth] = useState(() => todayKey().slice(0, 7));
  const [open, setOpen] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const bm = budgetMonth(snap, month);
  const loans = loansOutstanding(snap);
  const active = bm.rows.filter((r) => !r.budget.archived || r.available !== 0 || r.used !== 0);

  if (!snap.budgets.length) {
    return (
      <section className="card center">
        <p>還沒有預算。</p>
        <button className="primary" onClick={goAdmin}>
          ＋ 新增預算
        </button>
        <p className="hint">每個預算可以設「理想金額」和「基本金額」，每月草稿會先帶入基本金額。</p>
      </section>
    );
  }

  return (
    <>
      <div className="messages">
        {loans.total > 0 && (
          <button className="msg info" onClick={goAccounts}>
            🤝 借出未還 {fmtMoney(loans.total)}（{loans.people} 人）— 這些錢還沒回來，先別當成可以花的錢
          </button>
        )}
        {bm.missing.length > 0 && (
          <a className="msg warn" href="#missing">
            ⚠️ 這個月有 {bm.missing.length} 筆支出還沒選預算，點這裡補
          </a>
        )}
      </div>

      <section className="card">
        <MonthNav month={month} setMonth={(m) => (setMonth(m), setPanel(null))} />
        <div className="sum-row">
          <div>
            <div className="sum-label">待分配（{Number(bm.incomeMonth.slice(5))} 月收入 {n0(bm.incomeBase)} − 本月分配）</div>
            <div className={`sum-value ${neg(bm.unallocated)}`}>{fmtMoney(bm.unallocated)}</div>
          </div>
        </div>

        {!bm.confirmed && panel !== 'draft' && (
          <div className="subbox center-text">
            <p>{Number(month.slice(5))} 月的預算還沒確認</p>
            <button className="primary" onClick={() => setPanel('draft')}>
              看本月預算草稿
            </button>
          </div>
        )}
        {panel === 'draft' && <DraftPanel api={api} snap={snap} bm={bm} onDone={() => setPanel(null)} />}
        {panel === 'topup' && <TopupPanel api={api} snap={snap} month={month} onDone={() => setPanel(null)} />}
        {panel === 'bonus' && <BonusPanel api={api} snap={snap} month={month} onDone={() => setPanel(null)} />}
        {panel === 'baseline' && <BaselinePanel api={api} snap={snap} bm={bm} onDone={() => setPanel(null)} />}

        <div className="budget-table">
          <div className="bt-row bt-head">
            <span>預算</span>
            <span>上月結餘</span>
            <span>本月放入</span>
            <span>本月使用</span>
            <span>可用</span>
          </div>
          {active.map((r) => (
            <BudgetRowView key={r.budget.id} r={r} open={open === r.budget.name} toggle={() => setOpen(open === r.budget.name ? null : r.budget.name)} api={api} onEdit={onEdit} />
          ))}
          <div className="bt-row bt-total">
            <span>合計</span>
            <span>{n0(sum(active, 'carry'))}</span>
            <span>{n0(sum(active, 'allocated') + sum(active, 'income'))}</span>
            <span>{n0(sum(active, 'used'))}</span>
            <span className={neg(sum(active, 'available'))}>{n0(sum(active, 'available'))}</span>
          </div>
        </div>
        <p className="hint">點一個預算看這個月扣了哪幾筆。可用是負的代表超支，會從下個月扣。</p>

        <div className="add-bar">
          <button onClick={() => setPanel('topup')}>＋ 追加</button>
          <button onClick={() => setPanel('bonus')}>🎁 年終 / 獎金補差額</button>
          <button onClick={() => setPanel('baseline')}>🔄 重新整理預算</button>
          <button className="link" onClick={goAdmin}>
            預算設定 ›
          </button>
        </div>
      </section>

      {bm.missing.length > 0 && (
        <section className="card" id="missing">
          <h2>還沒選預算的支出（{bm.missing.length}）</h2>
          {bm.missing.map(({ txn, line }) => (
            <div className="list-row" key={line.id}>
              <span className="grow">
                <span className="muted small">
                  {txn.date.slice(5).replace('-', '/')} {toHHmm(txn.time)}
                </span>{' '}
                {line.category ?? txnTitle(txn)} {txn.store && <span className="muted small">{txn.store}</span>}{' '}
                <span className="num">{n0(line.amount)}</span>
              </span>
              <BudgetSelect snap={snap} kind="支出" value={null} onChange={(v) => v && api.run((s) => s.setLineBudget(line, v))} />
            </div>
          ))}
        </section>
      )}
    </>
  );
}

const sum = (rows: BudgetMonthRow[], k: 'carry' | 'allocated' | 'income' | 'used' | 'available') => rows.reduce((a, r) => a + r[k], 0);

function BudgetRowView({ r, open, toggle, api, onEdit }: { r: BudgetMonthRow; open: boolean; toggle: () => void; api: MoneyApi; onEdit: (e: Editing) => void }) {
  const b = r.budget;
  return (
    <>
      <button className={`bt-row ${open ? 'open' : ''}`} onClick={toggle}>
        <span className="bt-name">
          {b.name}
          {!b.monthly && <small> 非每月</small>}
        </span>
        <span>{n0(r.carry)}</span>
        <span>{n0(r.allocated + r.income)}</span>
        <span>{n0(r.used)}</span>
        <span className={`bt-avail ${neg(r.available)}`}>{n0(r.available)}</span>
      </button>
      {open && (
        <div className="bt-detail">
          {r.since && <p className="hint">從 {r.since} 的期初開始算</p>}
          {b.goal != null && b.goal > 0 && (
            <p className="hint">
              目標 {n0(b.goal)}：已累積 {Math.max(0, Math.round((r.available / b.goal) * 100))}%
            </p>
          )}
          {r.allocs.map((a) => (
            <div className="list-row" key={a.id}>
              <span className="grow">
                {a.kind}放入 <span className="num">{n0(a.amount)}</span> {a.note && <span className="muted small">{a.note}</span>}
              </span>
              <button className="x-btn" onClick={() => confirm(`刪除這筆${a.kind}分配？`) && api.run((s) => s.deleteAllocation(a))} aria-label="刪除">
                ✕
              </button>
            </div>
          ))}
          {r.lines.length === 0 ? (
            <p className="muted small">這個月沒有扣這個預算的紀錄</p>
          ) : (
            r.lines.map(({ txn, line }) => (
              <div className="list-row clickable" key={line.id} onClick={() => onEdit({ form: emptyForm(), txn })}>
                <span className="grow">
                  <span className="muted small">{txn.date.slice(5).replace('-', '/')}</span> {line.category ?? txnTitle(txn)}{' '}
                  {txn.store && <span className="muted small">{txn.store}</span>}
                </span>
                <span className={`num ${line.kind === '收入' ? 'amt-in' : 'amt-out'}`}>
                  {line.kind === '收入' ? '+' : '−'}
                  {n0(line.amount)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}

/** 每月預算草稿（2026-11-18 確認）：帶基本金額，旁邊顯示理想；確認後才生效 */
function DraftPanel({ api, snap, bm, onDone }: { api: MoneyApi; snap: MoneySnapshot; bm: BudgetMonth; onDone: () => void }) {
  const draft = budgetDraft(snap);
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(draft.map((d) => [d.budget, amountText(d.amount)])));
  const total = draft.reduce((a, d) => a + (parseAmount(vals[d.budget] ?? '') || 0), 0);
  const basicSum = draft.reduce((a, d) => a + d.basic, 0);
  const idealSum = draft.reduce((a, d) => a + d.ideal, 0);
  const left = bm.incomeBase - total;
  const confirmIt = async () => {
    const rows = draft.map((d) => ({ budget: d.budget, amount: parseAmount(vals[d.budget] ?? '') ?? 0 }));
    if (rows.some((r) => Number.isNaN(r.amount))) return api.showToast({ kind: 'error', text: '金額請填數字' });
    const ok = await api.run((s) => s.allocate(bm.month, '每月', rows).then(() => true));
    if (ok) {
      api.showToast({ kind: 'info', text: `${Number(bm.month.slice(5))} 月預算已確認` });
      onDone();
    }
  };
  return (
    <div className="subbox">
      <h2>{Number(bm.month.slice(5))} 月預算草稿</h2>
      <div className="draft-row draft-head">
        <span>預算</span>
        <span>基本</span>
        <span>理想</span>
        <span>本月</span>
      </div>
      {draft.map((d) => (
        <div className="draft-row" key={d.budget}>
          <span>{d.budget}</span>
          <span className="num muted">{n0(d.basic)}</span>
          <button className="link num" title="用理想金額" onClick={() => setVals({ ...vals, [d.budget]: String(d.ideal) })}>
            {n0(d.ideal)}
          </button>
          <NumInput value={vals[d.budget] ?? ''} onChange={(v) => setVals({ ...vals, [d.budget]: v })} />
        </div>
      ))}
      <div className="draft-row draft-head">
        <span>合計</span>
        <span className="num">{n0(basicSum)}</span>
        <span className="num">{n0(idealSum)}</span>
        <span className="num">{n0(total)}</span>
      </div>
      <p className={`hint ${left < 0 ? 'warn' : ''}`}>
        {Number(bm.incomeMonth.slice(5))} 月收入（沒放進預算的）{n0(bm.incomeBase)}，分配後待分配 <b className={neg(left)}>{n0(left)}</b>
      </p>
      <p className="hint">點理想金額就改用理想；填 0 = 這個月不分配。</p>
      <div className="editor-actions">
        <button className="primary" onClick={confirmIt} disabled={api.busy}>
          確認本月預算
        </button>
        <button onClick={onDone}>取消</button>
      </div>
    </div>
  );
}

function TopupPanel({ api, snap, month, onDone }: { api: MoneyApi; snap: MoneySnapshot; month: string; onDone: () => void }) {
  const [budget, setBudget] = useState(snap.budgets.find((b) => !b.archived)?.name ?? '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const save = async () => {
    const n = parseAmount(amount);
    if (n == null || Number.isNaN(n) || n === 0) return api.showToast({ kind: 'error', text: '請填金額' });
    const ok = await api.run((s) => s.allocate(month, '追加', [{ budget, amount: n, note: note || null }]).then(() => true));
    if (ok) onDone();
  };
  return (
    <div className="subbox">
      <h2>追加預算（{Number(month.slice(5))} 月）</h2>
      <div className="row wrap">
        <select value={budget} onChange={(e) => setBudget(e.target.value)} style={{ flex: 2 }}>
          {snap.budgets
            .filter((b) => !b.archived)
            .map((b) => (
              <option key={b.id}>{b.name}</option>
            ))}
        </select>
        <NumInput value={amount} onChange={setAmount} />
      </div>
      <input placeholder="備註（選填）" value={note} onChange={(e) => setNote(e.target.value)} style={{ marginTop: 6 }} />
      <p className="hint">從待分配放進這個預算。</p>
      <div className="editor-actions">
        <button className="primary" onClick={save} disabled={api.busy}>
          追加
        </button>
        <button onClick={onDone}>取消</button>
      </div>
    </div>
  );
}

/** 年終 / 獎金補差額（2026-11-18 確認）：列出今年每個預算還差多少到理想，一鍵補滿或自己填 */
function BonusPanel({ api, snap, month, onDone }: { api: MoneyApi; snap: MoneySnapshot; month: string; onDone: () => void }) {
  const year = month.slice(0, 4);
  const gaps = yearGaps(snap, year);
  const [vals, setVals] = useState<Record<string, string>>({});
  const total = gaps.reduce((a, g) => a + (parseAmount(vals[g.budget] ?? '') || 0), 0);
  const save = async () => {
    const rows = gaps.map((g) => ({ budget: g.budget, amount: parseAmount(vals[g.budget] ?? '') ?? 0 }));
    if (rows.some((r) => Number.isNaN(r.amount))) return api.showToast({ kind: 'error', text: '金額請填數字' });
    if (!rows.some((r) => r.amount)) return api.showToast({ kind: 'error', text: '請填要補的金額' });
    const ok = await api.run((s) => s.allocate(month, '年終', rows).then(() => true));
    if (ok) onDone();
  };
  return (
    <div className="subbox">
      <h2>{year} 年還差多少到理想</h2>
      {gaps.length === 0 ? (
        <p className="muted">今年每個預算都已經到理想金額了 🎉</p>
      ) : (
        <>
          {gaps.map((g) => (
            <div className="draft-row three" key={g.budget}>
              <span>{g.budget}</span>
              <button className="link num" onClick={() => setVals({ ...vals, [g.budget]: String(g.gap) })} title="補滿">
                差 {n0(g.gap)}
              </button>
              <NumInput value={vals[g.budget] ?? ''} onChange={(v) => setVals({ ...vals, [g.budget]: v })} />
            </div>
          ))}
          <p className="hint">
            合計補 {n0(total)}。點「差 ⋯」就填滿那一個。
          </p>
          <div className="editor-actions">
            <button onClick={() => setVals(Object.fromEntries(gaps.map((g) => [g.budget, String(g.gap)])))}>全部補滿</button>
            <button className="primary" onClick={save} disabled={api.busy}>
              確認（記在 {Number(month.slice(5))} 月）
            </button>
            <button onClick={onDone}>取消</button>
          </div>
        </>
      )}
      {gaps.length === 0 && (
        <div className="editor-actions">
          <button onClick={onDone}>關閉</button>
        </div>
      )}
    </div>
  );
}

/** 重新整理預算（2026-11-18 確認）：某一天開始時每個預算的金額，之後從這天開始算 */
function BaselinePanel({ api, snap, bm, onDone }: { api: MoneyApi; snap: MoneySnapshot; bm: BudgetMonth; onDone: () => void }) {
  const [date, setDate] = useState(`${bm.month}-01`);
  const list = snap.budgets.filter((b) => !b.archived);
  const [vals, setVals] = useState<Record<string, string>>({});
  const save = async () => {
    const rows = list
      .filter((b) => (vals[b.name] ?? '').trim() !== '')
      .map((b) => ({ budget: b.name, amount: parseAmount(vals[b.name]) ?? 0 }));
    if (!rows.length) return api.showToast({ kind: 'error', text: '請至少填一個預算的金額' });
    if (rows.some((r) => Number.isNaN(r.amount))) return api.showToast({ kind: 'error', text: '金額請填數字' });
    if (!confirm(`從 ${date} 開始重新計算 ${rows.length} 個預算？這天以前的紀錄不再影響這些預算。`)) return;
    const ok = await api.run((s) => s.setBaseline(date, rows).then(() => true));
    if (ok) {
      api.showToast({ kind: 'info', text: '已重新整理預算' });
      onDone();
    }
  };
  return (
    <div className="subbox">
      <h2>重新整理預算</h2>
      <p className="hint">填某一天「開始時」每個預算有多少錢（可以是負的）。之後只從這天開始算；以後亂了可以再整理一次，以最新一次為準。空白的預算不變。</p>
      <label className="field">
        從哪一天開始
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {list.map((b) => (
        <div className="draft-row three" key={b.id}>
          <span>{b.name}</span>
          <span className="num muted small">目前可用 {n0(bm.rows.find((r) => r.budget.id === b.id)?.available ?? 0)}</span>
          <NumInput value={vals[b.name] ?? ''} onChange={(v) => setVals({ ...vals, [b.name]: v })} />
        </div>
      ))}
      <div className="editor-actions">
        <button className="primary" onClick={save} disabled={api.busy}>
          確認
        </button>
        <button onClick={onDone}>取消</button>
      </div>
    </div>
  );
}
