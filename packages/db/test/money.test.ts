import { beforeEach, describe, expect, it } from 'vitest';
import type { Account, EntryForm, MoneySnapshot, Txn } from '../src';
import {
  accountBalance,
  categoryBreakdown,
  moneyDayTotals,
  moneyEntries,
  monthlyTotals,
  parseEditHash,
  categoryTree,
  checkTxn,
  MAX_CATEGORY_DEPTH,
  recentCategories,
  DEFAULT_CATEGORIES,
  emptyForm,
  estimateFee,
  feeCategoryOf,
  feeTxnFrom,
  fmtMoney,
  formToTxn,
  lastCategoryOfStore,
  recentStores,
  LocalBackend,
  memoryStorage,
  MoneyStore,
  monthStats,
  parseDateTimeText,
  personBalances,
  splitEven,
  txnTitle,
  txnToForm,
} from '../src';

const at = (s: string) => parseDateTimeText(s)!;

const refs = {
  accounts: [
    { name: '大戶信用卡', currency: 'TWD' },
    { name: '台幣現金', currency: 'TWD' },
    { name: '日圓現金', currency: 'JPY' },
    { name: '美元活存', currency: 'USD' },
  ],
  categories: [
    { path: '食 / 三餐', kind: '支出' as const },
    { path: '住 / 日用品', kind: '支出' as const },
    { path: '人情 / 送禮', kind: '支出' as const },
    { path: '薪資', kind: '收入' as const },
    { path: '投資買進', kind: '支出' as const },
  ],
  people: [{ name: '小明' }, { name: '小華' }],
};

function form(patch: Partial<EntryForm>): EntryForm {
  return { ...emptyForm(patch.mode ?? '支出', at('2026-11-18 12:00')), ...patch };
}

/** 表單 → 交易 → 表單 */
function roundTrip(f: EntryForm) {
  const t = formToTxn(f);
  expect(checkTxn(t, refs)).toEqual([]);
  const txn: Txn = {
    ...t,
    rowNumber: 2,
    id: 'T',
    date: '2026-11-18',
    createdVia: 'money',
    lines: t.lines.map((l, i) => ({
      rowNumber: 2 + i,
      id: `L${i}`,
      transaction: 'T',
      sort: i + 1,
      category: l.category ?? null,
      person: l.person ?? null,
      debtType: l.debtType ?? null,
      budget: null,
      note: l.note ?? null,
      kind: l.kind,
      amount: l.amount,
    })),
  };
  return { t, txn, back: txnToForm(txn) };
}

describe('金額', () => {
  it('平分：零頭由付錢的人負擔', () => {
    expect(splitEven(1000, 3, 0)).toEqual([334, 333, 333]);
    expect(splitEven(1000, 3, 2)).toEqual([333, 333, 334]);
    expect(splitEven(900, 3, 0)).toEqual([300, 300, 300]);
    expect(splitEven(10, 3, 1, 'USD')).toEqual([3.33, 3.34, 3.33]);
  });
  it('顯示：新台幣整數、美元兩位小數', () => {
    expect(fmtMoney(1280)).toBe('NT$ 1,280');
    expect(fmtMoney(12.9, 'USD')).toBe('US$ 12.90');
    expect(fmtMoney(-4500, 'JPY')).toBe('−¥ 4,500');
  });
});

describe('表單 ↔ 交易', () => {
  it('支出拆兩類：交易出 1,280，明細兩筆支出', () => {
    const { t, back } = roundTrip(
      form({ account: '大戶信用卡', cats: [{ category: '食 / 三餐', amount: 800 }, { category: '住 / 日用品', amount: 480 }] }),
    );
    expect(t).toMatchObject({ direction: '出', amount: 1280 });
    expect(t.lines.map((l) => [l.kind, l.amount])).toEqual([
      ['支出', 800],
      ['支出', 480],
    ]);
    expect(back.mode).toBe('支出');
    expect(back.cats).toHaveLength(2);
  });
  it('聚餐我付 1,000，和小明各半：支出 500＋他欠我 500（分帳）', () => {
    const { t, back } = roundTrip(
      form({ account: '台幣現金', cats: [{ category: '食 / 三餐', amount: 500 }], shares: [{ person: '小明', amount: 500 }] }),
    );
    expect(t.amount).toBe(1000);
    expect(t.lines[1]).toMatchObject({ kind: '他欠我', person: '小明', debtType: '分帳', amount: 500 });
    expect(back).toMatchObject({ mode: '支出', shares: [{ person: '小明', amount: 500 }] });
  });
  it('小明先幫我付：沒帳戶，支出＋我欠他', () => {
    const { t, back } = roundTrip(form({ paidBy: '小明', cats: [{ category: '食 / 三餐', amount: 500 }] }));
    expect(t).toMatchObject({ direction: null, account: null, amount: null, paidBy: '小明' });
    expect(t.lines[1]).toMatchObject({ kind: '我欠他', person: '小明', amount: 500 });
    expect(back).toMatchObject({ mode: '支出', paidBy: '小明' });
  });
  it('收入、轉帳、借款、還款、不用還了', () => {
    expect(roundTrip(form({ mode: '收入', account: '台幣現金', cats: [{ category: '薪資', amount: 60000 }] })).back.mode).toBe('收入');
    const tr = roundTrip(form({ mode: '轉帳', account: '台幣現金', toAccount: '日圓現金', amount: 10500, toAmount: 50000 }));
    expect(tr.t).toMatchObject({ direction: '轉帳', toAmount: 50000, lines: [] });
    expect(tr.back).toMatchObject({ mode: '轉帳', toAccount: '日圓現金' });
    const lend = roundTrip(form({ mode: '借款', sub: '借出', account: '台幣現金', person: '小明', amount: 5000 }));
    expect(lend.t).toMatchObject({ direction: '出', lines: [{ kind: '他欠我', debtType: '借款' }] });
    expect(lend.back).toMatchObject({ mode: '借款', sub: '借出', person: '小明', amount: 5000 });
    const borrow = roundTrip(form({ mode: '借款', sub: '借入', account: '台幣現金', person: '小明', amount: 300 }));
    expect(borrow.back).toMatchObject({ mode: '借款', sub: '借入' });
    const repay = roundTrip(form({ mode: '還款', sub: '他還我', account: '台幣現金', person: '小明', amount: 500 }));
    expect(repay.t).toMatchObject({ direction: '入', lines: [{ kind: '他還我' }] });
    expect(txnTitle(repay.txn)).toBe('小明 還我');
    const forgive = roundTrip(form({ mode: '不用還了', sub: '他還我', person: '小明', amount: 300, cats: [{ category: '人情 / 送禮', amount: null }] }));
    expect(forgive.t.lines.map((l) => l.kind)).toEqual(['支出', '他還我']);
    expect(forgive.back).toMatchObject({ mode: '不用還了', person: '小明', amount: 300 });
  });
});

describe('檢查', () => {
  it('明細加總對不上、分類不存在、轉帳不同幣別沒填轉入金額', () => {
    const bad = formToTxn(form({ account: '台幣現金', cats: [{ category: '食 / 三餐', amount: 500 }] }));
    expect(checkTxn({ ...bad, amount: 600 }, refs)[0]).toContain('對不上');
    expect(checkTxn(formToTxn(form({ account: '台幣現金', cats: [{ category: '不存在', amount: 5 }] })), refs)[0]).toContain('不在分類清單');
    expect(checkTxn(formToTxn(form({ mode: '轉帳', account: '台幣現金', toAccount: '日圓現金', amount: 100 })), refs)[0]).toContain('請填轉入金額');
    expect(checkTxn(formToTxn(form({ account: null, cats: [{ category: '食 / 三餐', amount: 5 }] })), refs)).toContain('沒有填帳戶');
  });
  it('新台幣要整數、美元可以小數', () => {
    expect(checkTxn(formToTxn(form({ account: '台幣現金', cats: [{ category: '食 / 三餐', amount: 1.5 }] })), refs).join()).toContain('整數');
    expect(checkTxn(formToTxn(form({ account: '美元活存', cats: [{ category: '食 / 三餐', amount: 12.99 }] })), refs)).toEqual([]);
  });
});

describe('計算', () => {
  const txn = (patch: Partial<Txn>): Txn => ({
    rowNumber: 2,
    id: 'x',
    time: at('2026-11-10 12:00'),
    date: '2026-11-10',
    direction: '出',
    account: '大戶信用卡',
    amount: 100,
    paidBy: null,
    currency: null,
    toAccount: null,
    toAmount: null,
    store: null,
    branch: null,
    statementText: null,
    note: null,
    tags: [],
    createdVia: 'money',
    lines: [],
    ...patch,
  });
  const line = (kind: Txn['lines'][number]['kind'], amount: number, patch: Partial<Txn['lines'][number]> = {}) => ({
    rowNumber: 2,
    id: 'l',
    transaction: 'x',
    kind,
    amount,
    category: null,
    person: null,
    debtType: null,
    budget: null,
    note: null,
    sort: 1,
    ...patch,
  });
  const card: Account = {
    rowNumber: 2,
    id: 'a',
    name: '大戶信用卡',
    type: '信用卡',
    currency: 'TWD',
    org: '永豐銀行',
    openingDate: '2026-11-01',
    openingBalance: 2000,
    closingDay: 25,
    dueDay: 10,
    fxFeeRate: null,
    expiryDate: null,
    monthlyCheck: true,
    archived: false,
    sort: 1,
    note: null,
  };

  it('信用卡餘額：期初欠 2,000、刷 100、繳 1,500 → −600（欠 600）；期初當天的不算', () => {
    const txns = [
      txn({ amount: 100 }),
      txn({ direction: '轉帳', account: '台幣活存', toAccount: '大戶信用卡', amount: 1500, date: '2026-11-12' }),
      txn({ amount: 999, date: '2026-11-01' }),
    ];
    expect(accountBalance(card, txns)).toBe(-600);
    expect(accountBalance({ ...card, openingDate: null, openingBalance: null }, txns)).toBeNull();
  });

  it('每個人的淨額：分帳＋借款合在一起，還款扣掉；外幣分開', () => {
    const accts = [{ name: '大戶信用卡', currency: 'TWD' }, { name: '日圓現金', currency: 'JPY' }];
    const txns = [
      txn({ lines: [line('支出', 500), line('他欠我', 500, { person: '小明', debtType: '分帳' })] }),
      txn({ lines: [line('他欠我', 5000, { person: '小明', debtType: '借款' })] }),
      txn({ direction: null, account: null, paidBy: '小明', lines: [line('支出', 200), line('我欠他', 200, { person: '小明', debtType: '分帳' })] }),
      txn({ direction: '入', lines: [line('他還我', 1000, { person: '小明' })] }),
      txn({ account: '日圓現金', lines: [line('他欠我', 4500, { person: '小明', debtType: '分帳' })] }),
    ];
    const b = personBalances(txns, accts);
    expect(b.find((x) => x.currency === 'TWD')).toMatchObject({ person: '小明', net: 4300, split: 300, loan: 5000 });
    expect(b.find((x) => x.currency === 'JPY')).toMatchObject({ net: 4500 });
  });

  it('月統計：總收支、實際收支（扣投資類），依第一層分類', () => {
    const cats = [{ path: '投資買進', isInvest: true }, { path: '食 / 三餐', isInvest: false }];
    const txns = [
      txn({ lines: [line('支出', 300, { category: '食 / 三餐' }), line('支出', 10000, { category: '投資買進' })] }),
      txn({ direction: '入', lines: [line('收入', 60000, { category: '薪資' })] }),
      txn({ date: '2026-10-31', lines: [line('支出', 50, { category: '食 / 三餐' })] }),
    ];
    const [s] = monthStats(txns, cats, [{ name: '大戶信用卡', currency: 'TWD' }], '2026-11');
    expect(s).toMatchObject({ currency: 'TWD', expense: 10300, realExpense: 300, income: 60000, realIncome: 60000 });
    expect(s.expenseByTop[0]).toEqual({ name: '投資買進', amount: 10000 });
  });
});

describe('MoneyStore', () => {
  let backend: LocalBackend;
  let store: MoneyStore;
  let snap: MoneySnapshot;
  beforeEach(async () => {
    backend = new LocalBackend(memoryStorage());
    store = new MoneyStore(backend);
    snap = await store.load();
  });

  it('第一次打開放預設分類，只放一次', async () => {
    expect(snap.categories).toHaveLength(DEFAULT_CATEGORIES.length);
    for (const c of snap.categories) await store.updateCategory(c, { archived: true });
    const rows = await backend.read('moneyCategories');
    for (const r of rows) await backend.update('moneyCategories', [{ rowNumber: r.rowNumber, values: { deletedAt: 1 } }]);
    expect((await store.load()).categories).toHaveLength(0);
  });

  it('分類：只填這一層的名字、樹狀、改名只改這一層、上下移、缺上層自動補', async () => {
    expect(categoryTree(snap.categories, '支出').map((n) => n.name).slice(0, 3)).toEqual(['食', '衣', '住']);
    const p = await store.addCategory('食 / 三餐', '早餐', '收入');
    expect(p).toBe('食 / 三餐 / 早餐');
    snap = await store.load();
    expect(snap.categories.find((c) => c.path === p)?.kind).toBe('支出'); // 跟著上層
    await expect(store.addCategory(p, '蛋餅', '支出')).rejects.toThrow(`最多 ${MAX_CATEGORY_DEPTH} 層`);
    await expect(store.addCategory(null, '食 / 宵夜', '支出')).rejects.toThrow('不能有「/」');

    await store.renameCategory(snap.categories.find((c) => c.path === '食 / 三餐')!, '正餐');
    snap = await store.load();
    expect(snap.categories.some((c) => c.path === '食 / 正餐 / 早餐')).toBe(true);

    const food = categoryTree(snap.categories, '支出')[0];
    await store.moveCategory(food.children[0].cat, 1);
    snap = await store.load();
    expect(categoryTree(snap.categories, '支出')[0].children.map((n) => n.name)).toEqual(['飲料點心', '正餐', '食材']);

    await backend.appendRaw('moneyCategories', { path: '交通 / 高鐵', kind: '支出' });
    snap = await store.load();
    expect(snap.categories.find((c) => c.path === '交通')?.kind).toBe('支出');
    expect(recentCategories(snap.txns, '支出')).toEqual([]);
  });

  it('新增帳戶（自動建立機構）、記一筆、修改（明細少一筆會標記刪除）、刪除', async () => {
    await store.saveAccount({
      name: '大戶 台幣活存',
      type: '銀行',
      currency: 'twd',
      org: '永豐銀行',
      openingDate: '2026-11-01',
      openingBalance: 10000,
      closingDay: null,
      dueDay: null,
      fxFeeRate: null,
      expiryDate: null,
      monthlyCheck: true,
      archived: false,
      note: null,
    });
    await store.addPerson('小明');
    snap = await store.load();
    expect(snap.orgs.map((o) => o.name)).toEqual(['永豐銀行']);
    expect(snap.accounts[0]).toMatchObject({ currency: 'TWD', org: '永豐銀行' });

    const f = form({ account: '大戶 台幣活存', cats: [{ category: '食 / 三餐', amount: 500 }], shares: [{ person: '小明', amount: 500 }] });
    await store.saveTxn(formToTxn(f));
    snap = await store.load();
    expect(snap.txns).toHaveLength(1);
    expect(accountBalance(snap.accounts[0], snap.txns)).toBe(9000);

    await store.saveTxn(formToTxn({ ...f, shares: [] }), snap.txns[0]);
    snap = await store.load();
    expect(snap.txns[0].lines).toHaveLength(1);
    expect(snap.txns[0].amount).toBe(500);
    expect((await backend.read('moneyLines')).filter((r) => r.values.deletedAt != null)).toHaveLength(1);

    await store.deleteTxn(snap.txns[0]);
    snap = await store.load();
    expect(snap.txns).toHaveLength(0);
    expect(snap.issues).toEqual([]);
  });

  it('改名：帳戶、人物、分類（含底下的分類）用到的紀錄一起改', async () => {
    const acc = { type: '現金' as const, currency: 'TWD', org: null, openingDate: null, openingBalance: null, closingDay: null, dueDay: null, fxFeeRate: null, expiryDate: null, monthlyCheck: true, archived: false, note: null };
    await store.saveAccount({ ...acc, name: '錢包' });
    await store.addPerson('小明');
    await store.saveTxn(formToTxn(form({ account: '錢包', cats: [{ category: '食 / 三餐', amount: 100 }], shares: [{ person: '小明', amount: 100 }] })));
    snap = await store.load();
    await store.saveAccount({ ...acc, name: '台幣現金' }, snap.accounts[0]);
    snap = await store.load();
    await store.updatePerson(snap.people[0], { name: '王小明' });
    snap = await store.load();
    await store.updateCategory(snap.categories.find((c) => c.path === '食 / 三餐')!, { path: '餐飲 / 三餐' });
    snap = await store.load();
    const t = snap.txns[0];
    expect(t.account).toBe('台幣現金');
    expect(t.lines.map((l) => l.category ?? l.person)).toEqual(['餐飲 / 三餐', '王小明']);
    expect(snap.issues).toEqual([]);
  });

  it('試算表直接新增：補上 id；沒有明細的交易、找不到交易的明細列入需要補齊', async () => {
    await backend.appendRaw('moneyTransactions', { time: at('2026-11-18 09:00'), direction: '出', account: '錢包', amount: 50 });
    await backend.appendRaw('moneyLines', { transaction: 'NOPE', kind: '支出', amount: 50, category: '食 / 三餐' });
    snap = await store.load();
    const probs = snap.issues.flatMap((i) => i.problems);
    expect(probs).toContain('帳戶「錢包」不在帳戶清單裡');
    expect(probs.some((p) => p.includes('找不到交易'))).toBe(true);
    const rows = await backend.read('moneyTransactions');
    expect(rows[0].values.id).toBeTruthy();
    expect(rows[0].values.createdVia).toBe('sheet');
  });
});

describe('店家 / 對象', () => {
  it('新增交易時店家自動加進機構；試算表填的也會補；改名時交易一起改；記住上次分類', async () => {
    const backend = new LocalBackend(memoryStorage());
    const store = new MoneyStore(backend);
    await store.load();
    const acc = { type: '現金' as const, currency: 'TWD', org: null, openingDate: null, openingBalance: null, closingDay: null, dueDay: null, fxFeeRate: null, expiryDate: null, monthlyCheck: true, archived: false, note: null };
    await store.saveAccount({ ...acc, name: '錢包' });
    await store.saveTxn(formToTxn(form({ account: '錢包', store: '八方雲集', branch: '信義店', cats: [{ category: '食 / 三餐', amount: 86 }] })));
    let snap = await store.load();
    expect(snap.orgs.map((o) => o.name)).toEqual(['八方雲集']);
    expect(snap.txns[0]).toMatchObject({ store: '八方雲集', branch: '信義店' });
    expect(lastCategoryOfStore(snap.txns, '八方雲集', '支出')).toBe('食 / 三餐');
    expect(recentStores(snap.txns)).toEqual(['八方雲集']);

    const id = snap.txns[0].id;
    await backend.appendRaw('moneyTransactions', { time: at('2026-11-18 13:00'), direction: '出', account: '錢包', amount: 20, store: '全聯', id: 'T2' });
    await backend.appendRaw('moneyLines', { transaction: 'T2', kind: '支出', amount: 20, category: '住 / 日用品', id: 'L2' });
    snap = await store.load();
    expect(snap.orgs.map((o) => o.name).sort()).toEqual(['八方雲集', '全聯'].sort());

    await store.updateOrg(snap.orgs.find((o) => o.name === '八方雲集')!, { name: '八方雲集鍋貼', kind: '餐飲', foreign: true });
    await store.addOrg('LYSN', null, true);
    snap = await store.load();
    expect(snap.txns.find((t) => t.id === id)?.store).toBe('八方雲集鍋貼');
    expect(snap.orgs.find((o) => o.name === '八方雲集鍋貼')).toMatchObject({ kind: '餐飲', foreign: true });
    expect(snap.orgs.find((o) => o.name === 'LYSN')?.foreign).toBe(true);
    expect(snap.orgs.find((o) => o.name === '全聯')?.foreign).toBe(false);
  });
});

describe('退款（負數）、國外交易手續費', () => {
  it('支出填負數 = 退款：交易變成「入」，統計扣掉；和消費同一筆時是折扣', () => {
    const refund = roundTrip(form({ account: '大戶信用卡', cats: [{ category: '食 / 三餐', amount: -17 }] }));
    expect(refund.t).toMatchObject({ direction: '入', amount: 17 });
    expect(refund.back).toMatchObject({ mode: '支出', cats: [{ amount: -17 }] });
    const discount = roundTrip(form({ account: '大戶信用卡', cats: [{ category: '食 / 三餐', amount: 1000 }, { category: '食 / 三餐', amount: -100 }] }));
    expect(discount.t).toMatchObject({ direction: '出', amount: 900 });
    const [s] = monthStats([refund.txn, discount.txn], [], refs.accounts, '2026-11');
    expect(s.expense).toBe(883);
    expect(checkTxn(formToTxn(form({ account: '大戶信用卡', cats: [{ category: '食 / 三餐', amount: 0 }] })), refs).join()).toContain('不是 0');
  });
  it('手續費另記一筆：分類跟著消費（依比例分）、店家記發卡銀行、標籤跟著', () => {
    const buy = formToTxn(
      form({ account: '大戶信用卡', store: 'LYSN', tags: ['Super Junior'], cats: [{ category: '食 / 三餐', amount: 600 }, { category: '住 / 日用品', amount: 120 }] }),
    );
    const fee = estimateFee(720, 1.5);
    expect(fee).toBe(11);
    const t = feeTxnFrom(buy, fee, '台新銀行');
    expect(t).toMatchObject({ direction: '出', amount: 11, store: '台新銀行', tags: ['Super Junior'], note: 'LYSN 國外交易服務費' });
    expect(t.lines.map((l) => [l.category, l.amount])).toEqual([
      ['食 / 三餐 / 國外交易手續費', 9],
      ['住 / 日用品 / 國外交易手續費', 2],
    ]);
    expect(feeCategoryOf('樂')).toBe('樂 / 國外交易手續費');
    expect(feeCategoryOf('樂 / 數位內容 / LYSN')).toBe('樂 / 數位內容 / 國外交易手續費');
    // 兩個第三層分類對到同一個手續費分類 → 合併
    const two = feeTxnFrom({ ...buy, lines: [{ kind: '支出', amount: 600, category: '樂 / 數位內容 / LYSN' }, { kind: '支出', amount: 120, category: '樂 / 數位內容 / Weverse' }] }, 11, null);
    expect(two.lines).toHaveLength(1);
    expect(two.lines[0]).toMatchObject({ category: '樂 / 數位內容 / 國外交易手續費', amount: 11 });
  });
});

describe('統計：佔比、年統計、首頁時間軸', () => {
  it('分類佔比：主分類、展開子分類、直接記在上層的', () => {
    const by = new Map([
      ['食 / 三餐 / 午餐', 600],
      ['食 / 三餐', 100],
      ['食 / 飲料點心', 300],
      ['行', 1000],
    ]);
    const top = categoryBreakdown(by, null);
    expect(top.map((x) => [x.name, x.amount, Math.round(x.share * 100), x.hasChildren])).toEqual([
      ['食', 1000, 50, true],
      ['行', 1000, 50, false],
    ]);
    expect(categoryBreakdown(by, '食').map((x) => [x.name, x.amount, Math.round(x.share * 100)])).toEqual([
      ['三餐', 700, 70],
      ['飲料點心', 300, 30],
    ]);
    expect(categoryBreakdown(by, '食 / 三餐').map((x) => x.name)).toEqual(['午餐', '（三餐 本身）']);
  });
  it('年統計 12 個月；時間軸顯示這天的每一筆', async () => {
    const backend = new LocalBackend(memoryStorage());
    const store = new MoneyStore(backend);
    await store.load();
    const acc = { type: '現金' as const, currency: 'TWD', org: null, openingDate: null, openingBalance: null, closingDay: null, dueDay: null, fxFeeRate: null, expiryDate: null, monthlyCheck: true, archived: false, note: null };
    await store.saveAccount({ ...acc, name: '錢包' });
    await store.saveTxn(formToTxn({ ...form({ account: '錢包', store: '八方雲集', cats: [{ category: '食 / 三餐', amount: 86 }] }), time: at('2026-03-05 12:30') }));
    const snap = await store.load();
    const year = monthlyTotals(snap.txns, snap.categories, snap.accounts, '2026');
    expect(year).toHaveLength(12);
    expect(year[2]).toMatchObject({ month: '2026-03', expense: 86 });
    const [e] = moneyEntries(snap, '2026-03-05');
    expect(e).toMatchObject({ icon: '💰', name: '食 / 三餐', value: '−NT$ 86', extra: '八方雲集・錢包', ref: { app: 'money', kind: 'money' } });
    expect(moneyDayTotals(snap, '2026-03-05')).toEqual({ expense: 86, income: 0 });
    expect(parseEditHash(`#edit/money/${e.ref.id}`)).toEqual({ kind: 'money', id: e.ref.id });
  });
});
