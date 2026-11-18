import { useEffect, useMemo, useState } from 'react';
import type { EntryForm, MoneySnapshot } from '@life/db';
import {
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
  txnToForm,
} from '@life/db';
import type { Editing } from '../App';
import type { MoneyApi } from '../useMoney';
import { AccountSelect, amountText, CategorySelect, parseAmount, PersonSelect } from './common';

/** 金額輸入：自己記住打到一半的文字（例：「12.」） */
function AmountInput({ value, onChange, placeholder = '金額' }: { value: number | null; onChange: (n: number | null) => void; placeholder?: string }) {
  const [s, setS] = useState(amountText(value));
  useEffect(() => {
    if (!Object.is(parseAmount(s), value)) setS(amountText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      inputMode="decimal"
      placeholder={placeholder}
      value={s}
      onChange={(e) => {
        setS(e.target.value);
        onChange(parseAmount(e.target.value));
      }}
    />
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
    const ok = await api.run((s) => s.saveTxn(tx, txn).then(() => true));
    if (ok) {
      api.showToast({ kind: 'info', text: txn ? '已修改' : '已記錄' });
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
  const catRows = (kind: '支出' | '收入') => (
    <div className="field">
      {f.shares.length || paidByMode ? '我的部分' : '分類'}
      <div className="split-rows">
        {f.cats.map((c, i) => (
          <div className="row" key={i}>
            <CategorySelect
              categories={snap.categories}
              kind={kind}
              value={c.category}
              onChange={(v) => set({ cats: f.cats.map((x, j) => (j === i ? { ...x, category: v } : x)) })}
            />
            <AmountInput value={c.amount} onChange={(n) => set({ cats: f.cats.map((x, j) => (j === i ? { ...x, amount: n } : x)) })} />
            {f.cats.length > 1 && (
              <button className="x-btn" onClick={() => set({ cats: f.cats.filter((_, j) => j !== i) })} aria-label="移除">
                ✕
              </button>
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

  const from = snap.accounts.find((a) => a.name === f.account);
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
            </>
          )}

          {f.mode === '收入' && (
            <>
              <label className="field">
                存入帳戶
                <AccountSelect snap={snap} value={f.account} onChange={(v) => set({ account: v })} />
              </label>
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
                    <CategorySelect
                      categories={snap.categories}
                      kind={f.sub === '我還他' ? '收入' : '支出'}
                      value={f.cats[0]?.category ?? null}
                      onChange={(v) => set({ cats: [{ category: v, amount: null }] })}
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

          {f.mode !== '轉帳' && f.mode !== '借款' && f.mode !== '還款' && f.mode !== '不用還了' && (
            <label className="field">
              店家
              <input value={f.store ?? ''} onChange={(e) => set({ store: e.target.value })} list="money-stores" />
              <datalist id="money-stores">
                {[...new Set(snap.txns.map((t) => t.store).filter(Boolean))].slice(0, 50).map((s) => (
                  <option key={s} value={s!} />
                ))}
              </datalist>
            </label>
          )}
          <label className="field">
            備註
            <input value={f.note ?? ''} onChange={(e) => set({ note: e.target.value })} />
          </label>
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
