import { beforeEach, describe, expect, it } from 'vitest';
import type { MoneySnapshot } from '../src';
import { accountBalance, addMonthsToDate, depositsDue, estimateInterest, LocalBackend, memoryStorage, MoneyStore } from '../src';

const acc = { currency: 'TWD', org: '永豐銀行', openingDate: '2026-10-31', openingBalance: 100000, closingDay: null, dueDay: null, fxFeeRate: null, expiryDate: null, monthlyCheck: true, archived: false, note: null };

describe('定存單', () => {
  let store: MoneyStore;
  let snap: MoneySnapshot;
  beforeEach(async () => {
    store = new MoneyStore(new LocalBackend(memoryStorage()));
    await store.load();
    await store.saveAccount({ ...acc, name: '大戶 台幣活存', type: '銀行' });
    await store.saveAccount({ ...acc, name: '大戶 台幣定存', type: '定存', openingBalance: 0 });
    await store.openDeposit({ fromAccount: '大戶 台幣活存', account: '大戶 台幣定存', principal: 50000, rate: 1.7, startDate: '2026-11-05', maturityDate: '2027-05-05', termMonths: 6, note: null });
    snap = await store.load();
  });

  it('開定存：活存轉到定存（不算收支），建立定存單', () => {
    const [live, dep] = snap.accounts;
    expect(accountBalance(live, snap.txns)).toBe(50000);
    expect(accountBalance(dep, snap.txns)).toBe(50000);
    expect(snap.deposits[0]).toMatchObject({ account: '大戶 台幣定存', principal: 50000, rate: 1.7, maturityDate: '2027-05-05', fromAccount: '大戶 台幣活存' });
    expect(snap.txns[0]).toMatchObject({ direction: '轉帳', lines: [] });
  });

  it('利息估算、加月份、快到期', () => {
    expect(estimateInterest(snap.deposits[0])).toBe(Math.round((50000 * 1.7 * 181) / 36500));
    expect(addMonthsToDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(depositsDue(snap.deposits, '2027-04-27')).toHaveLength(0);
    expect(depositsDue(snap.deposits, '2027-04-28')).toHaveLength(1);
    expect(depositsDue(snap.deposits, '2027-06-01')).toHaveLength(1);
  });

  it('解約：本金轉回、利息記收入、收進已結束', async () => {
    await store.closeDeposit(snap.deposits[0], { toAccount: '大戶 台幣活存', interest: 421, date: '2027-05-05' });
    snap = await store.load();
    const [live, dep] = snap.accounts;
    expect(accountBalance(live, snap.txns)).toBe(100421);
    expect(accountBalance(dep, snap.txns)).toBe(0);
    expect(snap.deposits[0].endedDate).toBe('2027-05-05');
    expect(snap.txns.find((t) => t.direction === '入')?.lines[0]).toMatchObject({ kind: '收入', category: '利息', amount: 421 });
    expect(depositsDue(snap.deposits, '2027-06-01')).toHaveLength(0);
  });

  it('續存：換新到期日；利息存進去時本金增加、定存帳戶餘額也增加', async () => {
    await store.renewDeposit(snap.deposits[0], { maturityDate: '2027-11-05', interest: 421, interestTo: 'deposit', rate: 1.6 });
    snap = await store.load();
    expect(snap.deposits[0]).toMatchObject({ startDate: '2027-05-05', maturityDate: '2027-11-05', principal: 50421, rate: 1.6, endedDate: null });
    expect(accountBalance(snap.accounts[1], snap.txns)).toBe(50421);
    expect(snap.issues).toEqual([]);
  });
});
