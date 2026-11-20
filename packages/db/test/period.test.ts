import { describe, expect, it } from 'vitest';
import {
  ConditionStore,
  cycleDifference,
  durationDifference,
  estimatedCycleEnd,
  LocalBackend,
  memoryStorage,
  PeriodStore,
  predictPeriod,
  projectPeriods,
  type PeriodCycle,
} from '../src';

const cycle = (id: string, startDate: string, endDate: string, excludeFromPrediction = false): PeriodCycle => ({
  rowNumber: Number(id) + 2,
  id,
  startDate,
  endDate,
  excludeFromPrediction,
  note: null,
});

describe('生理期預測', () => {
  it('沒有設定資料時先顯示週期 28 天、經期 7 天', async () => {
    const backend = new LocalBackend(memoryStorage());
    const snap = await new PeriodStore(backend).load(1000);
    expect(snap.settings).toMatchObject({ defaultCycleDays: 28, defaultPeriodDays: 7 });
  });

  it('資料不足時使用自行設定，資料足夠後改用最近六次中間值', () => {
    const settings = {
      defaultCycleDays: 35,
      defaultPeriodDays: 6,
      ovulationEnabled: true,
      lutealPhaseDays: 14,
      upcomingReminderEnabled: true,
      upcomingReminderDaysBefore: 3,
      startDatePromptEnabled: true,
      suppliesReminderEnabled: false,
    };
    const first = predictPeriod({ cycles: [cycle('1', '2026-01-01', '2026-01-05')], settings });
    expect(first).toMatchObject({ cycleDays: 35, periodDays: 6, cycleBasis: 'setting', nextStart: '2026-02-05' });

    const cycles = [
      cycle('1', '2026-01-01', '2026-01-05'),
      cycle('2', '2026-02-04', '2026-02-09'),
      cycle('3', '2026-03-11', '2026-03-16'),
      cycle('4', '2026-04-16', '2026-04-22'),
    ];
    const p = predictPeriod({ cycles, settings });
    expect(p).toMatchObject({ cycleDays: 35, periodDays: 6, cycleBasis: 'history', periodBasis: 'history', nextStart: '2026-05-21' });
    expect(p?.ovulationDate).toBe('2026-05-07');
    expect(p?.fertileFrom).toBe('2026-05-02');
    expect(p?.fertileTo).toBe('2026-05-08');
  });

  it('排除紀錄不會用跨過該次的長間隔取代原本間隔', () => {
    const settings = {
      defaultCycleDays: 30,
      defaultPeriodDays: 5,
      ovulationEnabled: false,
      lutealPhaseDays: 14,
      upcomingReminderEnabled: true,
      upcomingReminderDaysBefore: 3,
      startDatePromptEnabled: true,
      suppliesReminderEnabled: false,
    };
    const cycles = [cycle('1', '2026-01-01', '2026-01-05'), cycle('2', '2026-02-01', '2026-02-05', true), cycle('3', '2026-03-01', '2026-03-05')];
    expect(predictPeriod({ cycles, settings })?.cycleBasis).toBe('setting');
  });

  it('尚未確認結束日使用先前經期估算，不把預計日期當真實結束日', () => {
    const settings = { defaultCycleDays: 30, defaultPeriodDays: 7, ovulationEnabled: false, lutealPhaseDays: 14, upcomingReminderEnabled: true, upcomingReminderDaysBefore: 3, startDatePromptEnabled: true, suppliesReminderEnabled: false };
    const cycles = [cycle('1', '2026-01-01', '2026-01-05'), cycle('2', '2026-02-01', '2026-02-06'), cycle('3', '2026-03-01', '2026-03-07')];
    const pending = { ...cycle('4', '2026-04-01', ''), endDate: null };
    expect(estimatedCycleEnd([...cycles, pending], settings, pending)).toBe('2026-04-06');
    expect(pending.endDate).toBeNull();
  });

  it('查看未來月份時會持續推算多次預計經期', () => {
    const settings = { defaultCycleDays: 31, defaultPeriodDays: 8, ovulationEnabled: true, lutealPhaseDays: 14, upcomingReminderEnabled: true, upcomingReminderDaysBefore: 3, startDatePromptEnabled: true, suppliesReminderEnabled: false };
    const periods = projectPeriods({ cycles: [cycle('1', '2026-11-04', '2026-11-10')], settings }, '2027-02-28');
    expect(periods.map((x) => [x.startDate, x.endDate])).toEqual([
      ['2026-12-05', '2026-12-12'],
      ['2027-01-05', '2027-01-12'],
      ['2027-02-05', '2027-02-12'],
    ]);
  });
});

describe('個人平均提醒', () => {
  it('週期只用目前日期以前最多六次，差七天才提醒', () => {
    const cycles = [
      cycle('1', '2026-01-01', '2026-01-05'),
      cycle('2', '2026-02-05', '2026-02-09'),
      cycle('3', '2026-03-12', '2026-03-16'),
      cycle('4', '2026-04-16', '2026-04-20'),
      cycle('5', '2026-06-01', '2026-06-05'),
      cycle('6', '2026-07-06', '2026-07-10'),
    ];
    expect(cycleDifference(cycles, cycles[3])).toBeNull();
    expect(cycleDifference(cycles, cycles[4])).toEqual({ average: 35, difference: 11, direction: 'longer' });
    // 後面的資料不會回頭改變第 5 次的基準。
    expect(cycleDifference([...cycles, cycle('7', '2026-09-01', '2026-09-05')], cycles[4])).toEqual({ average: 35, difference: 11, direction: 'longer' });
  });

  it('經期長度差三天才提醒', () => {
    const cycles = [
      cycle('1', '2026-01-01', '2026-01-05'),
      cycle('2', '2026-02-01', '2026-02-05'),
      cycle('3', '2026-03-01', '2026-03-06'),
      cycle('4', '2026-04-01', '2026-04-09'),
    ];
    expect(durationDifference(cycles, cycles[3])).toEqual({ average: 5, difference: 4, direction: 'longer' });
  });
});

describe('試算表補資料', () => {
  it('建立正式經期後會立即讀到，重複或重疊日期不會再新增', async () => {
    const backend = new LocalBackend(memoryStorage());
    const store = new PeriodStore(backend);
    await store.addCycle('2026-11-05');
    expect((await store.load(1000)).cycles).toMatchObject([{ startDate: '2026-11-05', endDate: null }]);
    await expect(store.addCycle('2026-11-05')).rejects.toThrow('已經是');
    await expect(store.addCycle('2026-11-06')).rejects.toThrow('重疊');
    expect(await backend.read('periodCycles')).toHaveLength(1);
    const current = (await store.load(2000)).cycles[0];
    await store.updateCycle(current, { endDate: '2026-11-07' });
    expect((await store.load(3000)).cycles[0]).toMatchObject({ startDate: '2026-11-05', endDate: '2026-11-07' });
  });

  it('歷史經期可先只存開始日，暫估範圍未重疊就不報錯', async () => {
    const backend = new LocalBackend(memoryStorage());
    const store = new PeriodStore(backend);
    await store.addCycle('2026-11-05', '2026-11-10');
    await store.addCycle('2026-09-01');
    const snap = await store.load(1000);
    expect(snap.issues).toHaveLength(0);
    expect(snap.cycles).toMatchObject([
      { startDate: '2026-09-01', endDate: null },
      { startDate: '2026-11-05', endDate: '2026-11-10' },
    ]);
  });

  it('身體狀況可不選程度與時間，並整批新增、修改及移除', async () => {
    const backend = new LocalBackend(memoryStorage());
    const store = new ConditionStore(backend);
    const first = await store.load(1000);
    await store.saveDayLogs('2026-11-05', [
      { symptom: '腰痠', severity: null, time: null, note: null },
      { symptom: '睡不好', severity: '中等', time: null, note: '半夜醒來' },
    ], []);
    const second = await store.load(2000);
    expect(second.logs).toMatchObject([
      { date: '2026-11-05', symptom: '腰痠', severity: null, time: null },
      { date: '2026-11-05', symptom: '睡不好', severity: '中等', time: null },
    ]);
    const waist = second.logs.find((x) => x.symptom === '腰痠')!;
    await store.saveDayLogs('2026-11-05', [{ id: waist.id, rowNumber: waist.rowNumber, symptom: waist.symptom, severity: '輕微', time: waist.time, note: waist.note }], second.logs);
    const third = await store.load(3000);
    expect(third.logs).toMatchObject([{ symptom: '腰痠', severity: '輕微' }]);
    expect(third.logs).toHaveLength(1);
    expect(first.items.some((x) => x.name === '腰痠')).toBe(true);
  });

  it('日期摘要可取得健康 APP 當天的體重，並依時間排序', async () => {
    const backend = new LocalBackend(memoryStorage());
    await backend.appendRaw('healthBodyMeasurements', { time: new Date('2026-11-05T08:00').getTime(), kg: 51.2 });
    await backend.appendRaw('healthBodyMeasurements', { time: new Date('2026-11-05T21:00').getTime(), kg: 51.6 });
    const snap = await new ConditionStore(backend).load(1000);
    expect(snap.weights).toMatchObject([
      { date: '2026-11-05', kg: 51.2 },
      { date: '2026-11-05', kg: 51.6 },
    ]);
  });

  it('只填起訖即可，APP 補系統欄位；重疊列保留為問題', async () => {
    const backend = new LocalBackend(memoryStorage());
    await backend.appendRaw('periodCycles', { startDate: '2026-01-01', endDate: '2026-01-05' });
    await backend.appendRaw('periodCycles', { startDate: '2026-01-04', endDate: '2026-01-08' });
    const snap = await new PeriodStore(backend).load(1000);
    expect(snap.cycles).toHaveLength(0);
    expect(snap.issues).toHaveLength(2);
    const rows = await backend.read('periodCycles');
    expect(rows[0].values.id).toBeTruthy();
    expect(rows[0].values.startDate).toBe('2026-01-01');
  });

  it('身體狀況預設值只建立一次，刪除後不會恢復', async () => {
    const backend = new LocalBackend(memoryStorage());
    const store = new ConditionStore(backend);
    const first = await store.load(1000);
    expect(first.items.some((x) => x.name === '腰痠')).toBe(true);
    expect(first.items.some((x) => x.name === '腰痛')).toBe(true);
    const waist = first.items.find((x) => x.name === '腰痛')!;
    await store.deleteItem(waist);
    const second = await store.load(2000);
    const deleted = second.items.filter((x) => x.name === '腰痛');
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({ archived: true, showInPeriod: false });
  });
});
