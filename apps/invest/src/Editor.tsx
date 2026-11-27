import { useState } from 'react';
import { WeekDateStrip } from '@life/ui/week-date-strip';
import {
  blankInvestEvent, canGenerateCash, dividendEligibility, dividendEstimate, impliedInvestPrice, INVEST_KINDS, investCategory,
  investIsDividend, investIsPurchase, investIsSale, investmentMemo, type InvestEvent, type InvestKind,
  type InvestSnapshot, type MoneySnapshot,
} from '@life/db';

export const format = (n: number | null | undefined) => n == null ? '—'
  : new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 10 }).format(n);

export function dividendHint(e: InvestEvent, snap: InvestSnapshot) {
  if (!investIsDividend(e) || e.eligible == null) return '';
  const expected = dividendEligibility(e, snap.assets, snap.events);
  if (expected == null) return '股數待核對';
  const diff = e.eligible - expected;
  return Math.abs(diff) < 1e-8 ? '與應分配股數相符'
    : `股數待核對：通知單比 APP ${diff > 0 ? '多' : '少'} ${format(Math.abs(diff))}，請檢查漏記交易或日期。`;
}

export function Editor({ initial, day, onDate, snap, money, busy, fromMoney, linking, onSave, onCash, onMoney, onRemove, onUnlink, onCancel }: {
  day: string; onDate: (date: string) => void;
  initial: InvestEvent; snap: InvestSnapshot; money: MoneySnapshot | null; busy: boolean; fromMoney: boolean;
  linking?: boolean;
  onSave: (e: InvestEvent, cash: boolean) => void; onCash: () => void; onMoney: (e: InvestEvent, id: string) => void;
  onRemove: (e: InvestEvent) => void; onUnlink: (e: InvestEvent) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [wantCash, setWantCash] = useState(fromMoney || initial.moneyMode === 'generated');
  const [link, setLink] = useState('');
  const [showLink, setShowLink] = useState(false);
  const a = snap.assets.find((asset) => asset.id === draft.asset);
  const patch = (value: Partial<InvestEvent>) => setDraft((e) => ({ ...e, ...value }));
  const changeKind = (kind: InvestKind) => setDraft((e) => ({
    ...blankInvestEvent(kind, kind === 'dividend' ? '' : e.tradeDate || e.cashDate), id: e.id,
    asset: e.asset, cashDate: e.cashDate || (kind === 'dividend' ? e.tradeDate : ''),
  }));
  const num = (field: keyof InvestEvent, label: string) => <label className="field">{label}
    <input type="number" step="any" min="0" value={String(draft[field] ?? '')} onChange={(e) =>
      patch({ [field]: e.currentTarget.value === '' ? null : e.currentTarget.valueAsNumber })} />
  </label>;
  const date = (field: 'tradeDate' | 'cashDate' | 'secondDate' | 'exDate', label: string) => <label className="field">{label}
    <input type="date" value={draft[field]} onChange={(e) => {
      const value = e.currentTarget.value;
      patch({ [field]: value });
      if (value && (field === 'tradeDate' || (field === 'cashDate' && draft.kind === 'dividend'))) onDate(value);
    }} />
  </label>;
  const text = (field: 'cashCurrency' | 'note', label: string) => <label className="field">{label}
    <input value={draft[field]} onChange={(e) => patch({ [field]: e.currentTarget.value })} />
  </label>;
  const isDividend = investIsDividend(draft);
  const isCashDividend = draft.kind === 'dividend';
  const isSwitch = draft.kind === 'switch';
  const gen = canGenerateCash(draft) && draft.moneyMode !== 'linked';
  const forecast = a && isCashDividend ? dividendEstimate(draft, dividendEligibility(draft, snap.assets, snap.events), a) : null;
  const implied = a && (investIsPurchase(draft) || investIsSale(draft)) ? impliedInvestPrice(draft, a) : null;
  const eligible = isDividend ? dividendEligibility(draft, snap.assets, snap.events) : null;
  const eligibleHint = dividendHint(draft, snap);
  const root = a ? investCategory(draft, a) : '';
  const candidates = money?.categories.filter((cat) => !cat.archived && cat.path.startsWith(`${root} / `) &&
    cat.kind === (investIsSale(draft) || isCashDividend ? '收入' : '支出')) ?? [];
  const showCash = gen && wantCash;
  const generated = draft.moneyMode === 'generated';
  const historic = draft.moneyMode === 'linked';
  const linkedTxn = money?.txns.find((txn) => txn.id === draft.moneyId);
  const linkOptions = (money?.txns ?? []).filter((txn) => (!txn.investmentId || (draft.kind === 'buy' && !txn.investmentGenerated)) &&
    txn.direction === (isCashDividend || investIsSale(draft) ? '入' : '出')).sort((x, y) => y.date.localeCompare(x.date));
  function enableCash() {
    if (!wantCash) {
      onCash();
      if (isCashDividend && draft.cashAmount == null && forecast != null) return setWantCash(true);
    }
    setWantCash((v) => !v);
  }
  return <form className="card" onSubmit={(ev) => { ev.preventDefault(); onSave(draft, showCash); }}>
    <WeekDateStrip selected={(isCashDividend ? draft.cashDate : draft.tradeDate) || draft.cashDate || day} setDate={(date) => {
      patch(isCashDividend ? { cashDate: date } : { tradeDate: date });
      onDate(date);
    }} />
    <h2>{draft.id ? '修改投資紀錄' : '新增投資紀錄'}</h2>
    <div className="invest-grid">
      <label className="field">交易種類<select value={draft.kind} disabled={!!draft.id} onChange={(e) => changeKind(e.currentTarget.value as InvestKind)}>
        {Object.entries(INVEST_KINDS).filter(([k]) => !fromMoney || k === draft.kind || !['switch', 'stockDividend', 'bonus', 'insuranceCost', 'policyFee'].includes(k))
          .map(([k, title]) => <option value={k} key={k}>{title}</option>)}</select></label>
      <label className="field">投資標的<select required value={draft.asset} onChange={(e) => {
        const asset = snap.assets.find((x) => x.id === e.currentTarget.value);
        patch({ asset: asset?.id ?? '', category: '', cashCurrency: draft.cashAccount ? draft.cashCurrency : asset?.currency || 'TWD' });
      }}><option value="">選擇標的</option>{snap.assets.map((asset) => <option key={asset.id} value={asset.id}>
        {asset.symbol} {asset.name}{asset.account ? ` · ${asset.account}` : ''}
      </option>)}</select></label>
      {isDividend && date('exDate', draft.kind === 'stockDividend' ? '除權日' : '除息日')}
      {!isCashDividend && date('tradeDate', isSwitch ? '換出日' : draft.kind === 'stockDividend' ? '實際入股日' : '成交／實際價格日')}
      {(gen || historic || isCashDividend) && date('cashDate', isCashDividend ? '發放／實際入帳日' : '扣款／入帳日')}
      {!isCashDividend && num('quantity', draft.kind === 'stockDividend' ? '實際配發股數' : isSwitch ? '換出單位數' : a?.kind === 'stock' ? '股數' : '單位數')}
      {!isDividend && num('price', a?.kind === 'stock' ? '每股成交價' : isSwitch ? '換出淨值' : '成交淨值')}
      {isDividend && num('eligible', '通知單上的符合資格股數／單位')}
      {isDividend && num('perUnit', isCashDividend ? '每股／單位配息' : '每股配發股數（選填）')}
      {draft.kind !== 'stockDividend' && num('originalAmount', isCashDividend ? '原幣股利毛額' : isSwitch ? '原幣換出金額' : '原幣成交金額')}
      {!isSwitch && draft.kind !== 'stockDividend' && num('fee', isCashDividend ? '匯費（選填）' : '手續費（選填）')}
      {(!isSwitch && (isCashDividend || investIsSale(draft))) && num('tax', isCashDividend ? '補扣繳稅額' : '交易稅')}
      {isCashDividend && num('healthFee', '二代健保補充保費')}
      {!isSwitch && (gen || historic) && num('cashAmount', isCashDividend || investIsSale(draft) ? '實收金額' : '實際扣款金額')}
      {(gen || historic || isCashDividend) && (!wantCash || historic) && text('cashCurrency', '實收／扣款幣別')}
      {draft.kind !== 'stockDividend' && num('fx', isSwitch ? '換入幣別對台幣匯率（選填）' : '交易匯率（每單位原幣值多少台幣）')}
      {isSwitch && <>
        <label className="field">換入基金<select value={draft.secondAsset} onChange={(e) => patch({ secondAsset: e.currentTarget.value })}>
          <option value="">選擇換入基金</option>{snap.assets.filter((x) => x.kind !== 'stock' && x.id !== draft.asset)
            .map((x) => <option key={x.id} value={x.id}>{x.symbol} {x.name}</option>)}</select></label>
        {date('secondDate', '換入日')}{num('secondQuantity', '換入單位數')}{num('secondPrice', '換入淨值')}
        {num('secondAmount', '原幣換入金額')}{num('fee', '從換購金額內扣的費用')}{num('externalFee', '銀行另外扣款的換購手續費')}
      </>}
    </div>
    {a && <p className="hint">計價幣別 {a.currency || '待補'}{implied != null && ` · ${investIsSale(draft) ? '推算每單位實收' : '推算淨值'} ${format(implied)}`}</p>}
    {isDividend && <p className={eligibleHint.startsWith('股數待核對') ? 'msg warn' : 'hint'}>
      依紀錄算出的符合資格股數 {format(eligible)}{eligibleHint && ` · ${eligibleHint}`}
      {draft.kind === 'stockDividend' && draft.perUnit != null && (draft.eligible ?? eligible) != null &&
        ` · 應配約 ${format(draft.perUnit * (draft.eligible ?? eligible)!)} 股`}
    </p>}
    {isCashDividend && draft.cashAmount == null && forecast != null && <p className="hint">推算實收 {format(forecast)} {draft.cashCurrency}，可填通知單或銀行確認的實收金額。
      {showCash && <button type="button" className="btn" onClick={() => patch({ cashAmount: forecast })}>使用推算金額</button>}
    </p>}
    {text('note', '補充備註')}
    {gen && !fromMoney && !generated && !linking && <div className="invest-actions">
      <button type="button" className="btn" onClick={enableCash}>{wantCash ? '先只存投資' : '產生記帳'}</button>
      {!!draft.id && <button type="button" className="btn" onClick={() => { onCash(); setShowLink((v) => !v); }}>連到既有記帳</button>}
    </div>}
    {showCash && <div className="invest-grid">
      <label className="field">記帳帳戶<select required value={draft.cashAccount} onChange={(e) => {
        const account = money?.accounts.find((x) => x.name === e.currentTarget.value);
        patch({ cashAccount: account?.name ?? '', cashCurrency: account?.currency ?? 'TWD' });
      }}><option value="">選擇實際收付款帳戶</option>{money?.accounts.filter((x) => !x.archived || x.name === draft.cashAccount)
        .map((x) => <option key={x.id} value={x.name}>{x.name}（{x.currency}）</option>)}</select></label>
      <label className="field">記帳分類<select value={draft.category || root} onChange={(e) => patch({ category: e.currentTarget.value })}>
        <option value={root}>{root.replaceAll(' / ', '／')}</option>
        {candidates.map((x) => <option key={x.id} value={x.path}>{x.path.replaceAll(' / ', '／')}</option>)}
      </select></label>
      {a && <label className="field">整筆自動備註<input readOnly value={investmentMemo(draft, a)} /></label>}
    </div>}
    {showLink && <div className="invest-actions">
      <select aria-label="選擇既有記帳" value={link} onChange={(e) => setLink(e.currentTarget.value)}>
        <option value="">選擇已入帳的紀錄</option>{linkOptions.map((txn) =>
          <option key={txn.id} value={txn.id}>{txn.date} · {txn.account} · {format(txn.amount)} · {txn.note || txn.lines[0]?.category}</option>)}
      </select><button type="button" disabled={busy || !link} className="btn" onClick={() => onMoney(draft, link)}>確認連結</button>
    </div>}
    {historic && <p className="hint">已連結既有記帳{linkedTxn && ` · ${linkedTxn.date} · ${format(linkedTxn.amount)}`}</p>}
    <div className="invest-actions">
      <button className="btn primary" type="submit" disabled={busy || (showCash && !money)}>{showCash ? '儲存並同步記帳' : '儲存投資紀錄'}</button>
      <button className="btn" type="button" onClick={onCancel}>取消</button>
      {historic && <button className="btn" type="button" onClick={() => onUnlink(draft)} disabled={busy}>解除連結</button>}
      {!!draft.id && <button className="btn danger" type="button" onClick={() => onRemove(initial)} disabled={busy}>刪除</button>}
    </div>
  </form>;
}
