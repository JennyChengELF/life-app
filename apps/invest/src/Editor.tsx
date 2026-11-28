import { useState } from 'react';
import { WeekDateStrip } from '@life/ui/week-date-strip';
import {
  blankInvestEvent, canGenerateCash, dividendEligibility, dividendEstimate, impliedInvestPrice, INVEST_KINDS, investCategory,
  investIsDividend, investIsPurchase, investIsSale, investPurchaseAmounts, investmentMemo, isInvestmentCashBatch, type InvestEvent, type InvestKind,
  type InvestSnapshot, type MoneySnapshot,
} from '@life/db';
import { ExchangeRateLookup } from './ExchangeRateLookup';

const currencies = ['TWD', 'USD', 'JPY', 'EUR', 'KRW', 'HKD', 'CNY', 'GBP', 'AUD', 'CAD', 'SGD', 'THB'];
const currencyName = (currency: string) => currency === 'TWD' ? '新台幣 TWD' : currency;
const unitLabel = (label: string, currency: string) => currency ? `${label}（${currency}）` : label;

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

export function Editor({ initial, day, onDate, snap, money, busy, fromMoney, linking, onQuickAsset, onSave, onCash, onMoney, onRemove, onUnlink, onCancel }: {
  day: string; onDate: (date: string) => void;
  initial: InvestEvent; snap: InvestSnapshot; money: MoneySnapshot | null; busy: boolean; fromMoney: boolean;
  linking?: boolean;
  onQuickAsset: (symbol: string) => Promise<string | undefined>;
  onSave: (e: InvestEvent, cash: boolean) => void; onCash: () => void; onMoney: (e: InvestEvent, id: string) => void;
  onRemove: (e: InvestEvent) => void; onUnlink: (e: InvestEvent) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [showCashSettings, setShowCashSettings] = useState(!!initial.cashAccount && !linking);
  const [link, setLink] = useState('');
  const [linkDate, setLinkDate] = useState('');
  const [showLink, setShowLink] = useState(false);
  const [showQuickAsset, setShowQuickAsset] = useState(false);
  const [symbol, setSymbol] = useState('');
  const [pickedCashCurrency, setPickedCashCurrency] = useState(!!initial.id || !!initial.cashAccount);
  const a = snap.assets.find((asset) => asset.id === draft.asset);
  const typePending = a?.kind === 'pending';
  const patch = (value: Partial<InvestEvent>) => setDraft((previous) => {
    const next = { ...previous, ...value };
    const asset = snap.assets.find((item) => item.id === next.asset);
    const priorCurrency = snap.assets.find((item) => item.id === previous.asset)?.currency;
    const changedPricing = next.asset !== previous.asset && priorCurrency !== asset?.currency;
    const changedCashCurrency = next.cashCurrency !== previous.cashCurrency;
    if (changedPricing || (next.cashDate !== previous.cashDate && next.fxSource === 'reference')) {
      next.fx = null;
      next.fxSource = '';
      next.fxDate = '';
    }
    if (next.kind !== 'buy' || (asset?.kind !== 'stock' && asset?.kind !== 'fund')) return next;
    if (changedCashCurrency) next.cashAmount = null;
    if (next.feeCurrency && next.feeCurrency !== asset.currency && next.feeCurrency !== next.cashCurrency) next.feeCurrency = '';
    const tradeChanged = next.asset !== previous.asset || next.quantity !== previous.quantity || next.price !== previous.price;
    const amounts = investPurchaseAmounts(next, asset);
    if (asset.kind === 'stock' && tradeChanged) next.originalAmount = amounts.stockAmount;
    const feeChanged = next.fee !== previous.fee || next.feeCurrency !== previous.feeCurrency;
    if (asset.kind === 'stock' && asset.currency && asset.currency === next.cashCurrency &&
      (tradeChanged || changedCashCurrency || feeChanged)) next.cashAmount = amounts.suggestedCash;
    if (tradeChanged || changedCashCurrency || feeChanged || next.cashAmount !== previous.cashAmount ||
      next.fx !== previous.fx || next.fxSource !== previous.fxSource || next.cashDate !== previous.cashDate) {
      const rate = investPurchaseAmounts(next, asset);
      next.fx = rate.fx;
      if (asset.currency === 'TWD') { next.fxSource = ''; next.fxDate = ''; }
      else if (rate.inferredFx != null) next.fxSource = 'inferred';
      else if (next.fxSource === 'inferred') next.fxSource = '';
    }
    return next;
  });
  const changeKind = (kind: InvestKind) => setDraft((e) => ({
    ...blankInvestEvent(kind, kind === 'dividend' ? '' : e.tradeDate || e.cashDate), id: e.id,
    asset: e.asset, cashDate: e.cashDate || (kind === 'dividend' ? e.tradeDate : ''), cashCurrency: e.cashCurrency,
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
  const text = (field: 'note', label: string) => <label className="field">{label}
    <input value={draft[field]} onChange={(e) => patch({ [field]: e.currentTarget.value })} />
  </label>;
  const isDividend = investIsDividend(draft);
  const isCashDividend = draft.kind === 'dividend';
  const isSwitch = draft.kind === 'switch';
  const gen = canGenerateCash(draft) && draft.moneyMode !== 'linked';
  const stockBuy = draft.kind === 'buy' && a?.kind === 'stock';
  const fundBuy = draft.kind === 'buy' && a?.kind === 'fund';
  const pricingCurrency = a?.currency ?? '';
  const amounts = a && (stockBuy || fundBuy) ? investPurchaseAmounts(draft, a) : null;
  const feeCurrency = draft.feeCurrency || pricingCurrency;
  const entryCurrencies = [...new Set([...currencies, ...(money?.accounts.map((account) => account.currency) ?? []),
    pricingCurrency, draft.cashCurrency].filter(Boolean))];
  const forecast = a && isCashDividend ? dividendEstimate(draft, dividendEligibility(draft, snap.assets, snap.events), a) : null;
  const implied = a && (investIsPurchase(draft) || investIsSale(draft)) ? impliedInvestPrice(draft, a) : null;
  const eligible = isDividend ? dividendEligibility(draft, snap.assets, snap.events) : null;
  const eligibleHint = dividendHint(draft, snap);
  const root = a ? investCategory(draft, a) : '';
  const candidates = money?.categories.filter((cat) => !cat.archived && cat.path.startsWith(`${root} / `) &&
    cat.kind === (investIsSale(draft) || isCashDividend ? '收入' : '支出')) ?? [];
  const generated = draft.moneyMode === 'generated';
  const showCash = gen && (fromMoney || generated) && !typePending;
  const showCashFields = showCash || (gen && showCashSettings && !typePending && !linking);
  const historic = draft.moneyMode === 'linked';
  const linkedTxn = money?.txns.find((txn) => txn.id === draft.moneyId);
  // （2026-11-28 使用者決定：按記帳日期篩選可連結的交易。）
  const linkOptions = showLink && linkDate ? (money?.txns ?? []).filter((txn) =>
    txn.date === linkDate && !isInvestmentCashBatch(txn.id) &&
    (!txn.investmentId || (draft.kind === 'buy' && !txn.investmentGenerated)) &&
    txn.direction === (isCashDividend || investIsSale(draft) ? '入' : '出')) : [];
  const selectedLink = linkOptions.find((txn) => txn.id === link);
  async function addQuickAsset() {
    if (busy || !symbol.trim()) return;
    const id = await onQuickAsset(symbol);
    if (!id) return;
    patch({ asset: id, category: '' });
    setShowQuickAsset(false);
    setSymbol('');
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
      <div><label className="field">投資標的<select required value={draft.asset} onChange={(e) => {
        const asset = snap.assets.find((x) => x.id === e.currentTarget.value);
        patch({ asset: asset?.id ?? '', category: '',
          cashCurrency: draft.cashAccount || pickedCashCurrency ? draft.cashCurrency : asset?.currency || 'TWD' });
      }}><option value="">選擇標的</option>{snap.assets.map((asset) => <option key={asset.id} value={asset.id}>
        {asset.symbol} {asset.name}{asset.account ? ` · ${asset.account}` : ''}{asset.kind === 'pending' ? '（類型待補）' : ''}
      </option>)}</select></label>
        {!showQuickAsset ? <button className="btn" type="button" disabled={busy} onClick={() => setShowQuickAsset(true)}>＋ 新增投資標的</button>
          : <div className="invest-quick-asset">
            <label className="field">新標的代號<input value={symbol} onChange={(e) => setSymbol(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void addQuickAsset(); } }} /></label>
            <div className="invest-actions">
              <button className="btn primary" type="button" disabled={busy || !symbol.trim()} onClick={() => void addQuickAsset()}>新增代號</button>
              <button className="btn" type="button" disabled={busy} onClick={() => { setShowQuickAsset(false); setSymbol(''); }}>取消新增</button>
            </div>
          </div>}
      </div>
      {isDividend && date('exDate', draft.kind === 'stockDividend' ? '除權日' : '除息日')}
      {!isCashDividend && date('tradeDate', isSwitch ? '換出日' : draft.kind === 'stockDividend' ? '實際入股日' : '成交／實際價格日')}
      {(gen || historic || isCashDividend) && date('cashDate', isCashDividend ? '發放／實際入帳日' : '扣款／入帳日')}
      {(gen || historic || isCashDividend) && <label className="field">實收／扣款幣別
        <select value={draft.cashCurrency} disabled={!!draft.cashAccount} onChange={(e) => {
          setPickedCashCurrency(true);
          patch({ cashCurrency: e.currentTarget.value });
        }}>
          {entryCurrencies.map((currency) => <option key={currency} value={currency}>{currencyName(currency)}</option>)}
        </select>
      </label>}
      {!isCashDividend && num('quantity', draft.kind === 'stockDividend' ? '實際配發股數' : isSwitch ? '換出單位數' : typePending ? '股數／單位數' : a?.kind === 'stock' ? '股數' : '單位數')}
      {!isDividend && num('price', unitLabel(a?.kind === 'stock' ? '每股成交價' : isSwitch ? '換出淨值'
        : fundBuy ? '基金提供的淨值（選填）' : typePending ? '成交價／淨值' : '成交淨值', pricingCurrency))}
      {isDividend && num('eligible', '通知單上的符合資格股數／單位')}
      {isDividend && num('perUnit', isCashDividend ? '每股／單位配息' : '每股配發股數（選填）')}
      {stockBuy ? <label className="field">{unitLabel('原幣成交金額', pricingCurrency)}
        <input type="number" readOnly value={amounts?.stockAmount ?? draft.originalAmount ?? ''} />
      </label> : draft.kind !== 'stockDividend' && !fundBuy &&
        num('originalAmount', isCashDividend ? '原幣股利毛額' : isSwitch ? '原幣換出金額' : '原幣成交金額')}
      {!isSwitch && (!fundBuy || !!initial.fee) && draft.kind !== 'stockDividend' &&
        num('fee', isCashDividend ? '匯費（選填）' : unitLabel('手續費（選填）', stockBuy ? feeCurrency : ''))}
      {stockBuy && pricingCurrency && <label className="field">手續費幣別
        <select value={feeCurrency} onChange={(e) => patch({ feeCurrency: e.currentTarget.value })}>
          {[...new Set([pricingCurrency, draft.cashCurrency].filter(Boolean))].map((currency) =>
            <option key={currency} value={currency}>{currencyName(currency)}</option>)}
        </select>
      </label>}
      {(!isSwitch && (isCashDividend || investIsSale(draft))) && num('tax', isCashDividend ? '補扣繳稅額' : '交易稅')}
      {isCashDividend && num('healthFee', '二代健保補充保費')}
      {!isSwitch && (gen || historic) && num('cashAmount',
        unitLabel(isCashDividend || investIsSale(draft) ? '實收金額' : '實際扣款金額', draft.cashCurrency))}
      {isSwitch && num('fx', '換入幣別對台幣匯率（選填）')}
      {!isSwitch && draft.kind !== 'stockDividend' && <div>
        <label className="field">交易匯率（每單位原幣值多少台幣）
          <input type="number" step="any" min="0" readOnly={pricingCurrency === 'TWD'}
            value={pricingCurrency === 'TWD' ? 1 : amounts?.inferredFx != null ? '' : draft.fx ?? ''}
            onChange={(e) => patch({ fx: e.currentTarget.value ? e.currentTarget.valueAsNumber : null, fxSource: '', fxDate: '' })} />
        </label>
        {draft.fxSource === 'reference' && <p className="hint">參考匯率 · 報價日 {draft.fxDate}</p>}
        {amounts?.inferredFx != null && <p className="hint">推算匯率 · 1 {pricingCurrency} = NT$ {format(amounts.inferredFx)}</p>}
        {pricingCurrency && pricingCurrency !== 'TWD' &&
          <ExchangeRateLookup key={`${pricingCurrency}:${draft.cashDate}`} currency={pricingCurrency} date={draft.cashDate}
            onApply={(quote) => patch({ fx: quote.rate, fxSource: 'reference', fxDate: quote.date })} />}
      </div>}
      {isSwitch && <>
        <label className="field">換入基金<select value={draft.secondAsset} onChange={(e) => patch({ secondAsset: e.currentTarget.value })}>
          <option value="">選擇換入基金</option>{snap.assets.filter((x) => (x.kind === 'fund' || x.kind === 'policy') && x.id !== draft.asset)
            .map((x) => <option key={x.id} value={x.id}>{x.symbol} {x.name}</option>)}</select></label>
        {date('secondDate', '換入日')}{num('secondQuantity', '換入單位數')}{num('secondPrice', '換入淨值')}
        {num('secondAmount', '原幣換入金額')}{num('fee', '從換購金額內扣的費用')}{num('externalFee', '銀行另外扣款的換購手續費')}
      </>}
    </div>
    {a && <p className="hint">計價幣別 {a.currency || '待補'}{implied != null &&
      ` · ${investIsSale(draft) ? '推算每單位實收' : '推算淨值'} ${format(implied)} ${a.currency}`}</p>}
    {amounts?.estimatedTwd != null && <p className="hint">預估台幣金額 NT$ {format(amounts.estimatedTwd)}</p>}
    {typePending && <p className="hint">類型待補。要產生記帳時，請先到「更多 → 標的與保單」補上類型。</p>}
    {isDividend && <p className={eligibleHint.startsWith('股數待核對') ? 'msg warn' : 'hint'}>
      依紀錄算出的符合資格股數 {format(eligible)}{eligibleHint && ` · ${eligibleHint}`}
      {draft.kind === 'stockDividend' && draft.perUnit != null && (draft.eligible ?? eligible) != null &&
        ` · 應配約 ${format(draft.perUnit * (draft.eligible ?? eligible)!)} 股`}
    </p>}
    {isCashDividend && draft.cashAmount == null && forecast != null && <p className="hint">推算實收 {format(forecast)} {draft.cashCurrency}，可填通知單或銀行確認的實收金額。
      <button type="button" className="btn" onClick={() => patch({ cashAmount: forecast })}>使用推算金額</button>
    </p>}
    {text('note', '補充備註')}
    {gen && !fromMoney && !generated && !linking && <div className="invest-actions">
      {!typePending && <button type="button" className="btn" disabled={busy} aria-expanded={showCashSettings} onClick={() => {
        if (!showCashSettings) onCash();
        setShowCashSettings(!showCashSettings);
      }}>記帳帳戶與分類</button>}
      {!!draft.id && <button type="button" className="btn" disabled={busy} aria-expanded={showLink} onClick={() => {
        if (!showLink) {
          setLinkDate(draft.cashDate || draft.tradeDate || day);
          setLink('');
          onCash();
        }
        setShowLink(!showLink);
      }}>連到既有記帳</button>}
    </div>}
    {showCashFields && <div className="invest-grid">
      <label className="field">記帳帳戶<select required={showCash} value={draft.cashAccount} onChange={(e) => {
        const account = money?.accounts.find((x) => x.name === e.currentTarget.value);
        patch({ cashAccount: account?.name ?? '', cashCurrency: account?.currency ?? draft.cashCurrency });
      }}><option value="">選擇實際收付款帳戶</option>{money?.accounts.filter((x) => !x.archived || x.name === draft.cashAccount)
        .map((x) => <option key={x.id} value={x.name}>{x.name}（{x.currency}）</option>)}</select></label>
      <label className="field">記帳分類<select value={draft.category || root} onChange={(e) => patch({ category: e.currentTarget.value })}>
        <option value={root}>{root.replaceAll(' / ', '／')}</option>
        {candidates.map((x) => <option key={x.id} value={x.path}>{x.path.replaceAll(' / ', '／')}</option>)}
      </select></label>
      {a && showCash && <label className="field">整筆自動備註<input readOnly value={investmentMemo(draft, a)} /></label>}
    </div>}
    {showLink && <div>
      <label className="field">記帳日期
        <input type="date" value={linkDate} onChange={(e) => {
          setLinkDate(e.currentTarget.value);
          setLink('');
        }} />
      </label>
      <label className="field">既有記帳交易
        <select value={selectedLink?.id ?? ''} disabled={busy || !linkOptions.length} onChange={(e) => setLink(e.currentTarget.value)}>
          <option value="">{!linkDate ? '請先選擇記帳日期' : busy ? '讀取中…' : !money ? '無法讀取記帳資料'
            : linkOptions.length ? '選擇已入帳的紀錄' : '這一天沒有可連結的記帳交易'}</option>
          {linkOptions.map((txn) => <option key={txn.id} value={txn.id}>
            {txn.date} · {txn.account} · {format(txn.amount)} · {txn.note || txn.lines[0]?.category}
          </option>)}
        </select>
      </label>
      <button type="button" disabled={busy || !selectedLink} className="btn" onClick={() => {
        if (selectedLink) onMoney(draft, selectedLink.id);
      }}>確認連結</button>
    </div>}
    {historic && <p className="hint">已連結既有記帳{linkedTxn && ` · ${linkedTxn.date} · ${format(linkedTxn.amount)}`}</p>}
    <div className="invest-actions">
      <button className="btn primary" type="submit" disabled={busy || (showCash && !money) || (generated && typePending)}>{showCash ? '儲存並同步記帳' : '儲存投資紀錄'}</button>
      <button className="btn" type="button" onClick={onCancel}>取消</button>
      {historic && <button className="btn" type="button" onClick={() => onUnlink(draft)} disabled={busy}>解除連結</button>}
      {!!draft.id && <button className="btn danger" type="button" onClick={() => onRemove(initial)} disabled={busy}>刪除</button>}
    </div>
  </form>;
}
