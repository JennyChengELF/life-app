import { beforeEach, describe, expect, it } from 'vitest';
import { addTestCategories } from './helpers';
import type { EntryForm, MoneySnapshot } from '../src';
import {
  budgetDraft,
  budgetMonth,
  defaultBudgetFor,
  emptyForm,
  formToTxn,
  loanReminders,
  loansOutstanding,
  LocalBackend,
  memoryStorage,
  MoneyStore,
  parseDateTimeText,
  yearGaps,
} from '../src';

const at = (s: string) => parseDateTimeText(s)!;
const acc = { type: '現金' as const, currency: 'TWD', org: null, openingDate: null, openingBalance: null, closingDay: null, dueDay: null, fxFeeRate: null, expiryDate: null, monthlyCheck: true, archived: false, note: null };
const budget = (name: string, ideal: number, basic: number) => ({ name, ideal, basic, monthly: true, goal: null, archived: false, note: null });

describe('預算', () => {
  let store: MoneyStore;
  let snap: MoneySnapshot;
  const spend = async (time: string, amount: number, budgetName: string | null, category = '食 / 三餐') => {
    const f: EntryForm = { ...emptyForm('支出', at(time)), account: '錢包', cats: [{ category, amount }] };
    const t = formToTxn(f);
    t.lines = t.lines.map((l) => ({ ...l, budget: budgetName }));
    await store.saveTxn(t);
  };
  beforeEach(async () => {
    store = new MoneyStore(new LocalBackend(memoryStorage()));
    await store.load();
    await addTestCategories(store);
    await store.saveAccount({ ...acc, name: '錢包' });
    await store.saveBudget(budget('日常雜支', 12000, 9000));
    await store.saveBudget(budget('應援支出', 10000, 7000));
    snap = await store.load();
  });

  it('草稿帶基本金額；確認後可用 = 結餘＋分配＋收入 − 支出；沒用完的帶到下個月、超支扣下個月', async () => {
    expect(budgetDraft(snap).map((d) => [d.budget, d.amount, d.ideal])).toEqual([
      ['日常雜支', 9000, 12000],
      ['應援支出', 7000, 10000],
    ]);
    await store.allocate('2026-10', '每月', [
      { budget: '日常雜支', amount: 9000 },
      { budget: '應援支出', amount: 7000 },
    ]);
    await spend('2026-10-05 12:00', 8000, '日常雜支');
    await spend('2026-10-06 12:00', 9000, '應援支出'); // 超支 2000
    await spend('2026-10-07 12:00', 100, null); // 沒選預算
    snap = await store.load();
    const oct = budgetMonth(snap, '2026-10');
    expect(oct.confirmed).toBe(true);
    expect(oct.rows.map((r) => [r.budget.name, r.available])).toEqual([
      ['日常雜支', 1000],
      ['應援支出', -2000],
    ]);
    expect(oct.missing).toHaveLength(1);
    await expect(store.allocate('2026-10', '每月', [{ budget: '日常雜支', amount: 1 }])).rejects.toThrow('已經確認過');

    await store.allocate('2026-11', '每月', [
      { budget: '日常雜支', amount: 9000 },
      { budget: '應援支出', amount: 7000 },
    ]);
    snap = await store.load();
    const nov = budgetMonth(snap, '2026-11');
    expect(nov.rows.map((r) => [r.carry, r.allocated, r.available])).toEqual([
      [1000, 9000, 10000],
      [-2000, 7000, 5000],
    ]);
  });

  it('重新整理預算：從期初那天開始算，之前的不算；以最新一次為準', async () => {
    await store.allocate('2026-10', '每月', [{ budget: '日常雜支', amount: 9000 }]);
    await spend('2026-10-05 12:00', 8000, '日常雜支');
    await store.setBaseline('2026-11-01', [{ budget: '日常雜支', amount: 3000 }]);
    await spend('2026-11-03 12:00', 500, '日常雜支');
    snap = await store.load();
    const nov = budgetMonth(snap, '2026-11').rows[0];
    expect(nov).toMatchObject({ carry: 3000, used: 500, available: 2500, since: '2026-11-01' });
    // 看 10 月：期初還沒發生，照原本算
    expect(budgetMonth(snap, '2026-10').rows[0].available).toBe(1000);
    await store.setBaseline('2026-11-10', [{ budget: '日常雜支', amount: 100 }]);
    snap = await store.load();
    expect(budgetMonth(snap, '2026-11').rows[0]).toMatchObject({ carry: 100, used: 0, available: 100 });
  });

  it('待分配 = 上個月沒放進預算的收入 − 本月分配；設定成本月就和本月比', async () => {
    const inc = formToTxn({ ...emptyForm('收入', at('2026-10-25 09:00')), account: '錢包', cats: [{ category: '薪資', amount: 60000 }] });
    await store.saveTxn(inc);
    await store.allocate('2026-11', '每月', [{ budget: '日常雜支', amount: 9000 }]);
    snap = await store.load();
    expect(budgetMonth(snap, '2026-11')).toMatchObject({ incomeMonth: '2026-10', incomeBase: 60000, unallocated: 51000 });
    await store.saveMoneySettings({ incomeCompare: '本月', loanRemindDays: 30 });
    snap = await store.load();
    expect(budgetMonth(snap, '2026-11')).toMatchObject({ incomeMonth: '2026-11', unallocated: -9000 });
  });

  it('年終補差額：理想 − 已放；預設預算：分類預設 → 上次用的', async () => {
    await store.allocate('2026-01', '每月', [{ budget: '日常雜支', amount: 9000 }]);
    await store.allocate('2026-02', '每月', [{ budget: '日常雜支', amount: 9000 }]);
    await store.allocate('2026-02', '追加', [{ budget: '日常雜支', amount: 1000 }]);
    snap = await store.load();
    expect(yearGaps(snap, '2026')).toEqual([{ budget: '日常雜支', gap: 5000 }]);
    await store.allocate('2026-12', '年終', [{ budget: '日常雜支', amount: 5000 }]);
    snap = await store.load();
    expect(yearGaps(snap, '2026')).toEqual([]);

    expect(defaultBudgetFor(snap, '食 / 三餐')).toBeNull();
    await spend('2026-11-03 12:00', 50, '應援支出');
    snap = await store.load();
    expect(defaultBudgetFor(snap, '食 / 三餐')).toBe('應援支出');
    await store.setCategoryBudget(snap.categories.find((c) => c.path === '食 / 三餐')!, '日常雜支');
    snap = await store.load();
    expect(defaultBudgetFor(snap, '食 / 三餐')).toBe('日常雜支');
  });

  it('預算改名：明細、分類預設、分配一起改', async () => {
    await store.allocate('2026-11', '每月', [{ budget: '日常雜支', amount: 9000 }]);
    await spend('2026-11-03 12:00', 50, '日常雜支');
    snap = await store.load();
    await store.setCategoryBudget(snap.categories.find((c) => c.path === '食 / 三餐')!, '日常雜支');
    snap = await store.load();
    await store.saveBudget({ ...budget('日常支出', 12000, 9000) }, snap.budgets[0]);
    snap = await store.load();
    expect(snap.txns[0].lines[0].budget).toBe('日常支出');
    expect(snap.allocations[0].budget).toBe('日常支出');
    expect(snap.categories.find((c) => c.path === '食 / 三餐')?.defaultBudget).toBe('日常支出');
    expect(snap.issues).toEqual([]);
  });

  it('借出未還、超過天數提醒（還一部分不重算天數，還清就不提醒）', async () => {
    await store.addPerson('筑');
    await store.saveTxn(formToTxn({ ...emptyForm('支出', at('2026-08-23 00:30')), account: '錢包', cats: [], shares: [{ person: '筑', amount: 7380 }] }));
    await store.saveTxn(formToTxn({ ...emptyForm('還款', at('2026-09-16 06:36')), account: '錢包', person: '筑', amount: 2500 }));
    snap = await store.load();
    expect(loansOutstanding(snap)).toEqual({ total: 4880, people: 1 });
    expect(loanReminders(snap, at('2026-11-18 12:00'))).toEqual([{ person: '筑', currency: 'TWD', amount: 4880, days: 87 }]);
    expect(loanReminders(snap, at('2026-09-01 12:00'))).toEqual([]);
  });
});
