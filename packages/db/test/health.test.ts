import { describe, expect, it } from 'vitest';
import {
  BODY_TIMINGS,
  bmiInfo,
  bodyTrendAverages,
  mismatchFields,
  pctKgMismatches,
  computeBmi,
  DEFAULT_BODY_FIELDS,
  HealthStore,
  heightAt,
  LocalBackend,
  memoryStorage,
  parseBodyFields,
  parseDateTimeText,
  WaterStore,
} from '../src';

const at = (s: string) => parseDateTimeText(s)!;
const setup = () => {
  const storage = memoryStorage();
  const b = new LocalBackend(storage);
  return { storage, b, store: new HealthStore(b) };
};

describe('BMI', () => {
  it('體重 ÷ 身高²，取到小數一位', () => {
    expect(computeBmi(55, 160)).toBe(21.5);
  });

  it('用那個時間點以前最新的身高；之前沒量過就用最早的一筆', async () => {
    const { store } = setup();
    await store.load();
    await store.addOcc([{ item: '身高', value: 160 }], at('2026-01-01 08:00'));
    await store.addOcc([{ item: '身高', value: 158 }], at('2026-06-01 08:00'));
    const s = await store.load();
    expect(heightAt(s, at('2025-12-01 08:00'))).toBe(160);
    expect(heightAt(s, at('2026-03-01 08:00'))).toBe(160);
    expect(heightAt(s, at('2026-07-01 08:00'))).toBe(158);
  });

  it('體重計 BMI 和自動算的差 ≥ 0.2 才提醒；確認不用改後不再提醒', async () => {
    const { store } = setup();
    await store.load();
    await store.addOcc([{ item: '身高', value: 160 }], at('2026-01-01 08:00'));
    await store.addBody({ kg: 55, bmiScale: 21.6 }, at('2026-11-16 07:00'));
    await store.addBody({ kg: 55, bmiScale: 21.8 }, at('2026-11-17 07:00'));
    let s = await store.load();
    expect(bmiInfo(s.body[0], s)).toMatchObject({ computed: 21.5, scale: 21.6, mismatch: false });
    expect(bmiInfo(s.body[1], s).mismatch).toBe(true);
    await store.updateBody(s.body[1], { bmiOk: true });
    s = await store.load();
    expect(bmiInfo(s.body[1], s).mismatch).toBe(false);
    // 改了體重計 BMI → 重新比對
    await store.updateBody(s.body[1], { bmiScale: 22.5 });
    s = await store.load();
    expect(bmiInfo(s.body[1], s).mismatch).toBe(true);
    // 只改備註、數值沒變（畫面儲存會把所有值一起送）→ 不用改的確認要保留
    await store.updateBody(s.body[1], { bmiOk: true });
    s = await store.load();
    await store.updateBody(s.body[1], { kg: 55, bmiScale: 22.5, note: '補備註' });
    s = await store.load();
    expect(bmiInfo(s.body[1], s).mismatch).toBe(false);
    // 改了體重 → 重新比對
    await store.updateBody(s.body[1], { kg: 56 });
    s = await store.load();
    expect(bmiInfo(s.body[1], s).mismatch).toBe(true);
  });

  it('體重 × % 和 kg 差 ≥ 0.3 kg 才提醒；體脂肪、骨骼肌各自確認', async () => {
    const { store } = setup();
    await store.load();
    // 55 × 28% = 15.4
    await store.addBody({ kg: 55, bodyFatPct: 28, bodyFatKg: 15.5, skeletalMusclePct: 25, skeletalMuscleKg: 13.8 }, at('2026-11-16 07:00'));
    await store.addBody({ kg: 55, bodyFatPct: 28, bodyFatKg: 18, skeletalMusclePct: 25, skeletalMuscleKg: 20 }, at('2026-11-17 07:00'));
    let s = await store.load();
    expect(pctKgMismatches(s.body[0])).toEqual([]);
    expect(pctKgMismatches(s.body[1]).map((x) => x.pair.key)).toEqual(['bodyFat', 'skeletalMuscle']);
    expect(pctKgMismatches(s.body[1])[0]).toMatchObject({ kgFromPct: 15.4, pctFromKg: 32.7 });
    expect(mismatchFields(s.body[1], s)).toEqual(['bodyFatPct', 'bodyFatKg', 'skeletalMusclePct', 'skeletalMuscleKg']);
    await store.updateBody(s.body[1], { bodyFatOk: true });
    await store.updateBody(s.body[1], { skeletalMuscleKg: 13.75 });
    s = await store.load();
    expect(pctKgMismatches(s.body[1])).toEqual([]);
    // 改了體脂肪 % → 重新比對
    await store.updateBody(s.body[1], { bodyFatPct: 27 });
    s = await store.load();
    expect(pctKgMismatches(s.body[1]).map((x) => x.pair.key)).toEqual(['bodyFat']);
  });
});

describe('HealthStore', () => {
  it('第一次使用建立預設項目（身高＋11 個圍度）', async () => {
    const { store } = setup();
    const s = await store.load();
    expect(s.items.map((i) => i.name)).toEqual([
      '身高', '胸圍', '上腹圍', '下腹圍', '腰圍', '臀圍', '右大腿', '左大腿', '右小腿', '左小腿', '右手臂', '左手臂',
    ]);
    expect(s.settings.bodyFields).toEqual(DEFAULT_BODY_FIELDS);
  });

  it('記身體量測，小數依項目整理；數值不合理擋下', async () => {
    const { store } = setup();
    await store.addBody({ kg: 55.24, bodyFatPct: 28.15, bodyAge: 40.4, bmrKcal: 1180 }, at('2026-11-17 07:00'));
    const s = await store.load();
    expect(s.body[0]).toMatchObject({ kg: 55.2, bodyFatPct: 28.2, bodyAge: 40, bmrKcal: 1180, date: '2026-11-17', timing: '起床後' });
    await expect(store.addBody({ kg: 55, bodyFatPct: 150 })).rejects.toThrow('體脂肪');
  });

  it('在試算表直接新增的列補上 id；格式錯誤的列入需要補齊', async () => {
    const { b, store } = setup();
    await store.load();
    await b.appendRaw('healthBodyMeasurements', { time: at('2026-11-17 07:00'), kg: 55 });
    await b.appendRaw('healthBodyMeasurements', { time: at('2026-11-17 08:00') });
    await b.appendRaw('healthOccasionalMeasurements', { time: at('2026-11-17 08:00'), item: '腰圍', value: 70 });
    await b.appendRaw('healthOccasionalMeasurements', { time: at('2026-11-17 08:00'), item: '頸圍', value: 30 });
    const s = await store.load();
    expect(s.body).toHaveLength(1);
    expect(s.body[0]).toMatchObject({ createdVia: 'sheet', date: '2026-11-17', timing: '起床後' });
    expect(s.occ.map((o) => o.item)).toEqual(['腰圍']);
    expect(s.issues.map((i) => i.problems[0])).toEqual(['沒有填體重', expect.stringContaining('頸圍')]);
  });

  it('項目改名，紀錄一起改；有紀錄的項目、身高不能刪', async () => {
    const { store } = setup();
    let s = await store.load();
    const waist = s.items.find((i) => i.name === '腰圍')!;
    await store.addOcc([{ item: '腰圍', value: 70 }], at('2026-11-17 08:00'));
    await store.updateItem(waist, { name: '腰' }, s.items);
    s = await store.load();
    expect(s.occ[0].item).toBe('腰');
    await expect(store.deleteItem(s.items.find((i) => i.name === '腰')!, s.occ)).rejects.toThrow('已經有紀錄');
    await expect(store.deleteItem(s.items[0], s.occ)).rejects.toThrow('身高');
  });

  it('顯示項目設定：體重一定要有、去掉重複和看不懂的', async () => {
    expect(parseBodyFields('bodyFatPct,xx,bodyFatPct,bmi')).toEqual(['kg', 'bodyFatPct', 'bmi']);
    const { store } = setup();
    await store.saveBodyFields(['bmi', 'kg']);
    expect((await store.load()).settings.bodyFields).toEqual(['bmi', 'kg']);
  });
});

describe('身體量測時段與趨勢', () => {
  it('新增與修改都可以選擇量測時段', async () => {
    const { store } = setup();
    await store.load();
    await store.addBody({ kg: 60 }, at('2026-11-01 07:00'), null, '起床後');
    await store.addBody({ kg: 62 }, at('2026-11-01 13:00'), null, '日間');
    await store.addBody({ kg: 59 }, at('2026-11-02 07:00'), null, '起床後');
    let s = await store.load();

    expect(s.body.map((m) => m.timing)).toEqual(['起床後', '日間', '起床後']);
    await store.updateBody(s.body[2], { timing: '日間' });
    s = await store.load();
    expect(s.body[2].timing).toBe('日間');
  });

  it('既有空白時段自動補成起床後，未知時段放入需要補齊', async () => {
    const { b, store } = setup();
    await store.load();
    await b.appendRaw('healthBodyMeasurements', { time: at('2026-11-17 07:00'), kg: 55 });
    await b.appendRaw('healthBodyMeasurements', { time: at('2026-11-17 22:00'), timing: '晚上', kg: 56 });
    const s = await store.load();

    expect(s.body).toHaveLength(1);
    expect(s.body[0].timing).toBe('起床後');
    expect(s.issues.some((issue) => issue.problems.some((problem) => problem.includes('量測時段')))).toBe(true);
  });

  it('週平均先算每日平均，只除以有資料的天數，並以星期日至星期六分週', () => {
    const points = [
      { time: at('2026-11-01 07:00'), date: '2026-11-01', timing: '起床後' as const, value: 60 },
      { time: at('2026-11-01 08:00'), date: '2026-11-01', timing: '起床後' as const, value: 62 },
      { time: at('2026-11-07 07:00'), date: '2026-11-07', timing: '起床後' as const, value: 59 },
      { time: at('2026-11-07 22:00'), date: '2026-11-07', timing: '睡前' as const, value: 63 },
      { time: at('2026-11-08 07:00'), date: '2026-11-08', timing: '起床後' as const, value: 58 },
    ];
    const result = bodyTrendAverages(points, 'week');

    expect(result).toEqual([
      expect.objectContaining({ startDate: '2026-11-01', endDate: '2026-11-07', timing: '起床後', value: 60, days: 2 }),
      expect.objectContaining({ startDate: '2026-11-01', endDate: '2026-11-07', timing: '睡前', value: 63, days: 1 }),
      expect.objectContaining({ startDate: '2026-11-08', endDate: '2026-11-14', timing: '起床後', value: 58, days: 1 }),
    ]);
  });

  it('月平均也只除以有資料的天數，且三種時段不混合', () => {
    const points = BODY_TIMINGS.flatMap((timing, index) => [
      { time: at('2026-11-01 07:00'), date: '2026-11-01', timing, value: 60 + index },
      { time: at('2026-11-20 07:00'), date: '2026-11-20', timing, value: 58 + index },
    ]);
    const result = bodyTrendAverages(points, 'month');

    expect(result.map(({ startDate, endDate, timing, value, days }) => ({ startDate, endDate, timing, value, days }))).toEqual([
      { startDate: '2026-11-01', endDate: '2026-11-30', timing: '起床後', value: 59, days: 2 },
      { startDate: '2026-11-01', endDate: '2026-11-30', timing: '日間', value: 60, days: 2 },
      { startDate: '2026-11-01', endDate: '2026-11-30', timing: '睡前', value: 61, days: 2 },
    ]);
  });
});

describe('舊的體重表改名', () => {
  it('healthWeights 的資料搬到身體量測，喝水 APP 也讀得到', async () => {
    const { storage, store } = setup();
    storage.setItem('life.local.healthWeights', JSON.stringify([{ time: at('2026-11-16 07:00'), kg: 60, id: 'OLD1', date: '2026-11-16' }]));
    const s = await store.load();
    expect(s.body.map((m) => m.kg)).toEqual([60]);
    const water = await new WaterStore(new LocalBackend(storage)).load(at('2026-11-17 08:00'));
    expect(water.weights.map((w) => w.kg)).toEqual([60]);
  });
});
