import { type Backend } from './backend';
import {
  dividendEligibility, dividendEstimate, INVEST_KINDS, investFeeInCurrency, investIsPurchase, investIsSale,
  investOriginal, InvestStore, type InvestAsset, type InvestEvent,
} from './invest';
import { MoneyStore, roundMoney, type CategoryKind, type LineInput, type Txn, type TxnInput } from './money';
import { newId } from './ids';
import { parseDateText, startOfDay, toDateKey } from './time';

export function investCategory(e: InvestEvent, a: InvestAsset) {
  if (a.kind === 'pending') return '';
  if (e.kind === 'dividend') return '投資收入 / 投資配息';
  if (investIsSale(e)) return '投資收入 / 投資贖回';
  if (e.kind === 'switch') return '投資 / 投資手續費';
  return `投資 / ${a.kind === 'stock' ? '股票' : a.kind === 'policy' ? '投資型保單' : '基金'}`;
}

export function investLabel(a: InvestAsset) {
  return `${a.kind === 'pending' ? '標的' : a.kind === 'stock' ? '股票' : '基金'}${a.symbol}`;
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

export function investmentsForMoney(events: InvestEvent[], moneyId: string) {
  return events.filter((event) => event.moneyId === moneyId && !event.removePending);
}

function withMoneyLock<T>(moneyId: string, action: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  return locks ? locks.request(`life-invest-money-${moneyId}`, action) : action();
}

export function investmentCashInput(e: InvestEvent, a: InvestAsset): TxnInput {
  if (a.kind === 'pending') throw new Error('請先在「更多 → 標的與保單」補上標的類型，再產生記帳');
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
    for (const [raw, converted, category, note] of [
      [e.fee, investFeeInCurrency(e, a, cur), '投資 / 投資手續費', feeLabel],
      [e.tax, convert(e.tax), '投資 / 證券交易稅', '證券交易稅'],
    ] as const) {
      if (!raw) continue;
      if (converted == null) throw new Error('另外列出的外幣費用需要匯率才能產生記帳');
      const amount = round(converted);
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

const batchMoneyPrefix = 'invest-batch-';
export const isInvestmentCashBatch = (moneyId: string) => moneyId.startsWith(batchMoneyPrefix);

export function canLinkInvestmentCash(rows: InvestEvent[], txn: Txn) {
  return rows.length > 0 && !txn.investmentGenerated &&
    ((rows.length === 1 && !txn.investmentId) || rows.every((row) => row.kind === 'buy')) &&
    rows.every((row) => canGenerateCash(row) && txn.direction === (investIsSale(row) || row.kind === 'dividend' ? '入' : '出'));
}

export function prepareInvestmentCashBatch(
  rows: InvestEvent[], assets: InvestAsset[], cashDate: string, cashAccount: string, cashCurrency: string,
) {
  if (!rows.length) throw new Error('請先勾選要產生記帳的投資');
  if (!cashDate || parseDateText(cashDate) !== cashDate || !cashAccount || !cashCurrency) throw new Error('請選擇扣款／入帳日和記帳帳戶');
  // （2026-11-28 使用者決定：只將勾選的同一筆扣款合併，各檔本金和手續費各列一筆。）
  if (rows.length > 1 && rows.some((row) => row.kind !== 'buy')) throw new Error('一筆合併扣款只能勾選買進紀錄');
  const symbols = new Set<string>();
  const parts = rows.map((row) => {
    const asset = assets.find((item) => item.id === row.asset);
    if (!asset) throw new Error('找不到投資標的');
    symbols.add(asset.symbol);
    try {
      if (row.cashDate && row.cashDate !== cashDate) throw new Error('扣款／入帳日不同');
      if (row.cashAccount && row.cashAccount !== cashAccount) throw new Error('記帳帳戶不同');
      if ((row.cashAccount || row.cashAmount != null || row.kind === 'switch') && row.cashCurrency !== cashCurrency) {
        throw new Error('實際收付款幣別與記帳帳戶不同');
      }
      const event = { ...row, cashDate, cashAccount, cashCurrency };
      const input = investmentCashInput(event, asset);
      if (row.kind === 'buy') {
        const unit = asset.kind === 'stock' ? '股' : '單位';
        const price = asset.kind === 'stock' ? '每股' : '每單位';
        input.lines[0].note = row.quantity != null && row.price != null
          ? `${asset.symbol}：${row.quantity} ${unit} × ${price} ${row.price}${asset.currency !== cashCurrency ? ` ${asset.currency}` : ''}`
          : asset.symbol;
        for (const line of input.lines.slice(1)) {
          line.note = `${asset.symbol}：${line.category === '投資 / 投資手續費' ? '手續費' : '證券交易稅'}`;
        }
      }
      return { event: { ...event, cashAmount: row.kind === 'switch' ? row.cashAmount : input.amount }, input };
    } catch (error) {
      throw new Error(`${asset.symbol}：${error instanceof Error ? error.message : String(error)}`);
    }
  });
  const first = parts[0].input;
  const amount = roundMoney(parts.reduce((total, { input }) => total + (input.amount ?? 0), 0), cashCurrency);
  const input: TxnInput = { ...first, amount, lines: parts.flatMap((part) => part.input.lines),
    note: rows[0].kind === 'buy' ? `${[...symbols].join(', ')} 扣款` : first.note };
  return { input, events: parts.map((part) => part.event),
    lineEvents: parts.flatMap(({ event, input }) => input.lines.map((_, index) => index === 0 ? event.id : null)) };
}

export class InvestMoney {
  readonly investments: InvestStore;
  readonly money: MoneyStore;
  constructor(backend: Backend) {
    this.investments = new InvestStore(backend);
    this.money = new MoneyStore(backend, 'invest');
  }

  async saveStandalone(event: InvestEvent) {
    return withMoneyLock('batch-generation', async () => {
      const current = event.id && (await this.investments.load()).events.find((row) => row.id === event.id);
      if (current && (current.moneyId !== event.moneyId || current.pending)) throw new Error('投資連結已變更，請重新整理');
      return this.investments.saveEvent(event);
    });
  }

  async generate(event: InvestEvent): Promise<{ id: string; error?: string }> {
    const draft = { ...event, id: event.id || newId() };
    const locks = globalThis.navigator?.locks;
    return withMoneyLock('batch-generation', () => locks
      ? locks.request(`life-invest-${draft.id}`, () => this.generateLocked(draft)) : this.generateLocked(draft));
  }

  async generateCashBatch(ids: string[], cashDate: string, cashAccount: string, categories: Record<string, string> = {}) {
    return withMoneyLock('batch-generation', async () => {
      const { assets, events } = await this.investments.load();
      const byId = new Map(events.map((event) => [event.id, event]));
      const rows = [...new Set(ids)].map((id) => {
        const row = byId.get(id);
        if (!row || row.moneyId || row.pending) throw new Error('勾選的投資已連結或已變更，請重新整理');
        return row;
      });
      const ledger = await this.money.load();
      const account = ledger.accounts.find((a) => a.name === cashAccount && !a.archived);
      if (!account) throw new Error('請選擇可用的記帳帳戶');
      const categorized = rows.map((row) => {
        const category = categories[row.id];
        if (!category) return row;
        const asset = assets.find((item) => item.id === row.asset);
        if (!asset) throw new Error('找不到投資標的');
        const root = investCategory(row, asset);
        const kind = investIsSale(row) || row.kind === 'dividend' ? '收入' : '支出';
        if (category !== root && (!category.startsWith(`${root} / `) ||
          !ledger.categories.some((item) => item.path === category && item.kind === kind && !item.archived))) {
          throw new Error('選取的記帳分類已變更，請重新選擇');
        }
        return { ...row, category };
      });
      const batch = prepareInvestmentCashBatch(categorized, assets, cashDate, account.name, account.currency);
      const moneyId = `${batchMoneyPrefix}${newId()}~${batch.events[0].id}`;
      const pending = batch.events.map((row) => ({ ...row, moneyId, moneyMode: 'generated' as const, pending: true }));
      await this.investments.saveCashLinks(pending, assets);
      await this.finishCashBatch(pending, assets, batch.input);
      return moneyId;
    });
  }

  async retryCashBatch(moneyId: string) {
    return withMoneyLock('batch-generation', async () => {
      const { assets, events } = await this.investments.load();
      const rows = investmentsForMoney(events, moneyId);
      const first = rows.find((row) => row.id === moneyId.slice(moneyId.indexOf('~') + 1));
      if (!first || !rows.every((row) => row.moneyMode === 'generated')) throw new Error('找不到這組待同步投資');
      if (!rows.some((row) => row.pending)) return;
      const ledger = await this.money.load();
      const existing = ledger.txns.find((txn) => txn.id === moneyId);
      if (existing) {
        if (!existing.investmentGenerated || existing.investmentId !== first.id) throw new Error('這筆記帳已連到其他投資紀錄');
        await this.investments.saveCashLinks(rows.map((row) => ({ ...row, pending: false })), assets);
        return;
      }
      const account = ledger.accounts.find((a) => a.name === first.cashAccount && a.currency === first.cashCurrency);
      if (!account) throw new Error('找不到原本的記帳帳戶，或帳戶幣別已變更');
      const ordered = [first, ...rows.filter((row) => row.id !== first.id)];
      const batch = prepareInvestmentCashBatch(ordered, assets, first.cashDate, account.name, account.currency);
      await this.finishCashBatch(ordered, assets, batch.input);
    });
  }

  private async finishCashBatch(rows: InvestEvent[], assets: InvestAsset[], input: TxnInput) {
    const categories = input.lines.flatMap((line) => line.category ? [{
      path: line.category, kind: line.kind as CategoryKind, invested: !input.investmentDeferred,
    }] : []);
    await this.money.ensureInvestmentCategories(categories);
    await this.money.saveTxn(input, undefined, rows[0].moneyId);
    await this.investments.saveCashLinks(rows.map((row) => ({ ...row, pending: false })), assets);
  }

  async cancelCashBatch(moneyId: string) {
    return withMoneyLock('batch-generation', async () => {
      const { assets, events } = await this.investments.load();
      const rows = investmentsForMoney(events, moneyId);
      if (!isInvestmentCashBatch(moneyId) || !rows.length || rows.some((row) => row.moneyMode !== 'generated' || row.pending)) {
        throw new Error('請先完成這組投資的同步');
      }
      const txn = (await this.money.load()).txns.find((row) => row.id === moneyId);
      if (txn) {
        if (!txn.investmentGenerated || !rows.some((row) => row.id === txn.investmentId)) throw new Error('這筆記帳已連到其他投資紀錄');
        await this.money.deleteTxn(txn);
      }
      await this.investments.saveCashLinks(rows.map((row) => ({ ...row, moneyId: '', moneyMode: '' })), assets);
    });
  }

  private async generateLocked(event: InvestEvent): Promise<{ id: string; error?: string }> {
    if (event.moneyMode === 'linked') throw new Error('這筆已連結既有記帳');
    const id = event.id;
    const linked = { ...event, id, moneyMode: 'generated' as const, moneyId: event.moneyId || `invest-${id}`, pending: true };
    const { assets, events } = await this.investments.load();
    const asset = assets.find((a) => a.id === linked.asset);
    if (!asset) throw new Error('找不到投資標的');
    if (asset.kind === 'pending') throw new Error('請先在「更多 → 標的與保單」補上標的類型，再同步記帳');
    const prior = events.find((e) => e.id === linked.id);
    if (prior?.moneyId && prior.moneyId !== event.moneyId) throw new Error('投資連結已變更，請重新整理');
    if (investmentsForMoney(events, linked.moneyId).some((row) => row.id !== linked.id)) {
      if (!prior || linked.cashAmount !== prior.cashAmount || linked.cashAccount !== prior.cashAccount ||
        linked.cashDate !== prior.cashDate || linked.cashCurrency !== prior.cashCurrency) {
        throw new Error('這筆扣款有多檔投資，請在記帳 APP 編輯整筆扣款');
      }
      const previousOriginal = investOriginal(prior);
      const roundedOriginal = linked.kind === 'buy' && asset.kind === 'stock' && asset.currency === 'TWD' &&
        previousOriginal != null && linked.originalAmount === roundMoney(previousOriginal, 'TWD');
      if (isInvestmentCashBatch(linked.moneyId) && (linked.asset !== prior.asset || linked.quantity !== prior.quantity ||
        linked.price !== prior.price || (!roundedOriginal && linked.originalAmount !== prior.originalAmount) || linked.fee !== prior.fee ||
        linked.feeCurrency !== prior.feeCurrency ||
        linked.tax !== prior.tax || linked.fx !== prior.fx || linked.category !== prior.category)) {
        throw new Error('請先取消這組產生的記帳，再更新投資明細並重新產生');
      }
      await this.investments.saveEvent({ ...linked, pending: false });
      return { id };
    }
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
    const feeMatches = investFeeInCurrency(event, asset, event.cashCurrency) === investFeeInCurrency(prior, priorAsset, prior.cashCurrency);
    const matchLines = matchCash && event.fee === prior.fee && feeMatches && event.tax === prior.tax &&
      (event.fx === prior.fx || !event.tax || asset.currency === event.cashCurrency);
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
      const group = investmentsForMoney((await this.investments.load()).events, existing.id);
      const event = group.find((e) => e.id === id && e.moneyMode === 'generated');
      if (!event) throw new Error('找不到這筆連動的投資紀錄');
      const ledger = await this.money.load();
      const account = ledger.accounts.find((a) => a.name === input.account);
      const amount = input.origCurrency && account?.currency === 'TWD' ? input.twdAmount : input.amount;
      if (!account || !amount || amount <= 0 || input.direction !== existing.direction || input.paidBy ||
        (input.origCurrency && input.twdStatus !== 'final')) {
        throw new Error('投資記帳須保留原本的收支方向，並填寫實際收付款帳戶與金額');
      }
      if (group.length > 1 && (input.amount !== existing.amount || input.twdAmount !== existing.twdAmount ||
        input.account !== existing.account || input.origCurrency !== existing.origCurrency || toDateKey(input.time) !== existing.date)) {
        throw new Error('這筆扣款有多檔投資。請先解除其他投資連結，再調整整筆金額、日期或帳戶');
      }
      const txnId = await this.money.saveTxn({
        ...input, investmentId: id, investmentGenerated: true, investmentDeferred: existing.investmentDeferred,
      }, existing, existing.id);
      if (group.length > 1) return txnId;
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
    return withMoneyLock('batch-generation', () => locks ? locks.request(`life-invest-${id}`, save) : save());
  }

  async link(event: InvestEvent, moneyId: string) {
    return withMoneyLock('batch-generation', () => withMoneyLock(moneyId, () => this.linkLocked(event, moneyId)));
  }

  async linkCashBatch(ids: string[], moneyId: string, date: string) {
    return withMoneyLock('batch-generation', () => withMoneyLock(moneyId, async () => {
      const [{ assets, events }, ledger] = await Promise.all([this.investments.load(), this.money.load()]);
      const txn = ledger.txns.find((item) => item.id === moneyId && item.date === date);
      const rows = [...new Set(ids)].map((id) => {
        const row = events.find((item) => item.id === id && !item.pending && !item.moneyId);
        if (!row) throw new Error('勾選的投資已連結或已變更，請重新整理');
        return row;
      });
      if (!txn || !canLinkInvestmentCash(rows, txn)) throw new Error('請選擇當天可連結的記帳交易');
      const siblings = investmentsForMoney(events, moneyId);
      if (siblings.length && [...siblings, ...rows].some((row) => row.kind !== 'buy')) {
        throw new Error('同一筆記帳連結多筆投資時，請選擇買進紀錄');
      }
      const currency = ledger.accounts.find((account) => account.name === txn.account)?.currency ?? txn.currency;
      const pending = rows.map((row) => ({
        ...row, cashDate: row.cashDate || txn.date,
        ...(row.kind === 'dividend' && txn.amount != null
          ? { cashAmount: txn.amount, cashCurrency: currency || row.cashCurrency } : {}),
        moneyId, moneyMode: 'linked' as const, pending: true,
      }));
      await this.investments.saveCashLinks(pending, assets);
      if (!txn.investmentId) await this.money.setInvestmentLink(moneyId, rows[0].id, null);
      await this.investments.saveCashLinks(pending.map((row) => ({ ...row, pending: false })), assets);
    }));
  }

  private async linkLocked(event: InvestEvent, moneyId: string) {
    if (event.moneyMode === 'generated') throw new Error('這筆已有自動產生的記帳');
    if (isInvestmentCashBatch(moneyId)) throw new Error('這筆記帳已由勾選的投資產生，請先取消後重新勾選');
    if (event.moneyId && event.moneyId !== moneyId) throw new Error('請先解除前一筆記帳連結');
    const id = event.id || newId();
    const snapshot = await this.money.load();
    const txn = snapshot.txns.find((t) => t.id === moneyId);
    if (!txn) throw new Error('找不到這筆記帳');
    const { events } = await this.investments.load();
    const current = events.find((row) => row.id === id);
    if (current?.moneyId && current.moneyId !== moneyId) throw new Error('這筆投資已連結記帳，請重新整理');
    const siblings = investmentsForMoney(events, moneyId).filter((e) => e.id !== id);
    // （2026-11-27 使用者決定：一筆定期定額扣款可對應多檔買進。）
    if (siblings.length && (event.kind !== 'buy' || siblings.some((e) => e.kind !== 'buy'))) {
      throw new Error('同一筆記帳連結多筆投資時，請選擇買進紀錄');
    }
    if (siblings.length && txn.investmentGenerated && siblings.some((e) => e.moneyMode === 'generated' && e.cashAmount === txn.amount)) {
      throw new Error('這筆記帳原本以全部金額建立單一投資。請用既有扣款的方式建立多檔連結');
    }
    const expected = investIsSale(event) || event.kind === 'dividend' ? '入' : '出';
    if (txn.direction !== expected) throw new Error('請選擇對應的支出或收入');
    const currency = snapshot.accounts.find((a) => a.name === txn.account)?.currency ?? txn.currency;
    const confirmedCash = event.kind === 'dividend' && txn.amount != null
      ? { cashAmount: txn.amount, cashCurrency: currency || event.cashCurrency } : {};
    const linked = { ...event, ...confirmedCash, id, moneyId, cashDate: event.cashDate || txn.date,
      moneyMode: 'linked' as const, pending: true };
    await this.investments.saveEvent(linked);
    if (!txn.investmentId) await this.money.setInvestmentLink(moneyId, id, null);
    await this.investments.saveEvent({ ...linked, pending: false });
    return linked.id;
  }

  async unlink(event: InvestEvent) {
    return withMoneyLock(event.moneyId, () => this.unlinkLocked(event));
  }

  private async unlinkLocked(event: InvestEvent) {
    if (event.moneyMode !== 'linked') throw new Error('這筆不是手動連結');
    const txn = (await this.money.load()).txns.find((t) => t.id === event.moneyId);
    if (txn?.investmentId === event.id) {
      const other = investmentsForMoney((await this.investments.load()).events, event.moneyId).find((e) => e.id !== event.id);
      await this.money.setInvestmentLink(event.moneyId, other?.id ?? null, event.id);
    }
    await this.investments.saveEvent({ ...event, moneyId: '', moneyMode: '', pending: false });
  }

  async remove(event: InvestEvent) {
    return withMoneyLock('batch-generation', () => this.removeLocked(event));
  }

  private async removeLocked(event: InvestEvent) {
    const current = (await this.investments.load(true)).events.find((row) => row.id === event.id);
    if (current && current.moneyId !== event.moneyId) throw new Error('投資連結已變更，請重新整理');
    if (event.moneyMode === 'linked') await this.unlink(event);
    if (event.moneyMode === 'generated') {
      if (investmentsForMoney((await this.investments.load()).events, event.moneyId).some((row) => row.id !== event.id)) {
        throw new Error('此扣款還連著其他投資，請先解除其他連結');
      }
      await this.investments.saveEvent({ ...event, removePending: true, pending: true });
      const txn = (await this.money.load()).txns.find((t) => t.id === event.moneyId);
      if (txn?.investmentId === event.id && txn.investmentGenerated) await this.money.deleteTxn(txn);
    }
    await this.investments.removeEvent(event);
  }

  /** 將同一筆實扣按連上的標的分列。只在使用者主動確認後更換支出明細。 */
  async allocatePurchases(moneyId: string) {
    return withMoneyLock(moneyId, async () => {
      const [ledger, snap] = await Promise.all([this.money.load(), this.investments.load()]);
      const txn = ledger.txns.find((row) => row.id === moneyId);
      const group = investmentsForMoney(snap.events, moneyId);
      if (!txn || !txn.account || txn.direction !== '出' || txn.origCurrency ||
        txn.lines.some((line) => line.kind !== '支出' || line.amount <= 0) ||
        group.length < 2 || group.some((event) => event.kind !== 'buy' || event.pending)) {
        throw new Error('請先完成多筆買進的連結。分列限同幣別、只有正數支出明細的扣款');
      }
      const currency = ledger.accounts.find((account) => account.name === txn.account)?.currency ?? 'TWD';
      let total = 0;
      const lines = group.flatMap((event) => {
        const asset = snap.assets.find((row) => row.id === event.asset);
        if (!asset) throw new Error('找不到投資標的');
        if (event.cashAmount != null && event.cashCurrency !== currency) {
          throw new Error(`請將 ${asset.symbol} 的實扣金額填成銀行扣款幣別 ${currency}`);
        }
        const purchase = investmentCashInput({ ...event, cashAccount: txn.account!, cashDate: txn.date, cashCurrency: currency }, asset);
        total += purchase.amount ?? 0;
        return purchase.lines.map((line) => {
          const old = txn.lines.find((prev) => prev.note && prev.note === line.note);
          const single = txn.lines.length === 1 ? txn.lines[0] : undefined;
          const retained = single?.category && line.category && single.category.startsWith(`${line.category} / `)
            ? single.category : line.category;
          return { ...line, category: old?.category ?? retained, budget: old?.budget ?? single?.budget ?? null };
        });
      });
      if (roundMoney(total, currency) !== txn.amount) {
        throw new Error(`各檔金額加總 ${roundMoney(total, currency)} ${currency}，銀行實扣 ${txn.amount} ${currency}。請核對差額後再更新明細`);
      }
      await this.money.ensureInvestmentCategories(lines.flatMap((line) => line.category
        ? [{ path: line.category, kind: '支出' as const, invested: true }] : []));
      await this.money.saveTxn({ ...txn, lines }, txn, txn.investmentGenerated ? txn.id : undefined);
    });
  }

  async cashDividendAmount(event: InvestEvent) {
    if (event.cashAmount != null) return event.cashAmount;
    const snap = await this.investments.load();
    const asset = snap.assets.find((a) => a.id === event.asset);
    return asset ? dividendEstimate(event, dividendEligibility(event, snap.assets, snap.events), asset) : null;
  }
}
