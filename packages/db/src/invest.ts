import type { Backend, RowValues, TableRow } from './backend';
import { newId } from './ids';
import { parseDateText, todayKey } from './time';

export const INVEST_KINDS = {
  buy: '買進', sell: '賣出', redeem: '贖回', switch: '基金換購',
  dividend: '現金股利／配息', stockDividend: '股票配股', premium: '續期保費',
  bonus: '加值回饋', insuranceCost: '保險成本', policyFee: '保單維持費用',
} as const;
export type InvestKind = keyof typeof INVEST_KINDS;
export type AssetKind = 'pending' | 'stock' | 'fund' | 'policy';

export interface InvestAsset {
  id: string;
  symbol: string;
  name: string;
  kind: AssetKind;
  account: string;
  currency: string;
  market: string;
  quoteUrl: string;
  quote: number | null;
  quoteDate: string;
  quoteSource: string;
  quoteFx: number | null;
  quoteFxDate: string;
}

export interface InvestEvent {
  id: string;
  kind: InvestKind;
  asset: string;
  tradeDate: string;
  cashDate: string;
  secondAsset: string;
  secondDate: string;
  exDate: string;
  quantity: number | null;
  price: number | null;
  secondQuantity: number | null;
  secondPrice: number | null;
  originalAmount: number | null;
  secondAmount: number | null;
  cashAmount: number | null;
  cashCurrency: string;
  fx: number | null;
  fee: number | null;
  tax: number | null;
  healthFee: number | null;
  externalFee: number | null;
  eligible: number | null;
  perUnit: number | null;
  cashAccount: string;
  category: string;
  moneyId: string;
  moneyMode: '' | 'generated' | 'linked';
  pending: boolean;
  removePending: boolean;
  note: string;
}

export const blankAsset: InvestAsset = {
  id: '', symbol: '', name: '', kind: 'stock', account: '', currency: 'TWD',
  market: 'TW', quoteUrl: '', quote: null, quoteDate: '', quoteSource: '', quoteFx: null, quoteFxDate: '',
};

export function blankInvestEvent(kind: InvestKind = 'buy', date = todayKey()): InvestEvent {
  return {
    id: '', kind, asset: '', tradeDate: date, cashDate: '', secondAsset: '', secondDate: '', exDate: '',
    quantity: null, price: null, secondQuantity: null, secondPrice: null, originalAmount: null, secondAmount: null,
    cashAmount: null, cashCurrency: 'TWD', fx: null, fee: null, tax: null, healthFee: null, externalFee: null,
    eligible: null, perUnit: null, cashAccount: '', category: '', moneyId: '', moneyMode: '', pending: false,
    removePending: false, note: '',
  };
}

function fromRow<T extends object>(defaults: T, values: RowValues): T {
  return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, values[key] ?? value])) as T;
}

const round = (n: number) => Number(n.toFixed(10));
const text = (v: unknown) => String(v ?? '').trim();
const isActive = (r: TableRow) => !r.empty && !r.values.deletedAt;
const assetKey = (a: Pick<InvestAsset, 'symbol' | 'account' | 'market' | 'kind'>) =>
  [a.symbol.toUpperCase(), a.account, a.market, a.kind].join('|');

export const investDate = (e: InvestEvent) => e.tradeDate || e.cashDate;
export const investIsPurchase = (e: InvestEvent) => e.kind === 'buy' || e.kind === 'premium';
export const investIsSale = (e: InvestEvent) => e.kind === 'sell' || e.kind === 'redeem';
export const investIsDividend = (e: InvestEvent) => e.kind === 'dividend' || e.kind === 'stockDividend';
export const investOriginal = (e: InvestEvent) =>
  e.originalAmount ?? (e.quantity != null && e.price != null ? round(e.quantity * e.price) : null);
const deductions = (e: InvestEvent) => (e.fee ?? 0) + (e.tax ?? 0) + (e.healthFee ?? 0);

export function impliedInvestPrice(e: InvestEvent, a: InvestAsset) {
  if (e.price != null || e.cashAmount == null || !e.quantity) return null;
  const fx = a.currency === e.cashCurrency ? 1 : e.cashCurrency === 'TWD' ? e.fx : null;
  return fx ? round(e.cashAmount / e.quantity / fx) : null;
}

function amountForPosition(e: InvestEvent, a: InvestAsset, direction: 'buy' | 'sell') {
  const gross = investOriginal(e);
  const fromTrade = gross == null ? null : round(gross + (direction === 'buy' ? deductions(e) : -deductions(e)));
  const cash = e.cashAmount;
  const twdCash = cash != null && e.cashCurrency === 'TWD' ? cash : null;
  const nativeCash = cash != null && e.cashCurrency === a.currency ? cash : null;
  const native = nativeCash ?? fromTrade ?? (twdCash != null && e.fx && a.currency ? round(twdCash / e.fx) : null);
  return { native, twd: twdCash ?? (native == null ? null : a.currency === 'TWD' ? native : e.fx ? round(native * e.fx) : null) };
}

export interface InvestPosition {
  asset: InvestAsset;
  quantity: number;
  cost: number | null;
  twdCost: number | null;
  lastDate: string;
  incomplete: boolean;
}

type InvestGain = { native: number | null; twd: number | null };
type Basis = Pick<InvestPosition, 'cost' | 'twdCost'>;
const add = (a: number | null, b: number | null) => a == null || b == null ? null : round(a + b);

export function investPortfolio(assets: InvestAsset[], events: InvestEvent[], through = todayKey()) {
  const positions = new Map(assets.map((asset) => [asset.id, { asset, quantity: 0, cost: 0, twdCost: 0, lastDate: '', incomplete: false } as InvestPosition]));
  const gains = new Map<string, InvestGain>();
  const shortages = new Set<string>();
  const switched = new Map<string, { basis: Basis; currency: string }>();
  const moves = events.flatMap((e, order) => e.removePending ? [] : [
    { e, order, date: investDate(e), incoming: false },
    ...(e.kind === 'switch' && e.secondDate ? [{ e, order, date: e.secondDate, incoming: true }] : []),
  ]).filter(({ date }) => date && date <= through).sort((a, b) =>
    a.date.localeCompare(b.date) || Number(a.incoming) - Number(b.incoming) || a.order - b.order);

  function increase(p: InvestPosition, quantity: number, basis: Basis) {
    p.quantity = round(p.quantity + quantity);
    p.cost = add(p.cost, basis.cost);
    p.twdCost = add(p.twdCost, basis.twdCost);
  }
  function decrease(p: InvestPosition, quantity: number, id: string): Basis {
    if (quantity - p.quantity > 1e-9 || p.quantity <= 0) {
      shortages.add(id);
      p.incomplete = true;
      p.quantity = round(p.quantity - quantity);
      p.cost = null;
      p.twdCost = null;
      return { cost: null, twdCost: null };
    }
    // （2026-11-27 使用者決定：扣除賣出單位的移動平均成本。）
    const portion = (cost: number | null) => cost == null ? null : round(cost * Math.min(1, quantity / p.quantity));
    const basis = { cost: portion(p.cost), twdCost: portion(p.twdCost) };
    p.quantity = Math.max(0, round(p.quantity - quantity));
    p.cost = p.quantity ? add(p.cost, basis.cost == null ? null : -basis.cost) : 0;
    p.twdCost = p.quantity ? add(p.twdCost, basis.twdCost == null ? null : -basis.twdCost) : 0;
    return basis;
  }

  for (const { e, date, incoming } of moves) {
    const p = positions.get(incoming ? e.secondAsset : e.asset);
    const quantity = incoming ? e.secondQuantity : e.quantity;
    if (!p || !quantity || e.kind === 'dividend') continue;
    p.lastDate = date;
    if (incoming) {
      const prior = switched.get(e.id);
      const externalFee = e.externalFee ?? 0;
      const twdFee = e.cashCurrency === 'TWD' ? externalFee : e.fx ? externalFee * e.fx : externalFee ? null : 0;
      const twdCost = add(prior?.basis.twdCost ?? null, twdFee);
      const nativeFee = p.asset.currency === e.cashCurrency ? externalFee : e.fx && twdFee != null ? twdFee / e.fx : externalFee ? null : 0;
      const cost = p.asset.currency === 'TWD' ? twdCost
        : prior?.currency === p.asset.currency ? add(prior.basis.cost, nativeFee)
        : twdCost != null && e.fx && p.asset.currency ? round(twdCost / e.fx) : null;
      increase(p, quantity, { cost, twdCost });
    } else if (investIsPurchase(e)) {
      const amount = amountForPosition(e, p.asset, 'buy');
      increase(p, quantity, { cost: amount.native, twdCost: amount.twd });
    } else if (e.kind === 'stockDividend' || e.kind === 'bonus') {
      increase(p, quantity, { cost: 0, twdCost: 0 });
    } else {
      const basis = decrease(p, quantity, e.id);
      // （2026-11-27 使用者決定：換購承接原成本；內扣費用已反映在換入數量。）
      if (e.kind === 'switch') switched.set(e.id, { basis, currency: p.asset.currency });
      if (investIsSale(e)) {
        const amount = amountForPosition(e, p.asset, 'sell');
        gains.set(e.id, { native: add(amount.native, basis.cost == null ? null : -basis.cost), twd: add(amount.twd, basis.twdCost == null ? null : -basis.twdCost) });
      }
    }
  }
  return { positions, gains, shortages };
}

export function dividendEligibility(event: InvestEvent, assets: InvestAsset[], events: InvestEvent[]) {
  const asset = assets.find((a) => a.id === event.asset);
  if (!event.exDate || !asset || asset.kind === 'pending' || asset.kind === 'policy' || (asset.kind === 'stock' && asset.market !== 'TW')) return null;
  // （2026-11-27 使用者決定：台灣股票與 ETF 用除權息日以前的成交紀錄核對。）
  const prev = new Date(`${event.exDate}T00:00:00Z`);
  prev.setUTCDate(prev.getUTCDate() - 1);
  if (!Number.isFinite(prev.getTime())) return null;
  const related = events.filter((e) => e.asset === asset.id || e.secondAsset === asset.id);
  const position = investPortfolio([asset], related, prev.toISOString().slice(0, 10)).positions.get(asset.id);
  return position?.incomplete ? null : position?.quantity ?? null;
}

export function dividendEstimate(e: InvestEvent, qualified: number | null, asset: InvestAsset) {
  if (e.kind !== 'dividend') return null;
  const base = e.originalAmount ?? (e.perUnit != null && (e.eligible ?? qualified) != null ? e.perUnit * (e.eligible ?? qualified)! : null);
  if (base == null) return null;
  const multiplier = !e.cashCurrency || e.cashCurrency === asset.currency ? 1 : e.cashCurrency === 'TWD' ? e.fx : null;
  if (multiplier == null) return null;
  const estimate = (base - deductions(e)) * multiplier;
  return Math.max(0, e.cashCurrency === 'TWD' ? Math.round(estimate) : round(estimate));
}

export function validateInvest(e: InvestEvent, assets: InvestAsset[]) {
  const a = assets.find((a) => a.id === e.asset);
  if (!a || !(e.kind in INVEST_KINDS)) throw new Error('請選擇交易類型與標的');
  if (!investDate(e) || [e.tradeDate, e.cashDate, e.secondDate, e.exDate].some((d) => d && parseDateText(d) !== d)) {
    throw new Error('請填寫正確日期');
  }
  if ([e.quantity, e.price, e.secondQuantity, e.secondPrice, e.originalAmount, e.secondAmount, e.cashAmount, e.fx,
    e.fee, e.tax, e.healthFee, e.externalFee, e.eligible, e.perUnit].some((n) => n != null && (!Number.isFinite(n) || n < 0))) {
    throw new Error('股數、金額和匯率須為非負數字');
  }
  if (e.fx === 0) throw new Error('匯率須大於 0');
  if (e.quantity === 0 || e.secondQuantity === 0) throw new Error('交易股數或單位數須大於 0');
  if (e.kind === 'switch') {
    if ((a.kind !== 'fund' && a.kind !== 'policy') || !assets.some((target) =>
      target.id === e.secondAsset && (target.kind === 'fund' || target.kind === 'policy') && target.id !== a.id)) {
      throw new Error('請選擇不同的換出與換入基金');
    }
    if (!e.quantity && !e.secondQuantity) throw new Error('至少填入一邊已確認的單位數');
    if (e.secondQuantity && !e.secondDate) throw new Error('已確認換入單位時，請填換入日期');
    if (e.secondDate && e.secondDate < investDate(e)) throw new Error('換入日期不能早於換出日期');
  }
}

export interface InvestSnapshot { assets: InvestAsset[]; events: InvestEvent[] }

export class InvestStore {
  constructor(readonly backend: Backend) {}

  async load(includeRemoved = false): Promise<InvestSnapshot> {
    const [assets, events] = await Promise.all([this.backend.read('investAssets'), this.backend.read('investEvents')]);
    // （2026-11-27 使用者決定：直接在試算表建立的有代號標的也要可用。）
    const now = Date.now();
    const updates = assets.filter((row) => isActive(row) && text(row.values.symbol)).flatMap((row) => {
      const v = row.values;
      const values: RowValues = {};
      if (!text(v.id)) values.id = newId(now);
      if (v.createdAt == null && !row.errors.includes('createdAt')) values.createdAt = now;
      if (v.updatedAt == null && !row.errors.includes('updatedAt')) values.updatedAt = now;
      return Object.keys(values).length ? [{ rowNumber: row.rowNumber, expectId: String(v.id ?? ''), values }] : [];
    });
    if (updates.length) {
      await this.backend.update('investAssets', updates);
      const byRow = new Map(updates.map((row) => [row.rowNumber, row.values]));
      for (const row of assets) Object.assign(row.values, byRow.get(row.rowNumber));
    }
    return {
      assets: assets.filter(isActive).map(({ values }) => fromRow(blankAsset, values)).filter((a) => a.id && a.symbol),
      events: events.filter(isActive).map(({ values }) => fromRow(blankInvestEvent('buy', ''), values))
        .filter((e) => e.id && e.asset && (includeRemoved || !e.removePending)),
    };
  }

  private async save(table: 'investAssets' | 'investEvents', values: RowValues) {
    const now = Date.now();
    const id = text(values.id) || newId(now);
    const rows = await this.backend.read(table);
    const previous = rows.find((row) => row.values.id === id);
    if (previous?.values.deletedAt) throw new Error('這筆資料已經刪除，請重新整理');
    if (previous) await this.backend.update(table, [{ rowNumber: previous.rowNumber, expectId: id, values: { ...values, id, updatedAt: now } }]);
    else await this.backend.append(table, [{ ...values, id, createdAt: now, updatedAt: now }]);
    return id;
  }

  async saveAsset(asset: InvestAsset) {
    const a = { ...asset, name: asset.name.trim(), symbol: asset.symbol.trim().toUpperCase(),
      account: asset.account.trim(), market: asset.market.trim().toUpperCase(), currency: asset.currency.trim().toUpperCase() };
    if (!a.symbol) throw new Error('請填標的代號');
    if (a.currency && !/^[A-Z]{3}$/.test(a.currency)) throw new Error('幣別請填三個英文字母，例如 TWD');
    const snap = await this.load();
    if (snap.assets.some((x) => x.id !== a.id && assetKey(x) === assetKey(a))) throw new Error('同一帳戶已有這個標的代號');
    return this.save('investAssets', { ...a });
  }

  async addAssetBySymbol(value: string) {
    const symbol = value.trim().toUpperCase();
    if (!symbol) throw new Error('請填標的代號');
    const { assets } = await this.load();
    const matches = assets.filter((asset) => asset.symbol.trim().toUpperCase() === symbol);
    if (matches.length > 1) throw new Error('已有多筆相同代號，請在原清單選擇正確的標的');
    if (matches[0]) return matches[0].id;
    // （2026-11-27 使用者決定：交易表單快速新增只收代號，其餘資料到更多補填。）
    return this.saveAsset({ ...blankAsset, symbol, kind: 'pending', currency: '', market: '' });
  }

  async saveEvent(event: InvestEvent) {
    validateInvest(event, (await this.load()).assets);
    return this.save('investEvents', { ...event });
  }

  async saveQuotes(quotes: (Pick<InvestAsset, 'id'> & Partial<Pick<InvestAsset, 'quote' | 'quoteDate' | 'quoteSource' | 'quoteFx' | 'quoteFxDate'>>)[]) {
    const rows = await this.backend.read('investAssets');
    const updates = quotes.flatMap(({ id, ...values }) => {
      const row = rows.find((r) => r.values.id === id && !r.values.deletedAt);
      if (!row) return [];
      if (values.quoteDate && values.quoteDate < text(row.values.quoteDate)) {
        delete values.quote; delete values.quoteDate; delete values.quoteSource;
      }
      if (values.quoteFxDate && values.quoteFxDate < text(row.values.quoteFxDate)) {
        delete values.quoteFx; delete values.quoteFxDate;
      }
      return [{ rowNumber: row.rowNumber, expectId: id, values: { ...values, updatedAt: Date.now() } }];
    });
    if (updates.length) await this.backend.update('investAssets', updates);
  }

  async removeEvent(event: InvestEvent) {
    const now = Date.now();
    await this.save('investEvents', { ...event, deletedAt: now });
  }
}
