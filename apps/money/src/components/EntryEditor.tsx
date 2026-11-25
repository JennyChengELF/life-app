import { useEffect, useMemo, useState } from 'react';
import type { EntryForm, MoneySnapshot, Txn, TxnInput } from '@life/db';
import {
  noteSuggestions,
  unpaidStatements,
  statementPaid,
  checkTxn,
  ENTRY_MODES,
  fmtMoney,
  formToTxn,
  formTotal,
  cardPaymentTotal,
  personBalances,
  splitEven,
  startOfDay,
  toDateKey,
  toHHmm,
  txnCurrency,
  defaultBudgetFor,
  estimateFee,
  feeTxnFrom,
  installmentTxns,
  findFeeTxn,
  isFeeTxn,
  lastCategoryOfStore,
  txnToForm,
  backfillBudgetNames,
} from '@life/db';
import type { Editing } from '../App';
import type { MoneyApi } from '../useMoney';
import { AccountSelect, amountText, parseAmount, PersonSelect } from './common';
import { CategoryPicker } from './CategoryPicker';
import { StorePicker } from './StorePicker';
import { Icon } from '@life/ui/icon';
import { BudgetSelect } from './BudgetSelect';
import { TimeField } from '@life/ui/time-field';
import { WeekDateStrip } from '@life/ui/week-date-strip';
import { TagPicker } from '@life/ui/tag-picker';

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

export function EntryEditor({ api, snap, editing, onClose, onSavedDate, onCopy, hideModeSwitch = false }: { api: MoneyApi; snap: MoneySnapshot; editing: Editing; onClose: () => void; onSavedDate?: (date: string) => void; onCopy?: () => void; hideModeSwitch?: boolean }) {
  const txn = editing.txn;
  const [f, setF] = useState<EntryForm>(() => {
    const form = txn ? txnToForm(txn) : editing.form;
    const first = form.cardPayments[0]?.account;
    return first ? { ...form, cardPaymentOrg: snap.accounts.find((a) => a.name === first)?.org ?? null } : form;
  });
  const [multiCard, setMultiCard] = useState(() => f.cardPayments.length > 0);
  const [problems, setProblems] = useState<string[]>([]);
  const [splitTotal, setSplitTotal] = useState<number | null>(null);
  const [splitN, setSplitN] = useState(2);
  const [paidByMode, setPaidByMode] = useState(!!f.paidBy);
  /** 目前第一筆分類是否仍是依店家自動帶入；使用者手動選過後清除。 */
  const [autoStoreCategory, setAutoStoreCategory] = useState<string | null>(null);
  /** 國外交易手續費（信用卡支出）：null = 自動（新增時國外店家就勾；修改時不勾） */
  const [feeOnState, setFeeOnState] = useState<boolean | null>(() => (editing.copied ? false : null));
  /** 新的店家（還不在機構清單）先記在這裡，存檔時一起建立 */
  const [newForeign, setNewForeign] = useState(false);
  const [feeEdit, setFeeEdit] = useState<number | null>(null);
  /** 分期（只有新增、用帳戶付的支出） */
  const [installOn, setInstallOn] = useState(false);
  const [installN, setInstallN] = useState(6);
  /** 修改前的金額：改了金額要提醒手續費那筆也要改 */
  const [initTotal] = useState(() => formTotal(f));
  const set = (patch: Partial<EntryForm>) => setF((x) => ({ ...x, ...patch }));
  /** 2026-11-23 使用者決定：新增與編輯都能改日期、可選未來；只換日期並保留原本時間。 */
  const setEntryDate = (value: string) => {
    if (!value) return;
    const [hour, minute] = toHHmm(f.time).split(':').map(Number);
    const next = new Date(startOfDay(value));
    next.setHours(hour, minute, 0, 0);
    set({ time: next.getTime() });
  };

  const editable = ENTRY_MODES.includes(f.mode as (typeof ENTRY_MODES)[number]) || f.mode === '不用還了';
  const currency = txnCurrency({ account: f.account, currency: f.currency }, snap.accounts);
  const addPerson = (name: string) => api.run((s) => s.addPerson(name));
  const currencies = useMemo(() => [...new Set(['TWD', ...snap.accounts.map((a) => a.currency)])], [snap.accounts]);

  const switchMode = (mode: EntryForm['mode']) => {
    setAutoStoreCategory(null);
    set({ mode, sub: mode === '還款' ? '他還我' : null, cats: [{ category: null, amount: null }], counterCats: [], shares: [], paidBy: null });
  };

  const save = async () => {
    let tx;
    try {
      tx = formToTxn(paidByMode ? f : { ...f, paidBy: null });
    } catch (e) {
      return setProblems([e instanceof Error ? e.message : String(e)]);
    }
    const p = checkTxn(tx, snap);
    if (multiCard && !f.cardPaymentOrg) p.unshift('請選發卡機構');
    if (multiCard && !f.cardPayments.length) p.unshift('請至少勾選一期帳單');
    if (paidByMode && !f.paidBy) p.unshift('請選誰先幫你付');
    setProblems(p);
    if (p.length) return;
    const backfill = backfillBudgetNames(snap, tx);
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
      const savedText = parts
        ? `已記錄 ${parts.length} 期${feeTx ? '（含手續費）' : ''}`
        : txn
          ? feeTx
            ? '已修改（補記手續費）'
            : feeChanged
              ? '已修改；手續費那筆不會自動改，記得也去改'
              : '已修改'
          : feeTx
            ? '已記錄（含手續費）'
            : '已記錄';
      api.showToast({
        kind: 'info',
        text: backfill.length ? `${savedText}；這筆早於最新期初，只會重算舊月份，不會改動已整理的新預算` : savedText,
      });
      onSavedDate?.(toDateKey(f.time));
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
              autoFilled={i === 0 && !!autoStoreCategory && autoStoreCategory === c.category}
              onChange={(v) => {
                const wasAuto = i === 0 && !!autoStoreCategory;
                setAutoStoreCategory(null);
                set({
                  cats: f.cats.map((x, j) =>
                    j === i ? withBudget({ ...x, category: v, budget: wasAuto ? defaultBudgetFor(snap, v) : x.budget }) : x,
                  ),
                });
              }}
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
      <button className="chip-add" onClick={() => set({ cats: [...f.cats, { category: null, amount: null }] })}>
        ＋ 分類
      </button>
    </div>
  );

  /** 2026-11-21 使用者決定：支出可加收入折抵；收入可加支出扣除，帳戶只依淨額增減。 */
  const counterCatRows = (kind: '支出' | '收入') => {
    const title = kind === '收入' ? '折抵／收入項目' : '扣除／支出項目';
    return (
      <div className="field">
        {f.counterCats.length > 0 && title}
        <div className="split-rows">
          {f.counterCats.map((c, i) => (
            <div className="cat-line" key={i}>
              <div className="row">
                <AmountInput value={c.amount} onChange={(n) => set({ counterCats: f.counterCats.map((x, j) => (j === i ? { ...x, amount: n } : x)) })} />
                <button className="x-btn" onClick={() => set({ counterCats: f.counterCats.filter((_, j) => j !== i) })} aria-label="移除">
                  ✕
                </button>
              </div>
              <CategoryPicker
                api={api}
                snap={snap}
                kind={kind}
                value={c.category}
                onChange={(v) => set({ counterCats: f.counterCats.map((x, j) => (j === i ? withBudget({ ...x, category: v }) : x)) })}
              />
              <BudgetSelect
                snap={snap}
                kind={kind}
                value={c.budget ?? null}
                onChange={(v) => set({ counterCats: f.counterCats.map((x, j) => (j === i ? { ...x, budget: v } : x)) })}
              />
              <LineNote
                snap={snap}
                category={c.category}
                value={c.note ?? null}
                onChange={(v) => set({ counterCats: f.counterCats.map((x, j) => (j === i ? { ...x, note: v } : x)) })}
              />
            </div>
          ))}
        </div>
        <button className="chip-add" onClick={() => set({ counterCats: [...f.counterCats, { category: null, amount: null }] })}>
          ＋ {title}
        </button>
      </div>
    );
  };

  /**
   * 選人物的明細（2026-11-19）：支出 = 他欠我（代墊、借給他）；收入 = 我欠他（向他借）。
   * 不選分類、不算收支；可以填備註（例：借款、幫忙買票）。
   */
  const shareRows = (kind: '支出' | '收入') => (
    <div className="field">
      {f.shares.length > 0 && (kind === '支出' ? '人物（他欠我：代墊、借給他；不算我的支出）' : '人物（我欠他：向他借；不算我的收入）')}
      <div className="split-rows">
        {f.shares.map((s, i) => (
          <div className="cat-line" key={i}>
            <div className="row">
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
            <div className="line-note">
              <input
                value={s.note ?? ''}
                placeholder="這一行的備註（例：借款）"
                onChange={(e) => set({ shares: f.shares.map((x, j) => (j === i ? { ...x, note: e.target.value || null } : x)) })}
              />
            </div>
          </div>
        ))}
      </div>
      <button className="chip-add" onClick={() => set({ shares: [...f.shares, { person: null, amount: null }] })}>
        {kind === '支出' ? '＋ 人物（他欠我）' : '＋ 人物（我欠他）'}
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

  // 2026-11-21 使用者決定：店家自動帶入的分類立即收合；手動選過後不再被店家覆蓋。
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
        const one = f.cats.length === 1;
        const canAuto = one && (!f.cats[0].category || f.cats[0].category === autoStoreCategory);
        if (last && canAuto) {
          setAutoStoreCategory(last);
          set({ store: v, cats: [{ ...f.cats[0], category: last, budget: defaultBudgetFor(snap, last) }] });
        } else if (!last && one && f.cats[0].category === autoStoreCategory) {
          // 換成沒有歷史分類的店家：清掉上一家自動帶入的值，正常展開讓使用者選。
          setAutoStoreCategory(null);
          set({ store: v, cats: [{ ...f.cats[0], category: null, budget: null }] });
        } else set({ store: v });
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
  const backfillPreview = (() => {
    try {
      return backfillBudgetNames(snap, formToTxn(paidByMode ? f : { ...f, paidBy: null }));
    } catch {
      return [];
    }
  })();

  return (
    <section className="editor">
      <h2>
        <span>{txn ? '修改' : '記一筆'}{MODE_TITLE[f.mode] ? `：${MODE_TITLE[f.mode]}` : ''}</span>
        <button className="link" onClick={onClose} aria-label="關閉">
          <Icon name="x" />
        </button>
      </h2>

      {!hideModeSwitch && !txn && ENTRY_MODES.includes(f.mode as (typeof ENTRY_MODES)[number]) && (
        <div className="seg modes">
          {ENTRY_MODES.map((m) => (
            <button key={m} className={f.mode === m ? 'active' : ''} onClick={() => switchMode(m)}>
              {m}
            </button>
          ))}
        </div>
      )}

      {/* 2026-11-19 改版：最上面用大字顯示總額 */}
      {(f.mode === '支出' || f.mode === '收入') && (
        <div className="total-head">
          <div className="sum-label">
            {f.mode === '收入'
              ? f.counterCats.length
                ? '帳戶實際入帳'
                : '收到'
              : paidByMode
                ? `${f.paidBy ?? '朋友'} 幫我付（我的部分）`
                : f.counterCats.length
                  ? '帳戶實際支出'
                  : '我付了'}
          </div>
          <div className={`total-big num${f.mode === '收入' ? ' in' : ''}`}>{fmtMoney(formTotal(f), currency)}</div>
          {!paidByMode && f.counterCats.length > 0 && (
            <div className="hint">
              {f.mode === '支出' ? (f.shares.length ? '支出／人物' : '支出') : f.shares.length ? '收入／人物' : '收入'}{' '}
              {fmtMoney(f.cats.reduce((n, c) => n + (c.amount ?? 0), 0) + f.shares.reduce((n, s) => n + (s.amount ?? 0), 0), currency)} −{' '}
              {f.mode === '支出' ? '折抵／收入' : '扣除／支出'}{' '}
              {fmtMoney(f.counterCats.reduce((n, c) => n + (c.amount ?? 0), 0), currency)}
            </div>
          )}
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
          {/* （2026-11-23 使用者決定：新增與編輯都可用週日期列改成未來日期，儲存後才生效。） */}
          <WeekDateStrip selected={toDateKey(f.time)} setDate={setEntryDate} />
          <div className="entry-when">
            <label className="field">記帳日期
              <input type="date" value={toDateKey(f.time)} onChange={(event) => setEntryDate(event.target.value)} />
            </label>
            <TimeField value={toHHmm(f.time)} onChange={(value) => {
              const [hour, minute] = value.split(':').map(Number);
              const next = new Date(startOfDay(toDateKey(f.time)));
              next.setHours(hour, minute, 0, 0);
              set({ time: next.getTime() });
            }} label="時間（24 小時制）" />
          </div>

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

              {!paidByMode && counterCatRows('收入')}

              {!paidByMode && shareRows('支出')}

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
              {counterCatRows('支出')}
              {shareRows('收入')}
            </>
          )}

          {f.mode === '轉帳' && (
            <>
              <label className="field">
                從
                <AccountSelect snap={snap} value={f.account} onChange={(v) => set({ account: v })} placeholder="轉出帳戶" />
              </label>
              <div className="subbox">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={multiCard}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setMultiCard(on);
                      set(on ? { toAccount: null, toAmount: null, statement: null } : { cardPaymentOrg: null, cardPayments: [] });
                    }}
                  />
                  同一筆扣款繳多張卡／多個帳單
                </label>
              </div>
              {multiCard ? (
                <MultiCardPayment snap={snap} form={f} current={txn ?? null} onChange={set} />
              ) : (
                <>
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
                </>
              )}
              <p className="hint">提款、繳卡費、加值悠遊卡、換外幣、開定存都用轉帳（不算收支）。</p>
            </>
          )}

          {(f.mode === '還款' || f.mode === '不用還了') && (
            <>
              <div className="seg modes">
                {(['他還我', '我還他'] as const).map((s) => (
                  <button key={s} className={f.sub === s ? 'active' : ''} onClick={() => set({ sub: s })}>
                    {f.mode === '不用還了' ? (s === '他還我' ? '他欠我的不收了' : '我欠他的不用還了') : s}
                  </button>
                ))}
              </div>
              <label className="field">
                誰
                <PersonSelect people={snap.people} value={f.person} onChange={(v) => set({ person: v })} onAdd={addPerson} />
              </label>
              {balanceHint()}
              {f.mode !== '不用還了' ? (
                <label className="field">
                  {f.sub === '我還他' ? '從哪個帳戶出' : '存入哪個帳戶'}
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
            </>
          )}

          {backfillPreview.length > 0 && (
            <div className="msg info">
              補登日期早於「{backfillPreview.join('、')}」最新的預算期初；儲存後只會重算舊月份，不會改動已整理的新預算。
            </div>
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
          <TagPicker tags={snap.sharedTags} selected={f.tagIds} busy={api.busy} onChange={(tagIds) => set({ tagIds })} onAdd={(name) => api.run((store) => store.addTag(name))} />
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
        {txn && onCopy && (
          <button onClick={onCopy} disabled={api.busy}>
            複製一筆
          </button>
        )}
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
 * 一筆銀行扣款分配到同一家發卡機構的多張卡／多期帳單。
 * 2026-11-21 使用者決定：預設帶尚未繳的金額，仍可改成部分繳款；同一期之後也能再繳。
 */
function MultiCardPayment({
  snap,
  form,
  current,
  onChange,
}: {
  snap: MoneySnapshot;
  form: EntryForm;
  current: Txn | null;
  onChange: (patch: Partial<EntryForm>) => void;
}) {
  const cards = snap.accounts.filter((a) => a.type === '信用卡' && (!a.archived || form.cardPayments.some((x) => x.account === a.name)));
  const orgs = [...new Set(cards.map((a) => a.org).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  const orgCards = cards.filter((a) => a.org === form.cardPaymentOrg);
  const selectedIds = new Set(form.cardPayments.map((x) => x.statement).filter(Boolean));
  const otherTxns = current ? snap.txns.filter((t) => t.id !== current.id) : snap.txns;
  const options = orgCards
    .flatMap((card) =>
      snap.statements
        .filter((s) => s.account === card.name && (selectedIds.has(s.id) || unpaidStatements({ ...snap, txns: otherTxns }, card.name).some((u) => u.id === s.id)))
        .map((statement) => ({ card, statement })),
    )
    .sort((a, b) => a.statement.closeDate.localeCompare(b.statement.closeDate) || a.card.name.localeCompare(b.card.name, 'zh-Hant'));
  const sourceCurrency = snap.accounts.find((a) => a.name === form.account)?.currency ?? 'TWD';

  const toggle = (account: string, statement: string, checked: boolean) => {
    if (!checked) return onChange({ cardPayments: form.cardPayments.filter((x) => x.statement !== statement) });
    const stmt = snap.statements.find((s) => s.id === statement)!;
    const paid = statementPaid(stmt, otherTxns);
    const remaining = stmt.amountDue == null ? null : Math.max(0, stmt.amountDue - paid);
    onChange({ cardPayments: [...form.cardPayments, { account, statement, amount: remaining && remaining > 0 ? remaining : null }] });
  };

  return (
    <div className="subbox">
      <label className="field">
        發卡機構
        <select
          value={form.cardPaymentOrg ?? ''}
          onChange={(e) => onChange({ cardPaymentOrg: e.target.value || null, cardPayments: [] })}
        >
          <option value="">請選擇</option>
          {orgs.map((org) => (
            <option key={org}>{org}</option>
          ))}
        </select>
      </label>
      {form.cardPaymentOrg && !options.length && <p className="hint">這家機構目前沒有未繳帳單。若帳單尚未建立，請先到信用卡帳戶的「帳單對帳」新增。</p>}
      {options.map(({ card, statement }) => {
        const payment = form.cardPayments.find((x) => x.statement === statement.id);
        const paid = statementPaid(statement, otherTxns);
        const remaining = statement.amountDue == null ? null : Math.max(0, statement.amountDue - paid);
        const label = card.last4 ? `${card.name}（${card.last4}）` : card.name;
        return (
          <div className="card-payment-row" key={statement.id}>
            <label className="check card-payment-check">
              <input type="checkbox" checked={!!payment} onChange={(e) => toggle(card.name, statement.id, e.target.checked)} />
              <span>
                <strong>{label}</strong>
                <span className="small muted">{statement.closeDate.replace(/-/g, '/')} 結帳</span>
              </span>
            </label>
            <div className="small muted">
              {remaining == null ? '尚未填應繳金額' : `尚未繳 ${fmtMoney(remaining, card.currency)}`}
              {statement.dueDate ? `・${statement.dueDate.slice(5).replace('-', '/')} 前` : ''}
            </div>
            {payment && (
              <label className="field card-payment-amount">
                這次分配
                <AmountInput
                  value={payment.amount}
                  onChange={(amount) => onChange({ cardPayments: form.cardPayments.map((x) => (x.statement === statement.id ? { ...x, amount } : x)) })}
                />
              </label>
            )}
          </div>
        );
      })}
      {form.cardPayments.length > 0 && (
        <div className="total-head card-payment-total">
          <div className="sum-label">銀行實際扣款</div>
          <div className="total-big num">{fmtMoney(cardPaymentTotal(form), sourceCurrency)}</div>
          <div className="hint">等於上面各帳單的分配加總</div>
        </div>
      )}
      <p className="hint">只列出同一家機構尚未繳清的帳單；若銀行是合併帳單，只勾合併後的那一期即可。</p>
    </div>
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
