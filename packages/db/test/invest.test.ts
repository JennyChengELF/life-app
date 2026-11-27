import { describe, expect, it } from 'vitest';
import {
  accountBalance, blankAsset, blankInvestEvent, dividendEligibility, dividendEstimate, impliedInvestPrice,
  importInvestRows, InvestMoney, investPortfolio, LocalBackend, memoryStorage, monthStats, previewInvestImport,
  type InvestAsset, type InvestEvent,
} from '../src';

const date = '2020-07-01';
const end = '2020-12-31';
const stock: InvestAsset = { ...blankAsset, id: 'stock', symbol: 'TEST', name: '測試股票' };
const fund: InvestAsset = { ...blankAsset, id: 'fund', symbol: 'FUND-A', kind: 'fund' };
const target: InvestAsset = { ...fund, id: 'target', symbol: 'FUND-B' };
const event = (values: Partial<InvestEvent>): InvestEvent => ({ ...blankInvestEvent('buy', date), id: 'evt', asset: stock.id, ...values });

async function setup() {
  const backend = new LocalBackend(memoryStorage());
  const bridge = new InvestMoney(backend);
  await backend.append('moneyAccounts', [{
    id: 'bank', name: '測試銀行', type: '銀行', currency: 'TWD', openingDate: '2020-01-01', openingBalance: 2000,
  }]);
  await bridge.investments.saveAsset(stock);
  return { backend, bridge, store: bridge.investments };
}

describe('投資 APP', () => {
  it('補齊較早的買進時重算；移動平均成本含買進費用，賣出費用不重算持有單價', () => {
    const sale = event({ id: 'sell', kind: 'sell', tradeDate: '2020-08-01', quantity: 1, price: 130, fee: 4, tax: 1 });
    expect(investPortfolio([stock], [sale], end).shortages.has(sale.id)).toBe(true);
    const buy = event({ quantity: 10, price: 100, fee: 20 });
    const p = investPortfolio([stock], [sale, buy], end);
    expect(p.positions.get(stock.id)).toMatchObject({ quantity: 9, cost: 918, twdCost: 918, incomplete: false });
    expect(p.gains.get('sell')).toEqual({ native: 23, twd: 23 });
  });

  it('換出和換入可用不同日期，延續原成本，只加外扣費用', () => {
    const buy = event({ id: 'buy', asset: fund.id, quantity: 10, price: 100, cashAmount: 1000 });
    const sw = event({
      kind: 'switch', asset: fund.id, tradeDate: '2020-07-09', quantity: 5, secondAsset: target.id,
      secondDate: '2020-07-11', secondQuantity: 3, fee: 10, externalFee: 2,
    });
    const before = investPortfolio([fund, target], [buy, sw], '2020-07-10');
    expect(before.positions.get(fund.id)).toMatchObject({ quantity: 5, cost: 500 });
    expect(before.positions.get(target.id)?.quantity).toBe(0);
    const after = investPortfolio([fund, target], [buy, sw], end);
    expect(after.positions.get(target.id)).toMatchObject({ quantity: 3, cost: 502, twdCost: 502 });
    expect(after.gains.size).toBe(0);
  });

  it('基金實扣與單位為準，保留原匯率並推算淨值', () => {
    const usdFund = { ...fund, currency: 'USD' };
    const buy = event({ asset: fund.id, quantity: 12, cashAmount: 4000, fx: 32, tradeDate: '', cashDate: date });
    expect(impliedInvestPrice(buy, usdFund)).toBeCloseTo(10.4167, 4);
    expect(investPortfolio([usdFund], [buy], end).positions.get(fund.id)).toMatchObject({ quantity: 12, cost: 125, twdCost: 4000 });
  });

  it('台股股利只核對除息日前持股，配股發放才加股數', () => {
    const exDate = '2020-08-01';
    const dividend = event({ kind: 'dividend', id: 'd', exDate, quantity: null, perUnit: 3, fee: 7 });
    const initial = event({ quantity: 1000, price: 42 });
    const same = event({ id: 'same', tradeDate: exDate, quantity: 500, price: 42 });
    const shares = event({ kind: 'stockDividend', id: 'shares', tradeDate: '2020-09-01', exDate, quantity: 50 });
    const rows = [initial, same, dividend, shares];
    const eligible = dividendEligibility(dividend, [stock], rows);
    expect(eligible).toBe(1000);
    expect(dividendEstimate(dividend, eligible, stock)).toBe(2993);
    expect(investPortfolio([stock], rows, end).positions.get(stock.id)).toMatchObject({ quantity: 1550, cost: 63000 });
  });

  it('跨表失敗後重試使用同一筆，修改股數不重扣，刪除移除兩邊', async () => {
    const { backend, bridge, store } = await setup();
    const actual = backend.writeBatch.bind(backend);
    let failed = false;
    backend.writeBatch = async (writes) => {
      if (!failed && writes.some((w) => w.table === 'moneyTransactions')) {
        failed = true;
        throw new Error('網路暫時中斷');
      }
      return actual(writes);
    };
    const stockBuy = event({ id: '', quantity: 4, price: 100, fee: 10, cashAmount: 410, cashDate: date, cashAccount: '測試銀行' });
    const first = await bridge.generate(stockBuy);
    expect(first.error).toBe('網路暫時中斷');
    const pending = (await store.load()).events[0];
    expect(pending.pending).toBe(true);
    expect((await bridge.money.load()).txns).toHaveLength(0);
    expect((await bridge.generate(pending)).error).toBeUndefined();
    expect((await bridge.generate({ ...(await store.load()).events[0], quantity: 5 })).error).toBeUndefined();
    const cash = (await bridge.money.load()).txns;
    expect(cash).toHaveLength(1);
    expect(cash[0]).toMatchObject({ amount: 410, direction: '出', investmentId: first.id, dateOnly: true, date });
    expect(cash[0].lines.map((l) => [l.amount, l.category, l.note])).toEqual([
      [400, '投資 / 股票', '股票TEST'], [10, '投資 / 投資手續費', '股票TEST 交易手續費'],
    ]);
    await bridge.remove((await store.load()).events[0]);
    expect((await store.load()).events).toHaveLength(0);
    expect((await bridge.money.load()).txns).toHaveLength(0);
  });

  it('現金股利使用實收，是實際收入，未到發放日不改帳戶餘額', async () => {
    const { bridge } = await setup();
    const future = '2099-12-01';
    const d = event({ id: '', kind: 'dividend', tradeDate: '', cashDate: future, originalAmount: 202,
      cashAmount: 195, fee: 7, cashAccount: '測試銀行' });
    expect((await bridge.generate(d)).error).toBeUndefined();
    const snap = await bridge.money.load();
    expect(snap.txns[0]).toMatchObject({ date: future, amount: 195, investmentDeferred: true });
    expect(snap.txns[0].lines[0]).toMatchObject({ category: '投資收入 / 投資配息', amount: 195 });
    expect(monthStats(snap.txns, snap.categories, snap.accounts, future.slice(0, 7))[0].income).toBe(195);
    expect(accountBalance(snap.accounts[0], snap.txns)).toBe(2000);
  });

  it('已知格式分表預覽和匯入，不建立記帳，重貼時標示可能重複', async () => {
    const { backend, store, bridge } = await setup();
    const buy = { date, symbol: '00900', quantity: 2, price: 33, fee: 3 };
    const funds = { date, symbol: 'F00', quantity: 4.25, cashAmount: 900, fx: 25.5 };
    await backend.append('investPasteStockBuy', [buy]);
    await backend.append('investPasteFundBuy', [funds]);
    const choices = await previewInvestImport(store);
    expect(choices.map((x) => x.errors)).toEqual([[], []]);
    expect(await importInvestRows(store, choices)).toBe(2);
    const snap = await store.load();
    expect(snap.assets.some((a) => a.symbol === '00900')).toBe(true);
    expect(snap.events[1]).toMatchObject({ tradeDate: '', cashDate: date, cashAmount: 900, quantity: 4.25 });
    expect((await bridge.money.load()).txns).toHaveLength(0);
    await backend.append('investPasteStockBuy', [buy]);
    expect((await previewInvestImport(store))[0].duplicate).toBe(true);
  });
});
