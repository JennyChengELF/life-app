import { describe, expect, it } from 'vitest';
import type { BloodPressure } from '../src';
import {
  bpAttentionReasons,
  bpPeriodOf,
  compute722,
  guessTiming,
  glucoseAttentionReasons,
  HealthStore,
  judgeBp,
  judgeBpReading,
  judgeGlucose,
  judgeTemp,
  LocalBackend,
  memoryStorage,
  parseDateTimeText,
  parseRange,
  rangesOverlap,
} from '../src';

const at = (s: string) => parseDateTimeText(s)!;
const setup = () => {
  const b = new LocalBackend(memoryStorage());
  return { b, store: new HealthStore(b) };
};
const PERIODS = { morning: parseRange('04:00-12:00')!, evening: parseRange('18:00-02:00')! };

describe('顏色標示', () => {
  it('血壓（台灣 2022 居家標準）', () => {
    expect(judgeBp(118, 76).label).toBe('正常');
    expect(judgeBp(130, 70).label).toBe('偏高');
    expect(judgeBp(120, 85).label).toBe('偏高');
    expect(judgeBp(141, 70)).toEqual({ level: 'bad', label: '高' });
    expect(judgeBp(88, 58).label).toBe('偏低');
  });

  it('血壓列出全部需注意原因，包含安靜休息時脈搏範圍', () => {
    expect(bpAttentionReasons(145, 55, 110)).toEqual([
      { level: 'bad', text: '收縮壓過高：145 mmHg（140 以上）' },
      { level: 'warn', text: '舒張壓偏低：55 mmHg（低於 60）' },
      { level: 'warn', text: '心跳過快：110 次／分（高於 100）' },
    ]);
    expect(bpAttentionReasons(118, 76, 59)[0].text).toContain('心跳偏慢');
    expect(judgeBpReading(118, 76, 70)).toEqual({ level: 'ok', label: '一般範圍' });
    expect(judgeBpReading(145, 55, 110)).toEqual({ level: 'bad', label: '需注意' });
  });

  it('血糖依測量時機', () => {
    expect(judgeGlucose('空腹', 99).level).toBe('ok');
    expect(judgeGlucose('空腹', 100).level).toBe('warn');
    expect(judgeGlucose('飯前', 126).level).toBe('bad');
    expect(judgeGlucose('飯後2小時', 139).level).toBe('ok');
    expect(judgeGlucose('飯後2小時', 199).level).toBe('warn');
    expect(judgeGlucose('隨機', 180).level).toBe('ok');
    expect(judgeGlucose('睡前', 200).level).toBe('bad');
    expect(judgeGlucose('飯後2小時', 65)).toEqual({ level: 'warn', label: '偏低' });
    expect(judgeGlucose('空腹', 50)).toEqual({ level: 'bad', label: '低血糖' });
  });

  it('血糖原因包含測量時機、數值與對應門檻', () => {
    expect(glucoseAttentionReasons('空腹', 126)).toEqual([
      { level: 'bad', text: '空腹血糖過高：126 mg/dL（126 以上）' },
    ]);
    expect(glucoseAttentionReasons('飯後2小時', 150)[0].text).toBe('飯後 2 小時血糖偏高：150 mg/dL（140–199）');
    expect(glucoseAttentionReasons('睡前', 65)[0].text).toBe('睡前血糖偏低：65 mg/dL（低於 70）');
    expect(glucoseAttentionReasons('隨機', 180)).toEqual([]);
  });

  it('體溫：一般 37.5 微燒、38 發燒；基礎體溫不標', () => {
    expect(judgeTemp('一般', 37.4)?.level).toBe('ok');
    expect(judgeTemp('一般', 37.5)?.label).toBe('微燒');
    expect(judgeTemp('一般', 38)?.label).toBe('發燒');
    expect(judgeTemp('基礎', 38)).toBeNull();
  });

  it('依時間猜血糖測量時機', () => {
    expect(guessTiming(at('2026-11-17 06:30'))).toBe('空腹');
    expect(guessTiming(at('2026-11-17 12:30'))).toBe('飯前');
    expect(guessTiming(at('2026-11-17 22:00'))).toBe('睡前');
    expect(guessTiming(at('2026-11-17 01:00'))).toBe('睡前');
  });
});

describe('血壓 722', () => {
  it('時段：晚上跨過半夜的部分算前一天', () => {
    expect(bpPeriodOf(at('2026-11-17 07:00'), PERIODS)).toEqual({ day: '2026-11-17', period: 'morning' });
    expect(bpPeriodOf(at('2026-11-17 21:00'), PERIODS)).toEqual({ day: '2026-11-17', period: 'evening' });
    expect(bpPeriodOf(at('2026-11-18 01:30'), PERIODS)).toEqual({ day: '2026-11-17', period: 'evening' });
    expect(bpPeriodOf(at('2026-11-17 15:00'), PERIODS)).toBeNull();
  });

  it('時段重疊檢查', () => {
    expect(rangesOverlap(PERIODS.morning, PERIODS.evening)).toBe(false);
    expect(rangesOverlap(parseRange('04:00-12:00')!, parseRange('11:00-13:00')!)).toBe(true);
    expect(rangesOverlap(parseRange('22:00-05:00')!, parseRange('04:30-08:00')!)).toBe(true);
  });

  let n = 0;
  const bp = (time: string, systolic: number, diastolic: number, plusMin = 0): BloodPressure => ({
    rowNumber: ++n,
    id: String(n),
    time: at(time) + plusMin * 60000,
    date: time.slice(0, 10),
    note: null,
    systolic,
    diastolic,
    pulse: 70,
  });
  /** 一天：早上 2 筆、晚上 2 筆 */
  const day = (d: string, sys = 120, dia = 80, eveningTime = '21:00') => [
    bp(`${d} 07:00`, sys, dia),
    bp(`${d} 07:00`, sys + 2, dia, 2),
    bp(`${d} ${eveningTime}`, sys, dia),
    // 2 分鐘後（23:58 的話會過半夜）
    bp(`${d} ${eveningTime}`, sys + 2, dia, 2),
  ];
  const week = (start: number) => Array.from({ length: 7 }, (_, i) => `2026-11-${String(start + i).padStart(2, '0')}`);

  it('連續 7 天早晚各 2 筆 → 算 722 平均', () => {
    const list = week(10).flatMap((d) => day(d));
    const r = compute722(list, PERIODS)!;
    expect(r.days).toEqual(week(10));
    expect(r.all).toMatchObject({ sys: 121, dia: 80, n: 28 });
    expect(r.judge.label).toBe('偏高');
  });

  it('只有 6 天、或某一次只量 1 筆 → 沒有 722', () => {
    expect(compute722(week(10).slice(1).flatMap((d) => day(d)), PERIODS)).toBeNull();
    const list = week(10).flatMap((d) => day(d));
    list.splice(1, 1); // 第一天早上只剩 1 筆
    expect(compute722(list, PERIODS)).toBeNull();
  });

  it('同一個時段的第二次量測（隔了 10 分鐘以上）不算；晚上過半夜算前一天', () => {
    const list = week(10).flatMap((d) => day(d, 120, 78, '23:58'));
    list.push(bp('2026-11-12 11:00', 200, 110)); // 11/12 早上的第二次量測
    const r = compute722(list, PERIODS)!;
    expect(r).not.toBeNull();
    expect(r.all.sys).toBe(121);
  });

  it('有兩段符合時用最近的一段', () => {
    const list = [...week(1).flatMap((d) => day(d, 150, 95)), ...week(10).flatMap((d) => day(d, 110, 70))];
    expect(compute722(list, PERIODS)!.days[0]).toBe('2026-11-10');
  });
});

describe('HealthStore：血壓、血糖、體溫', () => {
  it('新增、修改、刪除', async () => {
    const { store } = setup();
    await store.load();
    await store.addBp({ systolic: 125, diastolic: 82, pulse: 70 }, at('2026-11-17 07:00'));
    await store.addGlucose({ timing: '空腹', mgdl: 95 }, at('2026-11-17 07:10'));
    await store.addTemp({ kind: '基礎', site: '口溫', celsius: 36.456 }, at('2026-11-17 06:30'));
    await store.addTemp({ kind: '一般', site: null, celsius: 37.86 }, at('2026-11-17 12:00'));
    let s = await store.load();
    expect(s.bp[0]).toMatchObject({ systolic: 125, diastolic: 82, pulse: 70, date: '2026-11-17' });
    expect(s.glucose[0]).toMatchObject({ timing: '空腹', mgdl: 95 });
    expect(s.temps.map((t) => t.celsius)).toEqual([36.46, 37.9]);
    await store.updateGlucose(s.glucose[0], { timing: '飯前', mgdl: 101 }, s.glucose[0].time, '改');
    await store.deleteVital('healthBloodPressure', s.bp[0]);
    s = await store.load();
    expect(s.glucose[0]).toMatchObject({ timing: '飯前', mgdl: 101, note: '改' });
    expect(s.bp).toEqual([]);
  });

  it('輸入檢查：數值不合理、高低壓填反', async () => {
    const { store } = setup();
    await expect(store.addBp({ systolic: 80, diastolic: 120, pulse: null })).rejects.toThrow('填反');
    await expect(store.addGlucose({ timing: '空腹', mgdl: 5000 })).rejects.toThrow('血糖');
    await expect(store.addTemp({ kind: '一般', site: null, celsius: 50 })).rejects.toThrow('體溫');
  });

  it('在試算表直接新增的列：有效補 id，看不懂的列入需要補齊', async () => {
    const { b, store } = setup();
    await b.appendRaw('healthBloodGlucose', { time: at('2026-11-17 07:00'), timing: '空腹', mgdl: 92 });
    await b.appendRaw('healthBloodGlucose', { time: at('2026-11-17 08:00'), timing: '早上', mgdl: 92 });
    await b.appendRaw('healthBloodPressure', { time: at('2026-11-17 08:00'), systolic: 80, diastolic: 120 });
    await b.appendRaw('healthTemperature', { time: at('2026-11-17 08:00'), kind: '一般', site: '肛溫', celsius: 37 });
    const s = await store.load();
    expect(s.glucose).toHaveLength(1);
    expect(s.glucose[0].id).toBeTruthy();
    expect(s.issues.map((i) => i.problems[0])).toEqual([
      '舒張壓（低）比收縮壓（高）還高，可能填反了',
      '測量時機「早上」看不懂（請填：空腹、飯前、飯後2小時、睡前、隨機）',
      '部位「肛溫」看不懂（請填：耳溫、額溫、口溫、腋溫）',
    ]);
  });

  it('設定：722 時段、體溫預設部位', async () => {
    const { store } = setup();
    let s = await store.load();
    expect(s.settings.tempSite).toEqual({ 一般: '耳溫', 基礎: '口溫' });
    await store.saveBpPeriods({ morning: parseRange('05:00-10:00')!, evening: parseRange('19:00-23:30')! });
    await store.saveTempSite('一般', '額溫');
    await expect(store.saveBpPeriods({ morning: parseRange('05:00-10:00')!, evening: parseRange('09:00-23:00')! })).rejects.toThrow('重疊');
    s = await store.load();
    expect(s.settings.bpPeriods.morning).toEqual({ start: 300, end: 600 });
    expect(s.settings.bpPeriods.evening).toEqual({ start: 1140, end: 1410 });
    expect(s.settings.tempSite.一般).toBe('額溫');
  });
});
