import { useMemo, useState } from 'react';
import type { Account, MoneySnapshot, ParsedItem, StatementItem, Txn } from '@life/db';
import {
  accountLabel,
  dueDateFor,
  emptyForm,
  fmtMoney,
  isStatementPaid,
  itemDate,
  itemToForm,
  NO_MATCH,
  parseStatementText,
  reconcile,
  statementPaid,
  stmtAmount,
  txnTitle,
} from '@life/db';
import type { MoneyApi } from '../useMoney';
import type { Editing } from '../App';
import { AmountInput } from './EntryEditor';

const md = (d: string | null) => (d ? d.slice(5).replace('-', '/') : '');

/** 帳單對帳（2026-11-18 確認） */
export function ReconcileView({
  api,
  snap,
  acc,
  closeDate,
  setCloseDate,
  onBack,
  onEdit,
}: {
  api: MoneyApi;
  snap: MoneySnapshot;
  acc: Account;
  closeDate: string;
  setCloseDate: (d: string) => void;
  onBack: () => void;
  onEdit: (e: Editing) => void;
}) {
  const card = acc.type === '信用卡';
  const stmt = snap.statements.find((s) => s.account === acc.name && s.closeDate === closeDate) ?? null;
  const items = snap.statementItems.filter((i) => i.account === acc.name && i.closeDate === closeDate);
  const r = useMemo(() => reconcile(snap, acc, { id: stmt?.id ?? '', closeDate }), [snap, acc, stmt, closeDate]);
  const others = snap.statements.filter((s) => s.account === acc.name).slice(-6);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pairing, setPairing] = useState<string | null>(null);
  const cur = acc.currency;
  const sumItems = items.reduce((a, i) => a + i.amount, 0);

  const fix = (item: StatementItem, ids: string[]) => api.run((s) => s.setItemMatch(item, ids));
  const finish = async () => {
    const st = stmt ?? (await api.run((s) => s.saveStatement(acc.name, closeDate)));
    if (!st) return;
    const ok = await api.run((s) => s.finishReconcile(st, r.pairs.map((p) => ({ item: p.item, txnIds: p.txns.map((t) => t.id) }))).then(() => true));
    if (ok) api.showToast({ kind: 'info', text: `對帳完成：配對 ${r.pairs.length} 筆${r.itemsOnly.length ? `，還有 ${r.itemsOnly.length} 筆帳單有、記帳沒有` : ''}` });
  };
  const back: Editing['back'] = { tab: 'accounts' };

  return (
    <section className="card">
      <div className="page-head">
        <button className="link" onClick={onBack}>
          ‹ {accountLabel(acc)}
        </button>
        <h2>🧾 帳單對帳</h2>
      </div>

      <label className="field">
        結帳日（這一期的最後一天）
        <input type="date" value={closeDate} onChange={(e) => e.target.value && setCloseDate(e.target.value)} />
      </label>
      {others.length > 0 && (
        <div className="chips" style={{ marginBottom: 8 }}>
          <span className="chips-label">已建立</span>
          {others.map((s) => (
            <button key={s.id} className={`chip ${s.closeDate === closeDate ? 'active' : ''}`} onClick={() => setCloseDate(s.closeDate)}>
              {s.closeDate.slice(0, 7).replace('-', '/')}
              {s.doneAt ? ' ✓' : ''}
            </button>
          ))}
        </div>
      )}
      <p className="hint">
        期間：{md(r.start)} 之後 ～ {md(closeDate)}
        {stmt?.doneAt ? ` ・ ✓ 已在 ${new Date(stmt.doneAt).toLocaleDateString()} 對帳完成（有修改可以再按一次完成）` : ''}
      </p>

      {card && <DueBox api={api} snap={snap} acc={acc} closeDate={closeDate} />}

      {/* 帳單明細 */}
      <h3 className="sub-head">帳單明細</h3>
      {items.length > 0 && (
        <p className="hint">
          {items.length} 筆，加總 {fmtMoney(sumItems, cur)}
          {'  '}
          <button className="link small" onClick={() => setPasteOpen((x) => !x)}>
            ＋ 再貼一些
          </button>
          {'  '}
          <button
            className="link small"
            onClick={() => confirm(`刪除這一期的 ${items.length} 筆帳單明細，重新貼？（記帳的資料不受影響）`) && api.run((s) => s.deleteStatementItems(items))}
          >
            清除重貼
          </button>
        </p>
      )}
      {(items.length === 0 || pasteOpen) && <PasteBox api={api} acc={acc} closeDate={closeDate} onDone={() => setPasteOpen(false)} />}

      {items.length > 0 && (
        <>
          <h3 className="sub-head">
            帳單有、記帳沒有 <span className="count">{r.itemsOnly.length}</span>
          </h3>
          {r.itemsOnly.length === 0 && <p className="muted small">沒有，全部都記了 👍</p>}
          {r.itemsOnly.map((it) => {
            const cancelled = it.matched.includes(NO_MATCH);
            const sug = r.suggestions.get(it.id) ?? [];
            return (
              <div className="rc-item" key={it.id}>
                <div className="rc-line">
                  <span className="muted small num">{md(itemDate(it))}</span>
                  <span className="grow">{it.description ?? '（沒有說明）'}</span>
                  <b className="num">{fmtMoney(it.amount, cur)}</b>
                </div>
                {cancelled && <p className="hint">已取消配對</p>}
                {sug.map((g, k) => (
                  <p className="hint" key={k}>
                    💡 這 {g.length} 筆加起來剛好：{g.map((t) => `${txnTitle(t)} ${fmtMoney(stmtAmount(t, acc), cur, false)}`).join('＋')}{' '}
                    <button className="link small" onClick={() => fix(it, g.map((t) => t.id))}>
                      一起配對
                    </button>
                  </p>
                ))}
                <div className="rc-actions">
                  <button className="primary" onClick={() => onEdit({ form: itemToForm(snap, acc, it), back })}>
                    補登
                  </button>
                  <button onClick={() => setPairing(pairing === it.id ? null : it.id)}>配對⋯</button>
                  {cancelled && <button onClick={() => fix(it, [])}>恢復自動配對</button>}
                </div>
                {pairing === it.id && <PairPicker pool={r.pool} acc={acc} item={it} onPick={(ids) => (setPairing(null), fix(it, ids))} />}
              </div>
            );
          })}

          <h3 className="sub-head">
            記帳有、帳單沒有 <span className="count">{r.txnsOnly.length}</span>
          </h3>
          {r.txnsOnly.length === 0 ? (
            <p className="muted small">沒有</p>
          ) : (
            <>
              <p className="hint">還沒入帳的會留到下一期；如果是記錯了，點一下修改。</p>
              {r.txnsOnly.map((t) => (
                <TxnLine key={t.id} t={t} acc={acc} onClick={() => onEdit({ form: emptyForm(), txn: t, back })} />
              ))}
            </>
          )}

          <details className="rc-done">
            <summary>
              已配對 <span className="count">{r.pairs.length}</span>
            </summary>
            {r.pairs.map((p) => (
              <div className="rc-item" key={p.item.id}>
                <div className="rc-line">
                  <span className="muted small num">{md(itemDate(p.item))}</span>
                  <span className="grow">
                    {p.item.description ?? '（沒有說明）'}
                    {p.auto && <span className="tag">自動</span>}
                  </span>
                  <b className="num">{fmtMoney(p.item.amount, cur)}</b>
                </div>
                <div className="rc-matched">
                  ↳{' '}
                  {p.txns.map((t) => (
                    <button key={t.id} className="link small" onClick={() => onEdit({ form: emptyForm(), txn: t, back })}>
                      {md(t.date)} {txnTitle(t)}
                      {t.store ? `・${t.store}` : ''} {fmtMoney(stmtAmount(t, acc), cur, false)}
                    </button>
                  ))}
                  <button className="link small danger-text" onClick={() => fix(p.item, [NO_MATCH])}>
                    取消配對
                  </button>
                </div>
              </div>
            ))}
          </details>

          <div className="editor-actions">
            <button className="primary" onClick={finish} disabled={api.busy}>
              完成對帳
            </button>
            <span className="hint">完成時會記下配對結果、填上入帳日，並記住帳單名稱（下次補登自動帶入店家）</span>
          </div>
        </>
      )}
    </section>
  );
}

function TxnLine({ t, acc, onClick }: { t: Txn; acc: Account; onClick: () => void }) {
  return (
    <div className="rc-line clickable" onClick={onClick}>
      <span className="muted small num">{md(t.date)}</span>
      <span className="grow">
        {txnTitle(t)}
        {t.store && <small className="muted">・{t.store}</small>}
      </span>
      <span className="num">{fmtMoney(stmtAmount(t, acc), acc.currency)}</span>
    </div>
  );
}

/** 手動配對：從還沒配對的交易裡選（金額一樣的排前面），可以選好幾筆 */
function PairPicker({ pool, acc, item, onPick }: { pool: Txn[]; acc: Account; item: StatementItem; onPick: (ids: string[]) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  const list = [...pool].sort((a, b) => Number(stmtAmount(b, acc) === item.amount) - Number(stmtAmount(a, acc) === item.amount) || a.time - b.time);
  const total = sel.reduce((a, id) => a + stmtAmount(pool.find((t) => t.id === id)!, acc), 0);
  if (!list.length) return <p className="hint">沒有還沒配對的交易，請按「補登」</p>;
  return (
    <div className="subbox">
      {list.map((t) => (
        <label className="check rc-pick" key={t.id}>
          <input type="checkbox" checked={sel.includes(t.id)} onChange={(e) => setSel(e.target.checked ? [...sel, t.id] : sel.filter((x) => x !== t.id))} />
          <span className="muted small num">{md(t.date)}</span>
          <span className="grow">
            {txnTitle(t)}
            {t.store ? `・${t.store}` : ''}
          </span>
          <span className="num">{fmtMoney(stmtAmount(t, acc), acc.currency, false)}</span>
        </label>
      ))}
      <div className="editor-actions">
        <button className="primary" disabled={!sel.length} onClick={() => onPick(sel)}>
          配對 {sel.length || ''} 筆
        </button>
        {sel.length > 0 && (
          <span className={`hint ${Math.abs(total - item.amount) < 0.005 ? '' : 'warn'}`}>
            加總 {fmtMoney(total, acc.currency)}／帳單 {fmtMoney(item.amount, acc.currency)}
          </span>
        )}
      </div>
    </div>
  );
}

/** 信用卡：應繳金額、繳款期限、繳了多少 */
function DueBox({ api, snap, acc, closeDate }: { api: MoneyApi; snap: MoneySnapshot; acc: Account; closeDate: string }) {
  const stmt = snap.statements.find((s) => s.account === acc.name && s.closeDate === closeDate) ?? null;
  const [due, setDue] = useState<number | null>(stmt?.amountDue ?? null);
  const [dueDate, setDueDate] = useState(stmt?.dueDate ?? dueDateFor(acc, closeDate) ?? '');
  const paid = stmt ? statementPaid(stmt, snap.txns) : 0;
  const changed = due !== (stmt?.amountDue ?? null) || (dueDate || null) !== (stmt?.dueDate ?? dueDateFor(acc, closeDate));
  return (
    <div className="subbox">
      <div className="row wrap">
        <label className="field grow">
          應繳金額
          <AmountInput value={due} onChange={setDue} />
        </label>
        <label className="field grow">
          繳款期限
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
      </div>
      {changed && (
        <button className="primary" disabled={api.busy} onClick={() => api.run((s) => s.saveStatement(acc.name, closeDate, { amountDue: due, dueDate: dueDate || null }))}>
          存
        </button>
      )}
      {stmt && (stmt.amountDue != null || paid > 0) && (
        <p className={`hint ${isStatementPaid(stmt, snap.txns) ? '' : 'warn'}`}>
          {isStatementPaid(stmt, snap.txns) ? '✓ 已繳' : '還沒繳清'}：已繳 {fmtMoney(paid, acc.currency)}
          {stmt.amountDue != null ? `／應繳 ${fmtMoney(stmt.amountDue, acc.currency)}` : ''}（繳卡費時在轉帳選「繳哪一期」）
        </p>
      )}
    </div>
  );
}

/** 貼上帳單明細（2026-11-18 確認：從 Excel / 網頁 / PDF 複製幾列，自動分欄，預覽後存） */
function PasteBox({ api, acc, closeDate, onDone }: { api: MoneyApi; acc: Account; closeDate: string; onDone: () => void }) {
  const [text, setText] = useState('');
  const [flip, setFlip] = useState(false);
  const [off, setOff] = useState<number[]>([]);
  const parsed = useMemo(() => parseStatementText(text, closeDate), [text, closeDate]);
  const rows: ParsedItem[] = parsed.rows.map((r) => (flip ? { ...r, amount: -r.amount } : r));
  const keep = rows.filter((_, i) => !off.includes(i));
  const save = async () => {
    const ok = await api.run((s) => s.addStatementItems(acc.name, closeDate, keep).then(() => true));
    if (ok) {
      api.showToast({ kind: 'info', text: `已存入 ${keep.length} 筆帳單明細` });
      setText('');
      setOff([]);
      onDone();
    }
  };
  return (
    <div className="subbox">
      <textarea
        rows={5}
        value={text}
        placeholder={'從帳單（Excel、網頁、PDF）複製幾列貼在這裡，例：\n115/10/28  115/10/30  全聯福利中心  1,280\n也可以直接貼在試算表的「moneyStatementItems」分頁'}
        onChange={(e) => {
          setText(e.target.value);
          setOff([]);
        }}
      />
      {text.trim() && (
        <>
          <p className="hint">
            看得懂 {rows.length} 筆{parsed.skipped ? `，略過 ${parsed.skipped} 行（標題、小計或看不懂的）` : ''}。
            {isCard(acc) ? '信用卡：刷卡是正數、退款是負數。' : '銀行：存入是正數、支出是負數。'}
            <button className="link small" onClick={() => setFlip((x) => !x)}>
              全部正負對調
            </button>
          </p>
          <div className="rc-preview">
            {rows.map((r, i) => (
              <label className={`check rc-pick ${off.includes(i) ? 'off' : ''}`} key={i}>
                <input type="checkbox" checked={!off.includes(i)} onChange={(e) => setOff(e.target.checked ? off.filter((x) => x !== i) : [...off, i])} />
                <span className="muted small num">
                  {md(r.date)}
                  {r.postedDate && r.postedDate !== r.date ? `→${md(r.postedDate)}` : ''}
                </span>
                <span className="grow">
                  {r.description ?? '（沒有說明）'}
                  {r.origCurrency && (
                    <small className="muted">
                      {' '}
                      {r.origCurrency} {r.origAmount ?? ''}
                    </small>
                  )}
                </span>
                <span className={`num ${r.amount < 0 ? 'amt-in' : ''}`}>{fmtMoney(r.amount, acc.currency, false)}</span>
              </label>
            ))}
          </div>
          <div className="editor-actions">
            <button className="primary" disabled={!keep.length || api.busy} onClick={save}>
              存入 {keep.length} 筆
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const isCard = (acc: Account) => acc.type === '信用卡';
