import { useEffect, useMemo, useState } from 'react';
import type { EntryForm, MoneySnapshot, Txn, TxnInput } from '@life/db';
import {
  noteSuggestions,
  unpaidStatements,
  checkTxn,
  ENTRY_MODES,
  fmtMoney,
  formToTxn,
  formTotal,
  personBalances,
  splitEven,
  splitTags,
  toInputDateTime,
  txnCurrency,
  defaultBudgetFor,
  estimateFee,
  feeTxnFrom,
  installmentTxns,
  findFeeTxn,
  isFeeTxn,
  lastCategoryOfStore,
  txnToForm,
} from '@life/db';
import type { Editing } from '../App';
import type { MoneyApi } from '../useMoney';
import { AccountSelect, amountText, parseAmount, PersonSelect } from './common';
import { CategoryPicker } from './CategoryPicker';
import { StorePicker } from './StorePicker';
import { BudgetSelect } from './BudgetSelect';

/** 金額輸入：自己記住打到一半的文字（例：「12.」） */
export function AmountInput({
  value,
  onChange,
  placeholder = '金額',
  signed = false,
}: {
  value: number | null;
  onChange: (n: number | null) => void;
  placeholder?: string;
  /** 可以填負數（退款、折扣）：旁邊多一個 ± 按鈕（iPhone 數字鍵盤沒有負號） */
  signed?: boolean;
}) {
  const [s, setS] = useState(amountText(value));
  useEffect(() => {
    if (!Object.is(parseAmount(s), value)) setS(amountText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const input = (
    <input
      inputMode="decimal"
      placeholder={placeholder}
      value={s}
      className={signed && (value ?? 0) < 0 ? 'neg' : ''}
      onChange={(e) => {
        setS(e.target.value);
        onChange(parseAmount(e.target.value));
      }}
    />
  );
  if (!signed) return input;
  const flip = () => {
    const t = s.trim();
    const next = t.startsWith('-') ? t.slice(1) : `-${t}`;
    setS(next);
    onChange(parseAmount(next));
  };
  return (
    <>
      <button type="button" className="sign-btn" onClick={flip} title="正負（負數 = 退款、折扣）">
        ±
      </button>
      {input}
    </>
  );
}

const PAID_BY = '\u0000paidBy';
const MODE_TITLE: Record<string, string> = { 不用還了: '不用還了', 調整: '盤點調整', 其他: '交易' };

export function EntryEditor({ api, snap, editing, onClose }: { api: MoneyApi; snap: MoneySnapshot; editing: Editing; onClose: () => void }) {
  const txn = editing.txn;
  const [f, setF] = useState<EntryForm>(() => (txn ? txnToForm(txn) : editing.form));
  const [problems, setProblems] = useState<string[]>([]);
  const [splitTotal, setSplitTotal] = useState<number | null>(null);
  const [splitN, setSplitN] = useState(2);
  const [paidByMode, setPaidByMode] = useState(!!f.paidBy);
  /** 國外交易手續費（信用卡支出）：null = 自動（新增時國外店家就勾；修改時不勾） */
  const [feeOnState, setFeeOnState] = useState<boolean | null>(null);
  /** 新的店家（還不在機構清單）先記在這裡，存檔時一起建立 */
  const [newForeign, setNewForeign] = useState(false);
  const [feeEdit, setFeeEdit] = useState<number | null>(null);
  /** 分期（只有新增、用帳戶付的支出） */
  const [installOn, setInstallOn] = useState(false);
  const [installN, setInstallN] = useState(6);
  /** 修改前的金額：改了金額要提醒手續費那筆也要改 */
  const [initTotal] = useState(() => formTotal(f));
  const set = (patch: Partial<EntryForm>) => setF((x) => ({ ...x, ...patch }));

  const editable = ENTRY_MODES.includes(f.mode as (typeof ENTRY_MODES)[number]) || f.mode === '不用還了';
  const currency = txnCurrency({ account: f.account, currency: f.currency }, snap.accounts);
  const addPerson = (name: string) => api.run((s) => s.addPerson(name));
  const currencies = useMemo(() => [...new Set(['TWD', ...snap.accounts.map((a) => a.currency)])], [snap.accounts]);

  const switchMode = (mode: EntryForm['mode']) =>
    set({ mode, sub: mode === '借款' ? '借出' : mode === '還款' ? '他還我' : null, cats: [{ category: null, amount: null }], shares: [], paidBy: null });

  const save = async () => {
    let tx;
    try {
      tx = formToTxn(paidByMode ? f : { ...f, paidBy: null });
    } catch (e) {
      return setProblems([e instanceof Error ? e.message : String(e)]);
    }
    const p = checkTxn(tx, snap);
    if (paidByMode && !f.paidBy) p.unshift('請選誰先幫你付');
    setProblems(p);
    if (p.length) return;
    // 國外交易手續費：另外記一筆（2026-11-18 確認）
    const card = snap.accounts.find((a) => a.name === tx.account && a.type === '信用卡');
    const fee = feeOn && feeCard && card && !existingFee && tx.direction === '出' ? feeAmount : null;
    const feeTx = fee ? feeTxnFrom(tx, fee, card!.org) : null;
    if (feeOn && feeTx) {
      // 「… / 國外交易手續費」分類還沒有的話，存檔時自動建立
      const feeCats = feeTx.lines.map((l) => ({ path: l.category ?? '', kind: '支出' as const }));
      const fp = checkTxn(feeTx, { ...snap, categories: [...snap.categories, ...feeCats] });
      if (!(fee! > 0)) fp.push('手續費請填大於 0 的整數');
      if (fp.length) return setProblems(fp.map((x) => `手續費：${x}`));
    }
    // 分期（2026-11-18 確認）：拆成每個月一筆
    let parts: TxnInput[] | null = null;
    if (installOn && canInstall) {
      try {
        parts = installmentTxns(tx, installN, snap.accounts);
      } catch (e) {
        return setProblems([e instanceof Error ? e.message : String(e)]);
      }
    }
    const ok = await api.run(async (s) => {
      if (tx.store && newForeign && !storeOrg) await s.addOrg(tx.store, null, true);
      if (parts) for (const part of parts) await s.saveTxn(part);
      else await s.saveTxn(tx, txn ?? (editing.target ? ({ ...editing.target, lines: [] } as unknown as Txn) : undefined));
      if (feeTx) {
        await s.ensureCategories(feeTx.lines.map((l) => l.category ?? ''), '支出');
        await s.saveTxn(feeTx);
      }
      return true;
    });
    if (ok) {
      api.showToast({
        kind: 'info',
        text: parts
          ? `已記錄 ${parts.length} 期${feeTx ? '（含手續費）' : ''}`
          : txn
            ? feeTx
              ? '已修改（補記手續費）'
              : feeChanged
                ? '已修改；手續費那筆不會自動改，記得也去改'
                : '已修改'
            : feeTx
              ? '已記錄（含手續費）'
              : '已記錄',
      });
      onClose();
    }
  };

  const remove = async () => {
    if (!txn || !confirm('確定刪除這一筆嗎？')) return;
    const ok = await api.run((s) => s.deleteTxn(txn).then(() => true));
    if (ok) {
      api.showToast({ kind: 'info', text: '已刪除' });
      onClose();
    }
  };

  // 我的部分（分類＋金額）
  /** 選了分類、還沒選預算 → 帶入預設預算（分類的預設 → 這個分類上次用的） */
  const withBudget = <C extends EntryForm['cats'][number]>(c: C): C => (c.budget ? c : { ...c, budget: defaultBudgetFor(snap, c.category) });

  const catRows = (kind: '支出' | '收入') => (
    <div className="field">
      {f.shares.length || paidByMode ? '我的部分' : '分類'}
      <div className="split-rows">
        {f.cats.map((c, i) => (
          <div className="cat-line" key={i}>
            <div className="row">
              <AmountInput signed value={c.amount} onChange={(n) => set({ cats: f.cats.map((x, j) => (j === i ? { ...x, amount: n } : x)) })} />
              {f.cats.length > 1 && (
                <button className="x-btn" onClick={() => set({ cats: f.cats.filter((_, j) => j !== i) })} aria-label="移除">
                  ✕
                </button>
              )}
            </div>
            <CategoryPicker
              api={api}
              snap={snap}
              kind={kind}
              value={c.category}
              onChange={(v) => set({ cats: f.cats.map((x, j) => (j === i ? withBudget({ ...x, category: v }) : x)) })}
            />
            <BudgetSelect
              snap={snap}
              kind={kind}
              value={c.budget ?? null}
              onChange={(v) => set({ cats: f.cats.map((x, j) => (j === i ? { ...x, budget: v } : x)) })}
            />
            {/* 明細備註（2026-11-19 使用者要求）：拆成多個分類才出現（只有一個分類時用整筆的備註） */}
            {(f.cats.length > 1 || !!c.note) && (
              <LineNote snap={snap} category={c.category} value={c.note ?? null} onChange={(v) => set({ cats: f.cats.map((x, j) => (j === i ? { ...x, note: v } : x)) })} />
            )}
          </div>
        ))}
      </div>
      <button className="link small" onClick={() => set({ cats: [...f.cats, { category: null, amount: null }] })}>
        ＋ 拆成多個分類
      </button>
    </div>
  );

  // 平分（2026-11-18 確認：預設平分、每人金額可改；零頭由付錢的人負擔）
  const evenSplit = () => {
    if (splitTotal == null || !(splitTotal > 0)) return setProblems(['請先填總額']);
    if (f.cats.length > 1) return setProblems(['拆成多個分類時，請自己填每個分類的金額']);
    if (paidByMode) {
      const n = Math.max(2, splitN);
      // 付錢的人是第 0 個，我是第 1 個
      const mine = splitEven(splitTotal, n, 0, currency)[1];
      set({ cats: [{ ...f.cats[0], amount: mine }] });
    } else {
      const shares = splitEven(splitTotal, f.shares.length + 1, 0, currency);
      set({ cats: [{ ...f.cats[0], amount: shares[0] }], shares: f.shares.map((s, i) => ({ ...s, amount: shares[i + 1] })) });
    }
    setProblems([]);
  };

  const balanceHint = () => {
    if (!f.person) return null;
    const b = personBalances(snap.txns, snap.accounts).filter((x) => x.person === f.person && x.net !== 0);
    if (!b.length) return <p className="hint">目前和 {f.person} 之間沒有欠款</p>;
    return (
      <p className="hint">
        目前：
        {b.map((x) => (
          <span key={x.currency}>
            {x.net > 0 ? `${f.person} 欠我 ` : `我欠 ${f.person} `}
            {fmtMoney(Math.abs(x.net), x.currency)}{' '}
            <button
              className="link small"
              onClick={() => set({ amount: Math.abs(x.net), sub: f.mode === '不用還了' || f.mode === '還款' ? (x.net > 0 ? '他還我' : '我還他') : f.sub })}
            >
              填入
            </button>
          </span>
        ))}
      </p>
    );
  };

  // 選店家：分類還沒選的話，帶入這家店上次用的分類（2026-11-18 確認）
  const storePicker = (kind: '支出' | '收入') => (
    <StorePicker
      snap={snap}
      value={f.store}
      branch={f.branch}
      onBranch={(v) => set({ branch: v })}
      foreign={storeForeign}
      onForeign={(v) => {
        if (storeOrg) api.run((s) => s.updateOrg(storeOrg, { foreign: v }));
        else setNewForeign(v);
      }}
      onChange={(v) => {
        const last = v ? lastCategoryOfStore(snap.txns, v, kind) : null;
        set({ store: v, cats: last && f.cats.length === 1 && !f.cats[0].category ? [withBudget({ ...f.cats[0], category: last })] : f.cats });
      }}
    />
  );

  // 分類的常用備註（2026-11-18 使用者要求）：選了分類才出現，已經寫在備註裡的不再出現
  const noteCats = f.cats.map((c) => c.category ?? '').filter(Boolean).join(' ');
  const allNoteChips = useMemo(() => noteSuggestions(snap.txns, noteCats ? noteCats.split(' ') : []), [snap.txns, noteCats]);
  const noteChips = allNoteChips.filter((x) => !(f.note ?? '').split('、').map((y) => y.trim()).includes(x));

  const from = snap.accounts.find((a) => a.name === f.account);
  const canInstall = !txn && !editing.target && f.mode === '支出' && !paidByMode && !!from;
  const feeCard = f.mode === '支出' && !paidByMode && from?.type === '信用卡' && !(txn && isFeeTxn(txn)) ? from : null;
  // 修改舊資料：已經記過手續費的不再重複記（2026-11-18 確認）
  const existingFee = txn ? findFeeTxn(snap.txns, txn) : null;
  const feeChanged = !!existingFee && formTotal(f) !== initTotal;
  const storeOrg = f.store ? (snap.orgs.find((o) => o.name === f.store) ?? null) : null;
  const storeForeign = storeOrg ? storeOrg.foreign : newForeign;
  // 用信用卡付國外店家 → 自動勾手續費（2026-11-18）；自己改過就照自己的
  const feeOn = feeOnState ?? (txn ? false : storeForeign);
  const feeAmount = feeEdit ?? estimateFee(Math.max(0, formTotal(f)), feeCard?.fxFeeRate ?? null);
  const to = snap.accounts.find((a) => a.name === f.toAccount);

  return (
    <section className="editor">
      <h2>
        <span>{txn ? '修改' : '記一筆'}{MODE_TITLE[f.mode] ? `：${MODE_TITLE[f.mode]}` : ''}</span>
        <button className="link" onClick={onClose} aria-label="關閉">
          ✕
        </button>
      </h2>

      {!txn && ENTRY_MODES.includes(f.mode as (typeof ENTRY_MODES)[number]) && (
        <div className="seg modes">
          {ENTRY_MODES.map((m) => (
            <button key={m} className={f.mode === m ? 'active' : ''} onClick={() => switchMode(m)}>
              {m}
            </button>
          ))}
        </div>
      )}

      {!editable ? (
        <div className="subbox">
          <p>這筆的明細比較特別，APP 還不能直接修改，請到試算表修改；也可以刪除。</p>
          <ul className="small">
            {txn?.lines.map((l) => (
              <li key={l.id}>
                {l.kind} {fmtMoney(l.amount, currency)} {l.category ?? l.person ?? ''}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <label className="field">
            時間
            <input
              type="datetime-local"
              value={toInputDateTime(f.time)}
              onChange={(e) => {
                const t = new Date(e.target.value).getTime();
                if (Number.isFinite(t)) set({ time: t });
              }}
            />
          </label>

          {f.mode === '支出' && (
            <>
              <label className="field">
                付款
                <AccountSelect
                  snap={snap}
                  value={paidByMode ? PAID_BY : f.account}
                  onChange={(v) => {
                    if (v === PAID_BY) {
                      setPaidByMode(true);
                      set({ account: null, shares: [] });
                    } else {
                      setPaidByMode(false);
                      set({ account: v, paidBy: null, currency: null });
                    }
                  }}
                  extra={<option value={PAID_BY}>朋友先幫我付⋯</option>}
                />
              </label>
              {paidByMode && (
                <div className="row">
                  <label className="field" style={{ flex: 2 }}>
                    誰先付
                    <PersonSelect people={snap.people} value={f.paidBy} onChange={(v) => set({ paidBy: v })} onAdd={addPerson} />
                  </label>
                  <label className="field" style={{ flex: 1 }}>
                    幣別
                    <select value={f.currency ?? 'TWD'} onChange={(e) => set({ currency: e.target.value === 'TWD' ? null : e.target.value })}>
                      {currencies.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {storePicker('支出')}
              {catRows('支出')}

              {!paidByMode && (
                <div className="field">
                  {f.shares.length > 0 && '分帳：別人的份額（他欠我）'}
                  <div className="split-rows">
                    {f.shares.map((s, i) => (
                      <div className="row" key={i}>
                        <PersonSelect
                          people={snap.people}
                          value={s.person}
                          onChange={(v) => set({ shares: f.shares.map((x, j) => (j === i ? { ...x, person: v } : x)) })}
                          onAdd={addPerson}
                        />
                        <AmountInput value={s.amount} onChange={(n) => set({ shares: f.shares.map((x, j) => (j === i ? { ...x, amount: n } : x)) })} />
                        <button className="x-btn" onClick={() => set({ shares: f.shares.filter((_, j) => j !== i) })} aria-label="移除">
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <button className="link small" onClick={() => set({ shares: [...f.shares, { person: null, amount: null }] })}>
                    ＋ 和別人分帳（我先付）
                  </button>
                </div>
              )}

              {(f.shares.length > 0 || paidByMode) && (
                <div className="subbox">
                  <div className="row wrap">
                    <span className="small muted">總額</span>
                    <AmountInput value={splitTotal} onChange={setSplitTotal} placeholder="整筆多少" />
                    {paidByMode && (
                      <>
                        <span className="small muted">幾人</span>
                        <input
                          className="narrow"
                          type="number"
                          min={2}
                          value={splitN}
                          onChange={(e) => setSplitN(Math.max(2, Number(e.target.value) || 2))}
                        />
                      </>
                    )}
                    <button onClick={evenSplit}>平分</button>
                  </div>
                  <p className="hint">除不盡的零頭由付錢的人負擔；平分後每個人的金額還可以再改。</p>
                </div>
              )}
              {!paidByMode && f.shares.length > 0 && (
                <p className="hint">
                  我付了 {fmtMoney(formTotal(f), currency)}（我的部分＋別人的份額）
                </p>
              )}
              {canInstall && (
                <div className="subbox">
                  <label className="check">
                    <input type="checkbox" checked={installOn} onChange={(e) => setInstallOn(e.target.checked)} />
                    分期付款
                  </label>
                  {installOn && (
                    <>
                      <div className="row">
                        <input
                          className="narrow"
                          type="number"
                          min={2}
                          max={60}
                          value={installN}
                          onChange={(e) => setInstallN(Math.max(2, Math.min(60, Number(e.target.value) || 2)))}
                        />
                        <span className="small">期</span>
                        {formTotal(f) > 0 && (
                          <span className="hint">
                            每期約 {fmtMoney(Math.floor(formTotal(f) / installN), currency)}（零頭在第 1 期）
                          </span>
                        )}
                      </div>
                      <p className="hint">會記成 {installN} 筆，每個月同一天一筆（備註「1/{installN} 期」⋯⋯），每一期算在那個月的預算。</p>
                    </>
                  )}
                </div>
              )}
              {feeCard && existingFee && (
                <div className="subbox">
                  <p className="small">已記國外交易手續費 {fmtMoney(existingFee.amount ?? 0, currency)}</p>
                  {feeChanged && (
                    <p className="hint warn">
                      金額改了，手續費那筆不會自動跟著改，記得也去改（照費率約 {fmtMoney(estimateFee(Math.max(0, formTotal(f)), feeCard.fxFeeRate ?? null), currency)}）。
                    </p>
                  )}
                </div>
              )}
              {feeCard && !existingFee && (
                <div className="subbox">
                  <label className="check">
                    <input type="checkbox" checked={feeOn} onChange={(e) => setFeeOnState(e.target.checked)} />
                    {txn ? '＋補記' : '＋'}國外交易手續費（{feeCard.fxFeeRate ?? 1.5}%）
                  </label>
                  {feeOn && (
                    <div className="row">
                      <AmountInput value={feeAmount} onChange={(n) => setFeeEdit(n)} />
                      <span className="hint">另外記一筆，分類記在「…／國外交易手續費」，預算、標籤跟著這筆；店家記 {feeCard.org ?? '發卡銀行'}。對帳時可改成帳單金額。</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {f.mode === '收入' && (
            <>
              <label className="field">
                存入帳戶
                <AccountSelect snap={snap} value={f.account} onChange={(v) => set({ account: v })} />
              </label>
              {storePicker('收入')}
              {catRows('收入')}
            </>
          )}

          {f.mode === '轉帳' && (
            <>
              <label className="field">
                從
                <AccountSelect snap={snap} value={f.account} onChange={(v) => set({ account: v })} placeholder="轉出帳戶" />
              </label>
              <label className="field">
                到
                <AccountSelect snap={snap} value={f.toAccount} onChange={(v) => set({ toAccount: v })} placeholder="轉入帳戶" />
              </label>
              <label className="field">
                金額{from ? `（${from.currency}）` : ''}
                <AmountInput value={f.amount} onChange={(n) => set({ amount: n })} />
              </label>
              {from && to && from.currency !== to.currency && (
                <label className="field">
                  轉入帳戶收到多少（{to.currency}）
                  <AmountInput value={f.toAmount} onChange={(n) => set({ toAmount: n })} />
                  {f.amount && f.toAmount ? (
                    <span className="hint">
                      匯率：1 {to.currency === 'TWD' ? from.currency : to.currency} ≈{' '}
                      {to.currency === 'TWD' ? (f.toAmount / f.amount).toFixed(4) : (f.amount / f.toAmount).toFixed(5)}{' '}
                      {to.currency === 'TWD' ? 'TWD' : from.currency}
                    </span>
                  ) : null}
                </label>
              )}
              {to?.type === '信用卡' && <PayStatement snap={snap} card={to.name} value={f.statement} isNew={!txn} onChange={(v) => set({ statement: v })} />}
              <p className="hint">提款、繳卡費、加值悠遊卡、換外幣、開定存都用轉帳（不算收支）。</p>
            </>
          )}

          {(f.mode === '借款' || f.mode === '還款' || f.mode === '不用還了') && (
            <>
              <div className="seg modes">
                {(f.mode === '借款' ? (['借出', '借入'] as const) : (['他還我', '我還他'] as const)).map((s) => (
                  <button key={s} className={f.sub === s ? 'active' : ''} onClick={() => set({ sub: s })}>
                    {f.mode === '不用還了' ? (s === '他還我' ? '他欠我的不收了' : '我欠他的不用還了') : f.mode === '借款' ? (s === '借出' ? '借給別人' : '向別人借') : s}
                  </button>
                ))}
              </div>
              <label className="field">
                誰
                <PersonSelect people={snap.people} value={f.person} onChange={(v) => set({ person: v })} onAdd={addPerson} />
              </label>
              {f.mode !== '借款' && balanceHint()}
              {f.mode !== '不用還了' ? (
                <label className="field">
                  {(f.mode === '借款' && f.sub === '借出') || (f.mode === '還款' && f.sub === '我還他') ? '從哪個帳戶出' : '存入哪個帳戶'}
                  <AccountSelect snap={snap} value={f.account} onChange={(v) => set({ account: v })} />
                </label>
              ) : (
                <>
                  <label className="field">
                    {f.sub === '我還他' ? '算成哪一種收入' : '算成哪一種支出'}
                    <CategoryPicker
                      api={api}
                      snap={snap}
                      kind={f.sub === '我還他' ? '收入' : '支出'}
                      value={f.cats[0]?.category ?? null}
                      onChange={(v) => set({ cats: [withBudget({ category: v, amount: null })] })}
                    />
                  </label>
                  <label className="field">
                    幣別
                    <select value={f.currency ?? 'TWD'} onChange={(e) => set({ currency: e.target.value === 'TWD' ? null : e.target.value })}>
                      {currencies.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <label className="field">
                金額
                <AmountInput value={f.amount} onChange={(n) => set({ amount: n })} />
              </label>
              {f.mode === '借款' && <p className="hint">借錢只是錢進出帳戶，不算收支、不扣預算。</p>}
            </>
          )}

          {(txn?.statementText || editing.form.statementText) && (
            <label className="field">
              帳單名稱
              <input value={f.statementText ?? ''} onChange={(e) => set({ statementText: e.target.value })} />
            </label>
          )}
          <label className="field">
            備註
            <input value={f.note ?? ''} onChange={(e) => set({ note: e.target.value })} />
          </label>
          {noteChips.length > 0 && (
            <div className="chips note-chips">
              <span className="chips-label">常用</span>
              {noteChips.map((x) => (
                <button type="button" key={x} className="chip" onClick={() => set({ note: f.note?.trim() ? `${f.note.trim()}、${x}` : x })}>
                  {x}
                </button>
              ))}
            </div>
          )}
          <label className="field">
            標籤（多個用「、」分開，例：2026東京）
            <input defaultValue={f.tags.join('、')} onChange={(e) => set({ tags: splitTags(e.target.value) })} />
          </label>
        </>
      )}

      {problems.length > 0 && (
        <ul className="problems">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div className="editor-actions">
        {editable && (
          <button className="primary" onClick={save} disabled={api.busy}>
            儲存
          </button>
        )}
        <button onClick={onClose}>取消</button>
        <span className="spacer" />
        {txn && (
          <button className="danger" onClick={remove} disabled={api.busy}>
            刪除
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * 繳卡費：繳哪一期（2026-11-18 確認：預設最早沒繳的）。
 * 新增時自動選最早沒繳的那一期；修改時照原本的。
 */
function PayStatement({ snap, card, value, isNew, onChange }: { snap: MoneySnapshot; card: string; value: string | null | undefined; isNew: boolean; onChange: (v: string | null) => void }) {
  const unpaid = unpaidStatements(snap, card);
  const all = snap.statements.filter((s) => s.account === card);
  const cur = snap.accounts.find((a) => a.name === card)?.currency ?? 'TWD';
  useEffect(() => {
    // 新增時（或換了另一張卡）：預設最早沒繳的那一期
    if (isNew && (value === undefined || (value && !all.some((s) => s.id === value)))) onChange(unpaid[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card]);
  if (!all.length) return null;
  const list = all.filter((s) => unpaid.includes(s) || s.id === value);
  return (
    <label className="field">
      繳哪一期
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">不指定</option>
        {list.map((s) => (
          <option key={s.id} value={s.id}>
            {s.closeDate.replace(/-/g, '/')} 結帳
            {s.amountDue != null ? `・應繳 ${fmtMoney(s.amountDue, cur)}` : ''}
            {s.dueDate ? `・${s.dueDate.slice(5).replace('-', '/')} 前` : ''}
            {unpaid.includes(s) ? '' : '（已繳清）'}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 一行明細的備註＋這個分類的常用文字（點輸入框時才出現，點了加在後面） */
function LineNote({ snap, category, value, onChange }: { snap: MoneySnapshot; category: string | null; value: string | null; onChange: (v: string | null) => void }) {
  const [focus, setFocus] = useState(false);
  const all = useMemo(() => noteSuggestions(snap.txns, category ? [category] : []), [snap.txns, category]);
  const chips = all.filter((x) => !(value ?? '').split('、').map((y) => y.trim()).includes(x));
  return (
    <div className="line-note">
      <input value={value ?? ''} placeholder="這一行的備註" onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} onChange={(e) => onChange(e.target.value || null)} />
      {focus && chips.length > 0 && (
        <div className="chips">
          {chips.map((x) => (
            <button
              type="button"
              key={x}
              className="chip"
              // 按下時不要讓輸入框失去焦點（常用文字才不會先消失）
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange(value?.trim() ? `${value.trim()}、${x}` : x)}
            >
              {x}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
