import { describe, expect, it } from 'vitest';
import {
  editHash,
  HealthStore,
  healthEntries,
  LocalBackend,
  memoryStorage,
  parseDateTimeText,
  parseEditHash,
  sortEntries,
  WaterStore,
  waterEntries,
  waterSummary,
} from '../src';

const at = (s: string) => parseDateTimeText(s)!;

describe('一天的時間軸', () => {
  it('健康和喝水合在一起，依時間排；只列那一天', async () => {
    const b = new LocalBackend(memoryStorage());
    const health = new HealthStore(b);
    const water = new WaterStore(b);
    await health.load();
    await health.addBp({ systolic: 142, diastolic: 91, pulse: 75 }, at('2026-11-17 07:00'));
    await health.addGlucose({ timing: '空腹', mgdl: 92 }, at('2026-11-17 06:30'));
    await health.addBody({ kg: 55, bodyFatPct: 28 }, at('2026-11-17 06:48'), '早餐前');
    await health.addOcc([{ item: '腰圍', value: 70 }, { item: '臀圍', value: 92 }], at('2026-11-17 09:15'));
    await health.addTemp({ kind: '一般', site: '耳溫', celsius: 37.1 }, at('2026-11-16 20:00'));
    await water.addWeight(60, at('2026-11-15 07:00'));
    await water.addLog(250, at('2026-11-17 07:10'));
    await water.addLog(300, at('2026-11-17 09:30'), '咖啡');

    const hs = await health.load(at('2026-11-17 12:00'));
    const ws = await water.load(at('2026-11-17 12:00'));
    const list = sortEntries([...healthEntries(hs, '2026-11-17'), ...waterEntries(ws, '2026-11-17')]);
    expect(list.map((e) => `${e.name} ${e.value}`)).toEqual([
      '血糖 空腹 92 mg/dL',
      '體重 55.0 kg',
      '血壓 142/91 · 脈搏 75',
      '喝水 開水 250 ml',
      '身體尺寸 腰圍 70 cm、臀圍 92 cm',
      '喝水 咖啡 300 ml',
    ]);
    expect(list[1]).toMatchObject({ extra: '體脂肪 28.0%', note: '早餐前' });
    expect(list[2].judge?.label).toBe('高');
    expect(waterSummary(ws, '2026-11-17')).toEqual({ total: 550, goal: 1800 });
  });

  it('修改連結：#edit/種類/id', () => {
    const h = editHash({ app: 'health', kind: 'bp', id: 'abc123' });
    expect(h).toBe('#edit/bp/abc123');
    expect(parseEditHash(h)).toEqual({ kind: 'bp', id: 'abc123' });
    expect(parseEditHash('#edit/water/x1')).toEqual({ kind: 'water', id: 'x1' });
    expect(parseEditHash('#new')).toBeNull();
    expect(parseEditHash('#edit/unknown/x')).toBeNull();
  });
});
