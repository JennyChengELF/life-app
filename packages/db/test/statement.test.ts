import { beforeEach, describe, expect, it } from 'vitest';
import type { MoneySnapshot, TxnInput } from '../src';
import {
  bookBalance,
  accountDelta,
  cardTxnStatus,
  checkDiff,
  checkTxn,
  defaultCloseDate,
  dueDateFor,
  formToTxn,
  itemToForm,
  LocalBackend,
  memoryStorage,
  noteSuggestions,
  MoneyStore,
  NO_MATCH,
  parseDateTimeText,
  parseStatementText,
  parseStmtDate,
  parseStmtNumber,
  reconcile,
  stocktakeStatus,
  stocktakeWindow,
  statementPaid,
  storeForStatementText,
  txnToForm,
  unpaidStatements,
} from '../src';

const at = (s: string) => parseDateTimeText(s)!;
const base = { currency: 'TWD', org: '永豐銀行', openingDate: '2026-09-30', closingDay: null, dueDay: null, fxFeeRate: null, expiryDate: null, monthlyCheck: true, archived: false, note: null };

function spend(time: string, amount: number, account = '大戶卡', patch: Partial<TxnInput> = {}): TxnInput {
  return {
    time: at(time),
    direction: amount < 0 ? '入' : '出',
    account,
    amount: Math.abs(amount),
    paidBy: null,
    currency: null,
    toAccount: null,
    toAmount: null,
    store: null,
    branch: null,
    statementText: null,
    note: null,
    tags: [],
    lines: [{ kind: '支出', amount, category: '食 / 三餐' }],
    ...patch,
  };
}

describe('帳單日期', () => {
  it('預設對帳哪一期：信用卡最近一次結帳日；其他帳戶上個月底', () => {
    expect(defaultCloseDate({ type: '信用卡', closingDay: 15 }, '2026-11-18')).toBe('2026-11-15');
    expect(defaultCloseDate({ type: '信用卡', closingDay: 25 }, '2026-11-18')).toBe('2026-10-25');
    expect(defaultCloseDate({ type: '信用卡', closingDay: 31 }, '2026-11-18')).toBe('2026-10-31');
    expect(defaultCloseDate({ type: '銀行', closingDay: null }, '2026-11-18')).toBe('2026-10-31');
    expect(defaultCloseDate({ type: '銀行', closingDay: null }, '2026-01-05')).toBe('2025-12-31');
  });
  it('繳款期限：結帳日之後第一個繳款日', () => {
    expect(dueDateFor({ type: '信用卡', dueDay: 3 }, '2026-11-15')).toBe('2026-12-03');
    expect(dueDateFor({ type: '信用卡', dueDay: 30 }, '2026-11-15')).toBe('2026-11-30');
    expect(dueDateFor({ type: '信用卡', dueDay: 30 }, '2027-01-15')).toBe('2027-01-30');
    expect(dueDateFor({ type: '信用卡', dueDay: 30 }, '2027-02-15')).toBe('2027-02-28');
    expect(dueDateFor({ type: '銀行', dueDay: 3 }, '2026-11-15')).toBeNull();
  });
});

describe('貼上帳單明細', () => {
  it('日期、金額的各種寫法', () => {
    expect(parseStmtDate('115/11/03', '2026-11-15')).toBe('2026-11-03');
    expect(parseStmtDate('2026/11/03', '2026-11-15')).toBe('2026-11-03');
    expect(parseStmtDate('11/03', '2026-11-15')).toBe('2026-11-03');
    expect(parseStmtDate('12/28', '2027-01-15')).toBe('2026-12-28');
    expect(parseStmtDate('13/03', '2026-11-15')).toBeNull();
    expect(parseStmtNumber('1,280')).toBe(1280);
    expect(parseStmtNumber('-320')).toBe(-320);
    expect(parseStmtNumber('320-')).toBe(-320);
    expect(parseStmtNumber('(320)')).toBe(-320);
    expect(parseStmtNumber('NT$1,280')).toBe(1280);
    expect(parseStmtNumber('−45')).toBe(-45);
    expect(parseStmtNumber('全聯')).toBeNull();
  });

  it('PDF 複製（空白分開）：消費日、入帳日、說明、金額、外幣', () => {
    const text = [
      '消費日 入帳日 消費明細 新臺幣金額',
      '115/10/28 115/10/30 全聯福利中心 台北 1,280 TW',
      '115/10/20 115/10/22 NETFLIX.COM 390 10/21 NL USD 12.00',
      '115/11/02 115/11/03 退款 UNIQLO -590',
      '本期應繳金額 1,080',
    ].join('\n');
    const { rows, skipped } = parseStatementText(text, '2026-11-15');
    expect(skipped).toBe(2);
    expect(rows).toEqual([
      { date: '2026-10-28', postedDate: '2026-10-30', description: '全聯福利中心 台北', amount: 1280, origCurrency: null, origAmount: null },
      { date: '2026-10-20', postedDate: '2026-10-22', description: 'NETFLIX.COM', amount: 390, origCurrency: 'USD', origAmount: 12 },
      { date: '2026-11-02', postedDate: '2026-11-03', description: '退款 UNIQLO', amount: -590, origCurrency: null, origAmount: null },
    ]);
  });

  it('Excel 複製（有標題）：支出、存入分兩欄，餘額不要', () => {
    const text = ['日期\t摘要\t支出\t存入\t餘額', '2026/10/03\t薪資\t\t52,000\t80,000', '2026/10/05\t轉帳 卡費\t12,345\t\t67,655'].join('\n');
    const { rows } = parseStatementText(text, '2026-10-31');
    expect(rows.map((r) => [r.date, r.description, r.amount])).toEqual([
      ['2026-10-03', '薪資', 52000],
      ['2026-10-05', '轉帳 卡費', -12345],
    ]);
  });
});

describe('對帳', () => {
  let store: MoneyStore;
  let snap: MoneySnapshot;
  beforeEach(async () => {
    store = new MoneyStore(new LocalBackend(memoryStorage()));
    await store.load();
    await store.saveAccount({ ...base, name: '大戶卡', type: '信用卡', openingBalance: 0, closingDay: 15, dueDay: 3 });
    await store.saveAccount({ ...base, name: '大戶活存', type: '銀行', openingBalance: 100000 });
    await store.ensureCategories(['食', '食 / 三餐'], '支出');
    await store.saveTxn(spend('2026-10-20 12:00', 1280, '大戶卡', { store: '全聯', statementText: null }));
    await store.saveTxn(spend('2026-10-25 12:00', 390));
    await store.saveTxn(spend('2026-11-01 12:00', 100)); // 早餐
    await store.saveTxn(spend('2026-11-01 18:00', 200)); // 晚餐（帳單上兩筆合成 300）
    await store.saveTxn(spend('2026-11-14 12:00', 500)); // 帳單上沒有（下期才入帳）
    await store.addStatementItems('大戶卡', '2026-11-15', [
      { date: '2026-10-21', postedDate: '2026-10-23', description: '全聯福利中心', amount: 1280, origCurrency: null, origAmount: null },
      { date: '2026-10-25', postedDate: '2026-10-27', description: 'NETFLIX', amount: 390, origCurrency: null, origAmount: null },
      { date: '2026-11-01', postedDate: '2026-11-02', description: '合併的一筆', amount: 300, origCurrency: null, origAmount: null },
      { date: '2026-11-05', postedDate: '2026-11-06', description: '7-ELEVEN', amount: 85, origCurrency: null, origAmount: null },
    ]);
    snap = await store.load();
  });

  const card = () => snap.accounts.find((a) => a.name === '大戶卡')!;
  const stmt = () => snap.statements[0];

  it('貼上時自動建立帳單（繳款期限依繳款日算）', () => {
    expect(snap.statements).toHaveLength(1);
    expect(stmt()).toMatchObject({ account: '大戶卡', closeDate: '2026-11-15', dueDate: '2026-12-03' });
  });

  it('自動配對：金額相同、日期 3 天內；補登、留到下一期、一起配對的建議', () => {
    const r = reconcile(snap, card(), stmt());
    expect(r.start).toBe('2026-10-15');
    expect(r.pairs.map((p) => [p.item.description, p.txns[0].amount, p.auto])).toEqual([
      ['全聯福利中心', 1280, true],
      ['NETFLIX', 390, true],
    ]);
    expect(r.itemsOnly.map((i) => i.description)).toEqual(['合併的一筆', '7-ELEVEN']);
    expect(r.txnsOnly.map((t) => t.amount)).toEqual([100, 200, 500]);
    const sug = r.suggestions.get(r.itemsOnly[0].id)!;
    expect(sug).toHaveLength(1);
    expect(sug[0].map((t) => t.amount)).toEqual([100, 200]);
  });

  it('手動配對、取消配對；完成對帳後填入帳日、學會帳單名稱；下一期不再出現已配對的', async () => {
    let r = reconcile(snap, card(), stmt());
    const combo = r.suggestions.get(r.itemsOnly[0].id)![0];
    await store.setItemMatch(r.itemsOnly[0], combo.map((t) => t.id));
    snap = await store.load();
    r = reconcile(snap, card(), stmt());
    expect(r.pairs).toHaveLength(3);
    expect(r.txnsOnly.map((t) => t.amount)).toEqual([500]);

    // 取消自動配對 → 不再自動配
    const netflix = r.pairs.find((p) => p.item.description === 'NETFLIX')!;
    await store.setItemMatch(netflix.item, [NO_MATCH]);
    snap = await store.load();
    r = reconcile(snap, card(), stmt());
    expect(r.pairs).toHaveLength(2);
    expect(r.itemsOnly.map((i) => i.description)).toContain('NETFLIX');
    await store.setItemMatch(netflix.item, []);
    snap = await store.load();
    r = reconcile(snap, card(), stmt());

    await store.finishReconcile(stmt(), r.pairs.map((p) => ({ item: p.item, txnIds: p.txns.map((t) => t.id) })));
    snap = await store.load();
    expect(stmt().doneAt).not.toBeNull();
    const px = snap.txns.find((t) => t.amount === 1280)!;
    expect(px.postedDate).toBe('2026-10-23');
    expect(px.statementText).toBe('全聯福利中心');
    // 合併配對的不填帳單名稱
    expect(snap.txns.find((t) => t.amount === 100)!.statementText).toBeNull();
    expect(storeForStatementText(snap.txns, ' 全聯福利中心 ')).toBe('全聯');

    // 下一期：500 那筆留下來，已配對的不出現
    await store.saveStatement('大戶卡', '2026-12-15');
    snap = await store.load();
    const next = reconcile(snap, card(), snap.statements[1]);
    expect(next.start).toBe('2026-11-15');
    expect(next.txnsOnly.map((t) => t.amount)).toEqual([500]);
  });

  it('補登：帶入日期、金額、帳單名稱；認得的帳單名稱帶入店家和分類', async () => {
    const r = reconcile(snap, card(), stmt());
    await store.finishReconcile(stmt(), r.pairs.map((p) => ({ item: p.item, txnIds: p.txns.map((t) => t.id) })));
    snap = await store.load();
    const f = itemToForm(snap, card(), { ...r.itemsOnly[1], description: '全聯福利中心' });
    expect(f).toMatchObject({ mode: '支出', account: '大戶卡', store: '全聯', statementText: '全聯福利中心' });
    expect(f.cats).toEqual([{ category: '食 / 三餐', amount: 85 }]);
    // 銀行：負 = 支出、正 = 收入
    const bank = snap.accounts.find((a) => a.name === '大戶活存')!;
    expect(itemToForm(snap, bank, { ...r.itemsOnly[1], amount: -85 })).toMatchObject({ mode: '支出', cats: [{ amount: 85 }] });
    expect(itemToForm(snap, bank, { ...r.itemsOnly[1], amount: 500 })).toMatchObject({ mode: '收入', cats: [{ amount: 500 }] });
  });

  it('繳卡費：選繳哪一期；繳清後明細變已繳', async () => {
    await store.saveStatement('大戶卡', '2026-11-15', { amountDue: 1670 });
    snap = await store.load();
    const r = reconcile(snap, card(), stmt());
    await store.finishReconcile(stmt(), r.pairs.map((p) => ({ item: p.item, txnIds: p.txns.map((t) => t.id) })));
    snap = await store.load();
    const px = snap.txns.find((t) => t.amount === 1280)!;
    expect(cardTxnStatus(snap, px, '大戶卡')).toBe('已出帳未繳');
    expect(cardTxnStatus(snap, snap.txns.find((t) => t.amount === 500)!, '大戶卡')).toBe('未出帳');
    expect(unpaidStatements(snap, '大戶卡').map((s) => s.closeDate)).toEqual(['2026-11-15']);

    const pay = formToTxn({ ...txnToForm({ ...snap.txns[0] }), mode: '轉帳', time: at('2026-12-01 09:00'), account: '大戶活存', toAccount: '大戶卡', amount: 1670, toAmount: null, statement: stmt().id });
    await store.saveTxn(pay);
    snap = await store.load();
    expect(snap.txns.find((t) => t.direction === '轉帳')!.statement).toBe(stmt().id);
    expect(cardTxnStatus(snap, px, '大戶卡')).toBe('已繳');
    expect(unpaidStatements(snap, '大戶卡')).toEqual([]);
  });

  it('一筆銀行扣款可分配到同機構多張卡，並支援同一期分次繳', async () => {
    await store.saveAccount({ ...base, name: '大戶卡 2', type: '信用卡', openingBalance: 0, closingDay: 20, dueDay: 8 });
    await store.saveAccount({ ...base, name: '別家卡', type: '信用卡', org: '台新銀行', openingBalance: 0, closingDay: 20, dueDay: 8 });
    await store.saveStatement('大戶卡', '2026-11-15', { amountDue: 1500 });
    await store.saveStatement('大戶卡 2', '2026-11-20', { amountDue: 800 });
    await store.saveStatement('別家卡', '2026-11-20', { amountDue: 500 });
    snap = await store.load();
    const first = snap.statements.find((s) => s.account === '大戶卡' && s.closeDate === '2026-11-15')!;
    const second = snap.statements.find((s) => s.account === '大戶卡 2')!;
    const other = snap.statements.find((s) => s.account === '別家卡')!;
    const makePay = (payments: { account: string; statement: string; amount: number }[]): TxnInput => ({
      time: at('2026-12-01 09:00'),
      direction: '轉帳',
      account: '大戶活存',
      amount: payments.reduce((n, x) => n + x.amount, 0),
      paidBy: null,
      currency: null,
      toAccount: null,
      toAmount: null,
      store: null,
      branch: null,
      statementText: null,
      note: '信用卡合併扣款',
      tags: [],
      lines: [],
      cardPayments: payments,
    });

    await store.saveTxn(
      makePay([
        { account: '大戶卡', statement: first.id, amount: 1000 },
        { account: '大戶卡 2', statement: second.id, amount: 800 },
      ]),
    );
    snap = await store.load();
    const pay = snap.txns.find((t) => t.cardPayments.length === 2)!;
    expect(pay).toMatchObject({ direction: '轉帳', account: '大戶活存', amount: 1800, toAccount: null, statement: null });
    expect(accountDelta(pay, '大戶活存')).toBe(-1800);
    expect(accountDelta(pay, '大戶卡')).toBe(1000);
    expect(accountDelta(pay, '大戶卡 2')).toBe(800);
    expect(statementPaid(first, snap.txns)).toBe(1000);
    expect(statementPaid(second, snap.txns)).toBe(800);

    await store.saveTxn(makePay([{ account: '大戶卡', statement: first.id, amount: 300 }]));
    snap = await store.load();
    expect(statementPaid(first, snap.txns)).toBe(1300);
    expect(unpaidStatements(snap, '大戶卡').some((s) => s.id === first.id)).toBe(true);

    const mixed = makePay([
      { account: '大戶卡', statement: first.id, amount: 200 },
      { account: '別家卡', statement: other.id, amount: 500 },
    ]);
    expect(checkTxn(mixed, { ...snap, statements: snap.statements }).join('、')).toContain('同一家發卡機構');
    await expect(store.saveTxn(mixed)).rejects.toThrow('同一家發卡機構');
  });

  it('帳戶改名：帳單、帳單明細一起改', async () => {
    await store.saveAccount({ ...card(), name: '大戶 信用卡' }, card());
    snap = await store.load();
    expect(snap.statements[0].account).toBe('大戶 信用卡');
    expect(snap.statementItems.every((i) => i.account === '大戶 信用卡')).toBe(true);
    expect(snap.issues).toEqual([]);
  });
});

describe('月底盤點', () => {
  it('提醒期間：月底當天起到下個月 10 號', () => {
    expect(stocktakeWindow('2026-11-30')).toEqual({ month: '2026-11', from: '2026-11-30', to: '2026-12-10' });
    expect(stocktakeWindow('2026-12-10')).toEqual({ month: '2026-11', from: '2026-11-30', to: '2026-12-10' });
    expect(stocktakeWindow('2026-12-11')).toBeNull();
    expect(stocktakeWindow('2026-11-29')).toBeNull();
    expect(stocktakeWindow('2027-01-05')).toEqual({ month: '2026-12', from: '2026-12-31', to: '2027-01-10' });
  });

  it('盤點、差額（原本 / 現在）、補登後重算、調整差額；盤點完就不提醒', async () => {
    const store = new MoneyStore(new LocalBackend(memoryStorage()));
    await store.load();
    await store.saveAccount({ ...base, name: '台幣現金', type: '現金', org: null, openingBalance: 5000 });
    await store.saveAccount({ ...base, name: '大戶卡', type: '信用卡', openingBalance: 0 });
    await store.saveAccount({ ...base, name: '舊帳戶', type: '銀行', openingDate: null, openingBalance: null, monthlyCheck: false });
    await store.ensureCategories(['食', '食 / 三餐'], '支出');
    await store.saveTxn(spend('2026-11-10 12:00', 300, '台幣現金'));
    await store.saveTxn(spend('2026-11-10 12:00', 1000, '大戶卡'));
    await store.saveTxn(spend('2026-12-01 12:00', 50, '台幣現金')); // 月底之後，不算進 11/30 的餘額
    let snap = await store.load();
    let st = stocktakeStatus(snap, '2026-12-02')!;
    expect(st.pending.map((a) => a.name)).toEqual(['台幣現金', '大戶卡']);

    await store.saveBalanceCheck('台幣現金', '2026-11-30', 4500);
    await store.saveBalanceCheck('大戶卡', '2026-11-30', 1000);
    snap = await store.load();
    const cash = snap.accounts.find((a) => a.name === '台幣現金')!;
    const chk = snap.balanceChecks.find((c) => c.account === '台幣現金')!;
    expect(chk.bookSnapshot).toBe(4700);
    expect(checkDiff(cash, chk, snap.txns)).toEqual({ original: -200, now: -200 });
    expect(checkDiff(snap.accounts.find((a) => a.name === '大戶卡')!, snap.balanceChecks.find((c) => c.account === '大戶卡')!, snap.txns)).toEqual({ original: 0, now: 0 });
    st = stocktakeStatus(snap, '2026-12-02')!;
    expect(st.pending).toEqual([]);

    // 補登漏記的 150 → 現在差 −50
    await store.saveTxn(spend('2026-11-20 12:00', 150, '台幣現金'));
    snap = await store.load();
    expect(checkDiff(cash, chk, snap.txns)).toEqual({ original: -200, now: -50 });
    // 找不到原因 → 調整差額
    await store.adjustBalance(chk);
    snap = await store.load();
    expect(checkDiff(cash, chk, snap.txns).now).toBe(0);
    const adj = snap.txns.find((t) => t.lines.some((l) => l.kind === '調整'))!;
    expect(adj).toMatchObject({ direction: '出', amount: 50, date: '2026-11-30' });
    expect(bookBalance(cash, snap.txns, '2026-11-30')).toBe(4500);

    // 信用卡：實際欠比較多 → 調整是「出」
    await store.saveBalanceCheck('大戶卡', '2026-11-30', 1200);
    snap = await store.load();
    await store.adjustBalance(snap.balanceChecks.at(-1)!);
    snap = await store.load();
    expect(bookBalance(snap.accounts.find((a) => a.name === '大戶卡')!, snap.txns, '2026-11-30')).toBe(1200);

    // 沒有期初餘額：用盤點金額當期初
    await store.setOpeningFromCheck('舊帳戶', '2026-11-30', 8000);
    snap = await store.load();
    expect(bookBalance(snap.accounts.find((a) => a.name === '舊帳戶')!, snap.txns, '2026-12-02')).toBe(8000);
    expect(snap.issues).toEqual([]);
  });
});

describe('分類的常用備註', () => {
  it('用最多次的在前；「、」分開各算一個；不夠時補上一層的；自動產生的不算', async () => {
    const store = new MoneyStore(new LocalBackend(memoryStorage()));
    await store.load();
    await store.saveAccount({ ...base, name: '台幣現金', type: '現金', org: null, openingBalance: 5000 });
    await store.ensureCategories(['食', '食 / 三餐', '食 / 三餐 / 早餐', '食 / 三餐 / 午餐', '食 / 飲料點心'], '支出');
    const eat = (time: string, cat: string, note: string) =>
      store.saveTxn({ ...spend(time, 100, '台幣現金'), note, lines: [{ kind: '支出', amount: 100, category: cat }] });
    await eat('2026-11-01 08:00', '食 / 三餐 / 早餐', '蛋餅');
    await eat('2026-11-02 08:00', '食 / 三餐 / 早餐', '蛋餅、豆漿');
    await eat('2026-11-03 08:00', '食 / 三餐 / 早餐', '1/3 期：豆漿');
    await eat('2026-11-03 12:00', '食 / 三餐 / 午餐', '便當');
    await eat('2026-11-04 12:00', '食 / 三餐 / 午餐', '和同事聚餐');
    await eat('2026-11-04 15:00', '食 / 飲料點心', '珍奶');
    await eat('2026-11-05 12:00', '食 / 三餐 / 午餐', '樂 / 數位 國外交易服務費');
    const snap = await store.load();
    expect(noteSuggestions(snap.txns, ['食 / 三餐 / 早餐'])).toEqual(['豆漿', '蛋餅', '和同事聚餐', '便當']);
    expect(noteSuggestions(snap.txns, ['食 / 三餐 / 早餐'], 8, 2)).toEqual(['豆漿', '蛋餅']);
    expect(noteSuggestions(snap.txns, [])).toEqual([]);
  });

  it('拆成多個分類時，每一行明細的備註只算那一行的分類；存檔後留著', async () => {
    const store = new MoneyStore(new LocalBackend(memoryStorage()));
    await store.load();
    await store.saveAccount({ ...base, name: '台幣現金', type: '現金', org: null, openingBalance: 5000 });
    await store.ensureCategories(['食 / 食材', '住 / 日用品'], '支出');
    await store.saveTxn({
      ...spend('2026-11-01 18:00', 1280, '台幣現金'),
      note: '全聯',
      lines: [
        { kind: '支出', amount: 800, category: '食 / 食材', note: '牛肉、雞蛋' },
        { kind: '支出', amount: 480, category: '住 / 日用品', note: '衛生紙' },
      ],
    });
    const snap = await store.load();
    expect(snap.txns[0].lines.map((l) => l.note)).toEqual(['牛肉、雞蛋', '衛生紙']);
    expect(txnToForm(snap.txns[0]).cats.map((c) => c.note)).toEqual(['牛肉、雞蛋', '衛生紙']);
    expect(noteSuggestions(snap.txns, ['食 / 食材'], 8, 1)).toEqual(['牛肉', '雞蛋', '全聯']);
    expect(noteSuggestions(snap.txns, ['住 / 日用品'], 8, 1)).toEqual(['衛生紙', '全聯']);
  });
});
