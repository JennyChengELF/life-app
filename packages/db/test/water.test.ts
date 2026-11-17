import { describe, expect, it } from 'vitest';
import {
  addDays,
  computeGoal,
  decodeCell,
  DEFAULT_SETTINGS,
  drinkOf,
  encodeCell,
  LocalBackend,
  memoryStorage,
  parseDateTimeText,
  serialToMs,
  toDateKey,
  WaterStore,
} from '../src';

const at = (s: string) => parseDateTimeText(s)!;

describe('目標公式', () => {
  it('體重 × 係數 ＋ 額外加量，四捨五入到百位', () => {
    // 71.1 × 30 + 200 = 2333 → 2300
    expect(computeGoal(71.1, { factor: 30, extraMl: 200, roundTo100: true }).goal).toBe(2300);
    expect(computeGoal(71.1, { factor: 30, extraMl: 200, roundTo100: false }).goal).toBe(2333);
    expect(computeGoal(60, DEFAULT_SETTINGS).goal).toBe(1800);
  });
  it('沒有體重用預設 2000', () => {
    expect(computeGoal(null, DEFAULT_SETTINGS)).toMatchObject({ goal: 2000, weightUsed: null });
  });
});

describe('試算表格式轉換', () => {
  it('日期序號 → 本地時間', () => {
    // 46343 = 2026-11-17；0.5 = 中午
    expect(serialToMs(46343.5)).toBe(at('2026-11-17 12:00'));
  });
  it('手打的時間文字', () => {
    expect(decodeCell('datetime', '2026/11/17 14:30')).toEqual({ ok: true, value: at('2026-11-17 14:30') });
    expect(decodeCell('datetime', '14:30').ok).toBe(false);
    expect(decodeCell('datetime', 0.6).ok).toBe(false); // 只有時間沒有日期
    expect(decodeCell('datetime', '2026/2/30 10:00').ok).toBe(false);
  });
  it('數字可帶 ml', () => {
    expect(decodeCell('number', '500ml')).toEqual({ ok: true, value: 500 });
    expect(decodeCell('number', '一杯').ok).toBe(false);
  });
  it('文字寫入時加 \' 避免變成公式', () => {
    expect(encodeCell('text', '=1+1')).toBe("'=1+1");
    expect(encodeCell('datetime', at('2026-11-17 09:05'))).toBe('2026-11-17 09:05:00');
  });
});

describe('WaterStore', () => {
  const setup = () => {
    const b = new LocalBackend(memoryStorage());
    return { b, store: new WaterStore(b) };
  };

  it('記錄喝水、算今天總量與達標', async () => {
    const { store } = setup();
    const now = at('2026-11-17 15:00');
    await store.addWeight(60, at('2026-11-17 07:00'));
    await store.addLog(1000, at('2026-11-17 09:00'));
    await store.addLog(800, at('2026-11-17 13:00'));
    const s = await store.load(now);
    const today = s.days.get('2026-11-17')!;
    expect(today).toMatchObject({ goal: 1800, total: 1800, achieved: true, locked: false, weightUsed: 60 });
  });

  it('過了當天鎖定目標，之後體重改變不影響', async () => {
    const { store } = setup();
    await store.addWeight(60, at('2026-11-16 07:00'));
    await store.addLog(500, at('2026-11-16 10:00'));
    await store.load(at('2026-11-16 20:00')); // 11/16 當天打開過：目標 1800
    await store.addWeight(80, at('2026-11-17 07:00'));
    const s = await store.load(at('2026-11-17 08:00'));
    expect(s.days.get('2026-11-16')).toMatchObject({ goal: 1800, locked: true, total: 500 });
    expect(s.days.get('2026-11-17')).toMatchObject({ goal: 2400, locked: false });
  });

  it('過去沒有目標紀錄的日子，用當天以前最新的體重', async () => {
    const { store } = setup();
    await store.addWeight(50, at('2026-11-01 07:00'));
    await store.addWeight(70, at('2026-11-10 07:00'));
    await store.addLog(300, at('2026-11-05 10:00'));
    const s = await store.load(at('2026-11-17 08:00'));
    expect(s.days.get('2026-11-05')).toMatchObject({ goal: 1500, weightUsed: 50, locked: true });
  });

  it('當天新量的體重會更新當天目標', async () => {
    const { store } = setup();
    await store.addWeight(60, at('2026-11-16 07:00'));
    await store.load(at('2026-11-17 07:00'));
    await store.addWeight(70, at('2026-11-17 07:30'));
    const s = await store.load(at('2026-11-17 08:00'));
    expect(s.days.get('2026-11-17')!.goal).toBe(2100);
  });

  it('在試算表直接新增的列：有效就補上 id，無效列入需要補齊', async () => {
    const { b, store } = setup();
    await b.appendRaw('waterLogs', { time: at('2026-11-17 10:00'), ml: 300 });
    await b.appendRaw('waterLogs', { time: null, ml: 300 });
    await b.appendRaw('waterLogs', { time: at('2026-11-17 11:00'), ml: -5 });
    const s = await store.load(at('2026-11-17 12:00'));
    expect(s.logs).toHaveLength(1);
    expect(s.logs[0]).toMatchObject({ ml: 300, date: '2026-11-17', createdVia: 'sheet' });
    expect(s.logs[0].id).toHaveLength(26);
    expect(s.waterIssues.map((i) => i.rowNumber)).toEqual([3, 4]);

    // 修正後就變成正常紀錄
    await store.fixIssue(s.waterIssues[0], { time: at('2026-11-17 11:30'), amount: 200 });
    await store.discardIssue(s.waterIssues[1]);
    const s2 = await store.load(at('2026-11-17 12:00'));
    expect(s2.waterIssues).toHaveLength(0);
    expect(s2.days.get('2026-11-17')!.total).toBe(500);
  });

  it('刪除（撤銷）後不算進總量', async () => {
    const { store } = setup();
    await store.addLog(500, at('2026-11-17 09:00'));
    let s = await store.load(at('2026-11-17 10:00'));
    await store.deleteLog(s.logs[0]);
    s = await store.load(at('2026-11-17 10:00'));
    expect(s.logs).toHaveLength(0);
    expect(s.days.get('2026-11-17')!.total).toBe(0);
  });

  it('修改時間到前一天，兩天的總量都更新', async () => {
    const { store } = setup();
    await store.addLog(500, at('2026-11-17 09:00'));
    let s = await store.load(at('2026-11-17 10:00'));
    await store.updateLog(s.logs[0], { time: at('2026-11-16 21:00') });
    s = await store.load(at('2026-11-17 10:00'));
    expect(s.days.get('2026-11-16')!.total).toBe(500);
    expect(s.days.get('2026-11-17')!.total).toBe(0);
    expect(toDateKey(s.logs[0].time)).toBe(addDays('2026-11-17', -1));
  });

  it('飲品：第一次使用建立開水、其他；記錄喝什麼；空白算開水', async () => {
    const { b, store } = setup();
    let s = await store.load(at('2026-11-17 08:00'));
    expect(s.drinks.map((d) => d.name)).toEqual(['開水', '其他']);
    await store.addLog(300, at('2026-11-17 09:00'), '其他');
    await b.appendRaw('waterLogs', { time: at('2026-11-17 10:00'), ml: 200 });
    s = await store.load(at('2026-11-17 11:00'));
    expect(s.logs.map((l) => drinkOf(l, s.drinks))).toEqual(['其他', '開水']);
    // 再次讀取不會重複建立
    s = await store.load(at('2026-11-17 11:00'));
    expect(s.drinks).toHaveLength(2);
  });

  it('同時讀取兩次不會重複建立飲品、每日目標', async () => {
    const { b, store } = setup();
    const now = at('2026-11-17 08:00');
    await Promise.all([store.load(now), store.load(now)]);
    const drinks = (await b.read('waterDrinks')).filter((r) => r.values.deletedAt == null);
    const days = (await b.read('waterDays')).filter((r) => r.values.deletedAt == null);
    expect(drinks.map((r) => r.values.name)).toEqual(['開水', '其他']);
    expect(days).toHaveLength(1);
  });

  it('已經重複的飲品、每日目標會自動清掉多的', async () => {
    const { b, store } = setup();
    const now = at('2026-11-17 08:00');
    await store.load(now);
    // 模擬之前的錯誤：多一組開水、其他，和重複的今天
    await b.appendRaw('waterDrinks', { name: '開水', sort: 0, id: 'DUP1' });
    await b.appendRaw('waterDrinks', { name: '其他', sort: 1, id: 'DUP2' });
    await b.appendRaw('waterDays', { date: '2026-11-17', goal: 2000, id: 'DUP3' });
    const s = await store.load(now);
    expect(s.drinks.map((d) => d.name)).toEqual(['開水', '其他']);
    const live = (await b.read('waterDrinks')).filter((r) => r.values.deletedAt == null);
    expect(live).toHaveLength(2);
    expect((await b.read('waterDays')).filter((r) => r.values.deletedAt == null)).toHaveLength(1);
  });

  it('飲品：新增、改名（紀錄跟著改）、刪除', async () => {
    const { store } = setup();
    let s = await store.load(at('2026-11-17 08:00'));
    await store.addDrink('茶', s.drinks);
    s = await store.load(at('2026-11-17 08:00'));
    await expect(store.addDrink('茶', s.drinks)).rejects.toThrow();
    await store.addLog(250, at('2026-11-17 09:00'), '茶');
    const tea = s.drinks.find((d) => d.name === '茶')!;
    await store.renameDrink(tea, '綠茶', s.drinks);
    s = await store.load(at('2026-11-17 10:00'));
    expect(s.drinks.map((d) => d.name)).toEqual(['開水', '其他', '綠茶']);
    expect(s.logs[0].drink).toBe('綠茶');
    await store.deleteDrink(s.drinks[2], s.drinks);
    s = await store.load(at('2026-11-17 10:00'));
    expect(s.drinks.map((d) => d.name)).toEqual(['開水', '其他']);
    expect(s.logs[0].drink).toBe('綠茶'); // 舊紀錄保留名稱
  });

  it('設定：係數範圍檢查、存檔後套用', async () => {
    const { store } = setup();
    await expect(store.saveSettings({ factor: 50 })).rejects.toThrow();
    await store.saveSettings({ factor: 35, extraMl: 200 });
    await store.saveSettings({ factor: 33 });
    const s = await store.load(at('2026-11-17 10:00'));
    expect(s.settings).toEqual({ factor: 33, extraMl: 200, roundTo100: true });
  });
});
