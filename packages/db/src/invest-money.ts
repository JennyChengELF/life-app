import { type Backend } from './backend';
import {
  dividendEligibility, dividendEstimate, INVEST_KINDS, investIsPurchase, investIsSale,
  investOriginal, InvestStore, type InvestAsset, type InvestEvent,
} from './invest';
import { MoneyStore, roundMoney, type CategoryKind, type LineInput, type Txn, type TxnInput } from './money';
import { newId } from './ids';
import { startOfDay, toDateKey } from './time';

export function investCategory(e: InvestEvent, a: InvestAsset) {
  if (e.kind === 'dividend') return '投資收入 / 投資配息';
  if (investIsSale(e)) return '投資收入 / 投資贖回';
  if (e.kind === 'switch') return '投資 / 投資手續費';
  return `投資 / ${a.kind === 'stock' ? '股票' : a.kind === 'policy' ? '投資型保單' : '基金'}`;
}

export function investLabel(a: InvestAsset) {
  return `${a.kind === 'stock' ? '股票' : '基金'}${a.symbol}`;
}

export function investmentMemo(e: InvestEvent, a: InvestAsset) {
  const prefix = e.kind === 'buy' ? '' : INVEST_KINDS[e.kind];
  const rate = e.fx ?? (a.currency && a.currency === e.cashCurrency ? 1 : null);
  return [`${prefix}${investLabel(a)}`,
    e.price == null ? '' : `${a.kind === 'stock' ? '成交價' : '淨值'} ${e.price}`,
    rate == null ? '' : `匯率 ${rate}`].filter(Boolean).join('：');
}

export function canGenerateCash(e: InvestEvent) {
  return investIsPurchase(e) || investIsSale(e) || e.kind === 'dividend' || (e.kind === 'switch' && !!e.externalFee);
}

export function investmentCashInput(e: InvestEvent, a: InvestAsset): TxnInput {
  if (!canGenerateCash(e) || !e.cashDate || !e.cashAccount) throw new Error('請填扣款／入帳日和記帳帳戶');
  const income = investIsSale(e) || e.kind === 'dividend';
  const cur = e.cashCurrency;
  const convert = (value: number | null) => value == null ? null
    : a.currency === cur ? roundMoney(value, cur)
    : cur === 'TWD' && e.fx ? roundMoney(value * e.fx, cur) : null;
  const label = investLabel(a);
  const round = (n: number) => roundMoney(n, cur);
  const lines: LineInput[] = [];
  const feeLabel = e.kind === 'redeem' ? '贖回手續費' : e.kind === 'switch' ? '換購手續費' : '交易手續費';
  if (e.kind !== 'dividend' && e.kind !== 'switch') {
    for (const [raw, category, note] of [
      [e.fee, '投資 / 投資手續費', feeLabel],
      [e.tax, '投資 / 證券交易稅', '證券交易稅'],
    ] as const) {
      if (!raw) continue;
      const amount = convert(raw);
      if (amount == null) throw new Error('另外列出的外幣費用需要匯率才能產生記帳');
      if (amount > 0) lines.push({ kind: '支出', amount, category, note: `${label} ${note}` });
    }
  }
  const extra = lines.reduce((sum, l) => sum + l.amount, 0);
  const gross = convert(investOriginal(e));
  const actual = e.kind === 'switch' ? e.externalFee : e.cashAmount;
  // 現金股利依通知實付；只有明確有金額才建立收入。
  const amount = actual ?? (e.kind === 'dividend' || gross == null ? null : round(gross + (income ? -extra : extra)));
  if (!amount || amount <= 0) throw new Error('請填確認過的實際扣款或入帳金額');
  const base = round(amount + (income ? extra : -extra));
  if (base <= 0) throw new Error('扣款金額必須大於另列費用');
  lines.unshift({
    kind: income ? '收入' : '支出', amount: base, category: e.category || investCategory(e, a),
    note: e.kind === 'switch' ? `${label} 換購手續費` : label,
  });
  return {
    time: startOfDay(e.cashDate), dateOnly: true, direction: income ? '入' : '出',
    account: e.cashAccount, amount: round(amount), paidBy: null, currency: null,
    toAccount: null, toAmount: null, store: null, branch: null, statementText: null,
    note: investmentMemo(e, a), tagIds: [], investmentId: e.id, investmentGenerated: true,
    investmentDeferred: e.kind === 'dividend', lines,
  };
}

export class InvestMoney {
  readonly investments: InvestStore;
  readonly money: MoneyStore;
  constructor(backend: Backend) {
    this.investments = new InvestStore(backend);
    this.money = new MoneyStore(backend, 'invest');
  }

  async generate(event: InvestEvent): Promise<{ id: string; error?: string }> {
    const draft = { ...event, id: event.id || newId() };
    const locks = globalThis.navigator?.locks;
    if (locks) return locks.request(`life-invest-${draft.id}`, () => this.generateLocked(draft));
    return this.generateLocked(draft);
  }

  private async generateLocked(event: InvestEvent): Promise<{ id: string; error?: string }> {
    if (event.moneyMode === 'linked') throw new Error('這筆已連結既有記帳');
    const id = event.id;
    const linked = { ...event, id, moneyMode: 'generated' as const, moneyId: event.moneyId || `invest-${id}`, pending: true };
    const { assets, events } = await this.investments.load();
    const asset = assets.find((a) => a.id === linked.asset);
    if (!asset) throw new Error('找不到投資標的');
    const prior = events.find((e) => e.id === linked.id);
    const ledger = await this.money.load();
    const existing = ledger.txns.find((txn) => txn.id === linked.moneyId);
    const priorAsset = assets.find((a) => a.id === prior?.asset);
    const input = this.keepMoneyDetails(linked, asset, prior, priorAsset, existing);
    if (linked.kind !== 'switch') linked.cashAmount = input.amount;
    await this.investments.saveEvent(linked);
    try {
      const account = ledger.accounts.find((a) => a.name === input.account);
      if (!account) throw new Error('找不到記帳帳戶');
      if (account.currency !== linked.cashCurrency) throw new Error('記帳帳戶幣別已變更，請重新選擇');
      const categories = input.lines.flatMap((l, i) => l.category ? [{
        path: l.category, kind: l.kind as CategoryKind, invested: linked.kind !== 'dividend' || i > 0,
      }] : []);
      await this.money.ensureInvestmentCategories(categories);
      await this.money.saveTxn(input, undefined, linked.moneyId);
      await this.investments.saveEvent({ ...linked, pending: false });
      return { id };
    } catch (err) {
      return { id, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private keepMoneyDetails(event: InvestEvent, asset: InvestAsset, prior?: InvestEvent, priorAsset?: InvestAsset, existing?: Txn): TxnInput {
    if (!existing || !prior || !priorAsset) return investmentCashInput(event, asset);
    if (!event.cashDate) throw new Error('請填扣款／入帳日');
    const matchCash = event.cashAccount === prior.cashAccount && event.cashCurrency === prior.cashCurrency &&
      event.cashAmount === prior.cashAmount && event.externalFee === prior.externalFee;
    const matchLines = matchCash && event.fee === prior.fee && event.tax === prior.tax &&
      (event.fx === prior.fx || (!event.fee && !event.tax) || asset.currency === event.cashCurrency);
    if ((!matchCash && existing.payments?.length) || (!matchLines && existing.origCurrency)) {
      throw new Error('這筆有拆分付款或外幣記帳資料，請在一般記帳表單修改實收、實扣或付款帳戶');
    }
    const memo = investmentMemo(event, asset);
    const note = existing.note === investmentMemo(prior, priorAsset) ? memo : existing.note;
    const time = startOfDay(event.cashDate) + (existing.dateOnly ? 0 : existing.time - startOfDay(existing.date));
    // （2026-11-27 使用者決定：從投資編輯時，保留一般記帳表單填寫的內容。）
    if (matchLines) {
      const oldLabel = investLabel(priorAsset);
      const label = investLabel(asset);
      const lines = existing.lines.map((line, i) => ({
        ...line,
        category: i === 0 && event.category !== prior.category ? event.category || investCategory(event, asset) : line.category,
        note: line.note === oldLabel || line.note?.startsWith(`${oldLabel} `) ? label + line.note.slice(oldLabel.length) : line.note,
      }));
      return { ...existing, time, note, lines };
    }
    const next = investmentCashInput(event, asset);
    const standard = investmentCashInput(prior, priorAsset);
    if (existing.lines.length !== standard.lines.length || existing.lines.some((line, i) =>
      line.kind !== standard.lines[i].kind || line.amount !== standard.lines[i].amount)) {
      throw new Error('這筆已在記帳拆分或調整明細，請從一般記帳表單修改相關金額');
    }
    return {
      ...existing, ...next, time, dateOnly: existing.dateOnly, note,
      store: existing.store, branch: existing.branch, statementText: existing.statementText, tagIds: existing.tagIds,
      rewardFor: existing.rewardFor, feeFor: existing.feeFor, payments: existing.payments,
      origCurrency: existing.origCurrency, twdAmount: existing.twdAmount, twdStatus: existing.twdStatus,
      lines: next.lines.map((line, i) => {
        const previous = existing.lines[i];
        if (!previous || previous.kind !== line.kind || (i > 0 && previous.category !== line.category)) return line;
        return { ...line, budget: previous.budget, note: previous.note === standard.lines[i].note ? line.note : previous.note };
      }),
    };
  }

  async saveFromMoney(input: TxnInput, existing: Txn) {
    const id = existing.investmentId;
    if (!id || !existing.investmentGenerated) throw new Error('找不到這筆連動的投資紀錄');
    const save = async () => {
      const event = (await this.investments.load()).events.find((e) => e.id === id && e.moneyId === existing.id && e.moneyMode === 'generated');
      if (!event) throw new Error('找不到這筆連動的投資紀錄');
      const ledger = await this.money.load();
      const account = ledger.accounts.find((a) => a.name === input.account);
      const amount = input.origCurrency && account?.currency === 'TWD' ? input.twdAmount : input.amount;
      if (!account || !amount || amount <= 0 || input.direction !== existing.direction || input.paidBy ||
        (input.origCurrency && input.twdStatus !== 'final')) {
        throw new Error('投資記帳須保留原本的收支方向，並填寫實際收付款帳戶與金額');
      }
      const txnId = await this.money.saveTxn({
        ...input, investmentId: id, investmentGenerated: true, investmentDeferred: existing.investmentDeferred,
      }, existing, existing.id);
      const cashDate = toDateKey(input.time);
      const cashAmount = roundMoney(amount, account.currency);
      const cash = event.kind === 'switch' ? { externalFee: cashAmount } : { cashAmount };
      const category = input.lines.find((line) => line.kind === (input.direction === '出' ? '支出' : '收入'))?.category ?? '';
      try {
        await this.investments.saveEvent({ ...event, ...cash, cashDate, cashCurrency: account.currency, cashAccount: account.name, category, pending: false });
      } catch (error) {
        throw new Error(`記帳已儲存，投資明細同步失敗。請再按一次儲存重試。 ${error instanceof Error ? error.message : ''}`);
      }
      return txnId;
    };
    const locks = globalThis.navigator?.locks;
    return locks ? locks.request(`life-invest-${id}`, save) : save();
  }

  async link(event: InvestEvent, moneyId: string) {
    if (event.moneyMode === 'generated') throw new Error('這筆已有自動產生的記帳');
    if (event.moneyId && event.moneyId !== moneyId) throw new Error('請先解除前一筆記帳連結');
    const id = event.id || `money-${moneyId}`;
    const snapshot = await this.money.load();
    const txn = snapshot.txns.find((t) => t.id === moneyId);
    if (!txn || (txn.investmentId && txn.investmentId !== id)) throw new Error('該筆記帳已連到其他投資');
    const expected = investIsSale(event) || event.kind === 'dividend' ? '入' : '出';
    if (txn.direction !== expected) throw new Error('請選擇對應的支出或收入');
    const currency = snapshot.accounts.find((a) => a.name === txn.account)?.currency ?? txn.currency;
    const confirmedCash = event.kind === 'dividend' && txn.amount != null
      ? { cashAmount: txn.amount, cashCurrency: currency || event.cashCurrency } : {};
    const linked = { ...event, ...confirmedCash, id, moneyId, moneyMode: 'linked' as const, pending: true };
    await this.investments.saveEvent(linked);
    await this.money.setInvestmentLink(moneyId, id);
    await this.investments.saveEvent({ ...linked, pending: false });
    return linked.id;
  }

  async unlink(event: InvestEvent) {
    if (event.moneyMode !== 'linked') throw new Error('這筆不是手動連結');
    const txn = (await this.money.load()).txns.find((t) => t.id === event.moneyId);
    if (txn?.investmentId === event.id) await this.money.setInvestmentLink(event.moneyId, null);
    await this.investments.saveEvent({ ...event, moneyId: '', moneyMode: '', pending: false });
  }

  async remove(event: InvestEvent) {
    if (event.moneyMode === 'linked') await this.unlink(event);
    if (event.moneyMode === 'generated') {
      await this.investments.saveEvent({ ...event, removePending: true, pending: true });
      const txn = (await this.money.load()).txns.find((t) => t.id === event.moneyId);
      if (txn?.investmentId === event.id && txn.investmentGenerated) await this.money.deleteTxn(txn);
    }
    await this.investments.removeEvent(event);
  }

  async cashDividendAmount(event: InvestEvent) {
    if (event.cashAmount != null) return event.cashAmount;
    const snap = await this.investments.load();
    const asset = snap.assets.find((a) => a.id === event.asset);
    return asset ? dividendEstimate(event, dividendEligibility(event, snap.assets, snap.events), asset) : null;
  }
}
