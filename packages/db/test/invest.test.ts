import { describe, expect, it } from 'vitest';
import {
  accountBalance, blankAsset, blankInvestEvent, dividendEligibility, dividendEstimate, impliedInvestPrice,
  importInvestRows, InvestMoney, investPortfolio, LocalBackend, memoryStorage, monthStats, previewInvestImport,
  startOfDay, type InvestAsset, type InvestEvent,
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

  it('只合併勾選的買進，個別分列本金及手續費，取消後可重新選取', async () => {
    const { bridge, store } = await setup();
    const orders = [
      { symbol: '0050', quantity: 2, price: 30 },
      { symbol: '00878', quantity: 3, price: 10 },
      { symbol: '00713', quantity: 4, price: 20 },
      { symbol: '00999', quantity: 1, price: 25 },
    ];
    for (const { symbol, quantity, price } of orders) {
      await store.saveAsset({ ...stock, id: symbol, symbol });
      await store.saveEvent(event({ id: `buy-${symbol}`, asset: symbol, cashDate: date, quantity, price, fee: 1 }));
    }
    const ids = orders.slice(0, 3).map(({ symbol }) => `buy-${symbol}`);
    const moneyId = await bridge.generateCashBatch(ids, date, '測試銀行');
    const ledger = await bridge.money.load();
    expect(ledger.txns).toHaveLength(1);
    expect(ledger.txns[0]).toMatchObject({
      id: moneyId, date, account: '測試銀行', amount: 173, note: '0050, 00878, 00713 扣款',
    });
    expect(ledger.txns[0].lines.map(({ amount, note, category }) => [amount, note, category])).toEqual([
      [60, '0050：2 股 × 每股 30', '投資 / 股票'],
      [1, '0050：手續費', '投資 / 投資手續費'],
      [30, '00878：3 股 × 每股 10', '投資 / 股票'],
      [1, '00878：手續費', '投資 / 投資手續費'],
      [80, '00713：4 股 × 每股 20', '投資 / 股票'],
      [1, '00713：手續費', '投資 / 投資手續費'],
    ]);
    const { events } = await store.load();
    expect(events.filter((row) => row.moneyId === moneyId).map((row) => row.id)).toEqual(ids);
    expect(events.find((row) => row.id === 'buy-00999')?.moneyId).toBe('');
    await expect(bridge.generateCashBatch(ids, date, '測試銀行')).rejects.toThrow('已連結');
    await bridge.cancelCashBatch(moneyId);
    expect((await bridge.money.load()).txns).toHaveLength(0);
    expect((await store.load()).events.every((row) => !row.moneyId)).toBe(true);
    expect(await bridge.generateCashBatch(ids, date, '測試銀行')).not.toBe(moneyId);
    expect((await bridge.money.load()).txns).toHaveLength(1);
  });

  it('合併記帳拒絕不同扣款日，跨試算表失敗時只重試原來勾選的投資', async () => {
    const { backend, bridge, store } = await setup();
    await store.saveEvent(event({ id: 'a', cashDate: date, quantity: 2, price: 30, fee: 1 }));
    await store.saveEvent(event({ id: 'b', cashDate: date, quantity: 3, price: 10, fee: 1 }));
    await store.saveEvent(event({ id: 'c', cashDate: '2020-07-02', quantity: 1, price: 25 }));
    await expect(bridge.generateCashBatch(['a', 'c'], date, '測試銀行')).rejects.toThrow('扣款／入帳日不同');
    const write = backend.writeBatch.bind(backend);
    let fail = true;
    backend.writeBatch = async (writes) => {
      if (fail && writes.some((item) => item.table === 'moneyTransactions')) {
        fail = false;
        throw new Error('網路暫時中斷');
      }
      await write(writes);
    };
    await expect(bridge.generateCashBatch(['a', 'b'], date, '測試銀行')).rejects.toThrow('網路暫時中斷');
    const before = (await store.load()).events;
    expect(before.map(({ pending }) => pending)).toEqual([true, true, false]);
    await bridge.retryCashBatch(before[0].moneyId);
    await bridge.retryCashBatch(before[0].moneyId);
    const ledger = await bridge.money.load();
    expect(ledger.txns).toHaveLength(1);
    expect(ledger.txns[0].amount).toBe(92);
    expect((await store.load()).events.map(({ pending }) => pending)).toEqual([false, false, false]);
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

  it('一般記帳表單可改已產生的投資記帳，之後改股數仍保留使用者填的欄位', async () => {
    const { bridge, store } = await setup();
    const buy = event({ id: '', quantity: 4, price: 100, cashAmount: 400, cashDate: date, cashAccount: '測試銀行' });
    expect((await bridge.generate(buy)).error).toBeUndefined();
    const [cash] = (await bridge.money.load()).txns;
    const depositDay = '2020-07-03';
    const time = startOfDay(depositDay) + 9 * 3600000;
    await bridge.saveFromMoney({
      ...cash, time, dateOnly: false, amount: 420, store: '測試店家', note: '自己填的備註',
      lines: [{ ...cash.lines[0], amount: 420, note: '明細備註' }],
    }, cash);
    const [investment] = (await store.load()).events;
    expect(investment).toMatchObject({ tradeDate: date, cashDate: depositDay, cashAmount: 420, quantity: 4 });
    expect((await bridge.generate({ ...investment, quantity: 5, price: 84 })).error).toBeUndefined();
    const edited = (await bridge.money.load()).txns;
    expect(edited).toHaveLength(1);
    expect(edited[0]).toMatchObject({ id: cash.id, time, dateOnly: false, amount: 420, store: '測試店家', note: '自己填的備註' });
    expect(edited[0].lines[0]).toMatchObject({ note: '明細備註', amount: 420 });
  });

  it('從原有記帳第一次補填投資時，使用完整連結編號且不重建現金交易', async () => {
    const { bridge, store } = await setup();
    const cashInput = {
      time: startOfDay(date), dateOnly: true, direction: '出' as const, account: '測試銀行',
      amount: 400, paidBy: null, currency: null, toAccount: null, toAmount: null,
      store: null, branch: null, statementText: null, note: '舊記帳', tagIds: [],
      lines: [{ kind: '支出' as const, amount: 400, category: '投資' }],
    };
    const cashId = await bridge.money.saveTxn(cashInput);
    const id = await bridge.link(event({ id: '', quantity: 4, price: 100 }), cashId);
    expect((await store.load()).events[0]).toMatchObject({ id, moneyId: cashId, moneyMode: 'linked' });
    const ledger = (await bridge.money.load()).txns;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ id: cashId, investmentId: id, note: '舊記帳', amount: 400 });
  });

  it('標的從試算表新增時補空白系統欄位，已存在的內容保留', async () => {
    const { backend, store } = await setup();
    await backend.append('investAssets', [
      { symbol: 'EXAMPLE', name: '測試標的', createdAt: 1234 },
      { id: 'existing', symbol: 'UNKNOWN', updatedAt: 4321 },
      { name: '無代號' },
    ]);
    const snap = await store.load();
    expect(snap.assets.map((a) => a.symbol)).toEqual(['TEST', 'EXAMPLE', 'UNKNOWN']);
    const rows = await backend.read('investAssets');
    expect(rows[1].values).toMatchObject({ id: snap.assets[1].id, createdAt: 1234, name: '測試標的' });
    expect(rows[1].values.updatedAt).toBeGreaterThan(10000);
    expect(rows[2].values).toMatchObject({ id: 'existing', updatedAt: 4321 });
    expect(rows[2].values.createdAt).toBeGreaterThan(10000);
    expect(rows[3].values.id).toBeNull();
    await store.load();
    expect((await backend.read('investAssets'))[1].values.updatedAt).toBe(rows[1].values.updatedAt);
  });

  it('快速新增只存代號，不猜類型或幣別，已有代號可直接選用', async () => {
    const { bridge, store } = await setup();
    const id = await store.addAssetBySymbol(' 00301 ');
    expect(await store.addAssetBySymbol('00301')).toBe(id);
    expect(await store.addAssetBySymbol(stock.symbol.toLowerCase())).toBe(stock.id);
    const { assets } = await store.load();
    expect(assets).toHaveLength(2);
    const quick = assets.find((a) => a.id === id)!;
    expect(quick).toMatchObject({ symbol: '00301', name: '', kind: 'pending', currency: '', market: '', account: '' });
    await store.saveEvent(event({ id: '', asset: id, quantity: 1, price: 10 }));
    await expect(bridge.generate(event({ id: '', asset: id, cashDate: date, cashAmount: 10, cashAccount: '測試銀行' })))
      .rejects.toThrow('補上標的類型');
    expect((await bridge.money.load()).txns).toHaveLength(0);
    await store.saveAsset({ ...quick, kind: 'fund', currency: 'TWD' });
    expect((await store.load()).events[0].asset).toBe(id);
  });

  it('一次銀行扣款可對應三檔，金額不符時不能分列，解除一筆不刪扣款和其他投資', async () => {
    const { bridge, store } = await setup();
    await store.saveAsset({ ...stock, id: 'second', symbol: 'SECOND' });
    await store.saveAsset({ ...stock, id: 'third', symbol: 'THIRD' });
    const id = await bridge.money.saveTxn({
      time: startOfDay(date), dateOnly: true, direction: '出', account: '測試銀行', amount: 600, paidBy: null,
      currency: null, toAccount: null, toAmount: null, store: null, branch: null, statementText: null, note: '整筆扣款',
      tagIds: [], lines: [{ kind: '支出', amount: 600, category: '投資' }],
    });
    const first = await bridge.link(event({ id: '', quantity: 1, price: 100, cashAmount: 100 }), id);
    const second = await bridge.link(event({ id: '', asset: 'second', quantity: 2, price: 100, cashAmount: 200 }), id);
    await expect(bridge.allocatePurchases(id)).rejects.toThrow('核對差額');
    const third = await bridge.link(event({ id: '', asset: 'third', quantity: 3, price: 100, cashAmount: 300 }), id);
    expect(new Set([first, second, third]).size).toBe(3);
    await bridge.allocatePurchases(id);
    const [txn] = (await bridge.money.load()).txns;
    expect(txn).toMatchObject({ id, investmentId: first, amount: 600, note: '整筆扣款' });
    expect(txn.lines.map((line) => [line.amount, line.note])).toEqual([
      [100, '股票TEST'], [200, '股票SECOND'], [300, '股票THIRD'],
    ]);
    const group = (await store.load()).events;
    await bridge.unlink(group.find((e) => e.id === first)!);
    expect((await store.load()).events.filter((e) => e.moneyId === id).map((e) => e.id)).toEqual([second, third]);
    expect((await bridge.money.load()).txns).toMatchObject([{ id, investmentId: second, amount: 600 }]);
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
