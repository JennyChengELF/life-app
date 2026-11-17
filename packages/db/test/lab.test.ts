import { describe, expect, it } from 'vitest';
import type { LabItem } from '../src';
import { HBA1C_CODE, HealthStore, healthEntries, judgeLab, LocalBackend, memoryStorage, parseEditHash, rangeOf, sortEntries } from '../src';

const setup = () => {
  const b = new LocalBackend(memoryStorage());
  return { b, store: new HealthStore(b) };
};

describe('健檢：顏色標示', () => {
  const num = (p: Partial<LabItem>): LabItem => ({
    rowNumber: 2, id: 'i', name: 'x', unit: '', type: '數字', refLow: null, refHigh: null, redLow: null, redHigh: null,
    options: [], warnOptions: [], badOptions: [], sort: 0, code: null, ...p,
  });
  const r = (value: number | null, refLow: number | null = null, refHigh: number | null = null, text: string | null = null) => ({ value, text, refLow, refHigh });

  it('報告上印的範圍優先，沒有才用項目預設', () => {
    const glu = num({ refLow: 70, refHigh: 99, redHigh: 126 });
    expect(judgeLab(r(95), glu)?.label).toBe('正常');
    expect(judgeLab(r(105), glu)?.label).toBe('偏高');
    expect(judgeLab(r(126), glu)).toEqual({ level: 'bad', label: '高' });
    expect(judgeLab(r(65), glu)?.label).toBe('偏低');
    // 報告印 70–110：105 正常
    expect(judgeLab(r(105, 70, 110), glu)?.label).toBe('正常');
    expect(rangeOf(r(105, 70, 110), glu)).toEqual({ low: 70, high: 110, fromReport: true });
    // 只有一邊
    expect(judgeLab(r(35), num({ refLow: 40 }))?.label).toBe('偏低');
    // 沒有範圍 → 不標
    expect(judgeLab(r(5), num({}))).toBeNull();
  });

  it('文字項目：異常（紅）、注意（黃）', () => {
    const urine = num({ type: '文字', options: ['−', '±', '+', '++'], warnOptions: ['±'], badOptions: ['+', '++'] });
    expect(judgeLab(r(null, null, null, '−'), urine)?.level).toBe('ok');
    expect(judgeLab(r(null, null, null, '±'), urine)).toEqual({ level: 'warn', label: '注意' });
    expect(judgeLab(r(null, null, null, '++'), urine)).toEqual({ level: 'bad', label: '異常' });
  });
});

describe('HealthStore：健檢', () => {
  it('第一次使用建立預設檢驗項目（含 HbA1c）', async () => {
    const { store } = setup();
    const s = await store.load();
    expect(s.labItems.length).toBeGreaterThan(20);
    expect(s.labItems.find((i) => i.code === HBA1C_CODE)?.name).toBe('糖化血色素 HbA1c');
    expect(s.labItems.find((i) => i.name === '尿蛋白')).toMatchObject({ type: '文字', badOptions: ['+', '++', '+++', '++++'] });
    // 第二次讀取不會重複建立
    expect((await store.load()).labItems.length).toBe(s.labItems.length);
  });

  it('新增報告（沒填結果的項目不存）、修改（改、加、刪）、刪除', async () => {
    const { store } = setup();
    let s = await store.load();
    const id = await store.saveLabReport(
      { date: '2026-10-01', kind: '健檢', place: '某醫院', note: null },
      [
        { item: '空腹血糖', value: 105, text: null, refLow: 70, refHigh: 100 },
        { item: '總膽固醇', value: 210, text: null, refLow: null, refHigh: null },
        { item: '尿蛋白', value: null, text: '±', refLow: null, refHigh: null },
        { item: '尿酸', value: null, text: null, refLow: null, refHigh: null },
      ],
      s.labItems,
    );
    s = await store.load();
    expect(s.labReports).toMatchObject([{ id, date: '2026-10-01', kind: '健檢', place: '某醫院' }]);
    expect(s.labResults.map((r) => [r.item, r.value ?? r.text])).toEqual([
      ['空腹血糖', 105],
      ['總膽固醇', 210],
      ['尿蛋白', '±'],
    ]);

    // 時間軸：一列、整天的、排最前面
    const tl = sortEntries(healthEntries(s, '2026-10-01'));
    expect(tl[0]).toMatchObject({ allDay: true, name: '健檢 某醫院', value: '3 項', judge: { level: 'warn', label: '3 項異常' } });
    expect(parseEditHash('#edit/lab/' + id)).toEqual({ kind: 'lab', id });

    // 修改：改血糖、刪膽固醇、加 HbA1c
    const report = s.labReports[0];
    const results = s.labResults;
    await store.saveLabReport(
      { date: '2026-10-02', kind: '健檢', place: '某醫院', note: '跨日' },
      [
        { id: results[0].id, item: '空腹血糖', value: 95, text: null, refLow: 70, refHigh: 100 },
        { id: results[2].id, item: '尿蛋白', value: null, text: '−', refLow: null, refHigh: null },
        { item: '糖化血色素 HbA1c', value: 5.4, text: null, refLow: null, refHigh: null },
      ],
      s.labItems,
      { report, results },
    );
    s = await store.load();
    expect(s.labReports[0]).toMatchObject({ date: '2026-10-02', note: '跨日' });
    expect(s.labResults.map((r) => [r.item, r.value ?? r.text])).toEqual([
      ['空腹血糖', 95],
      ['尿蛋白', '−'],
      ['糖化血色素 HbA1c', 5.4],
    ]);

    await store.deleteLabReport(s.labReports[0], s.labResults);
    s = await store.load();
    expect(s.labReports).toEqual([]);
    expect(s.labResults).toEqual([]);
  });

  it('輸入檢查：沒有結果、重複項目、範圍上下顛倒', async () => {
    const { store } = setup();
    const s = await store.load();
    const rep = { date: '2026-10-01', kind: '健檢' as const, place: null, note: null };
    await expect(store.saveLabReport(rep, [{ item: '尿酸', value: null, text: null, refLow: null, refHigh: null }], s.labItems)).rejects.toThrow('至少');
    const dup = { item: '尿酸', value: 5, text: null, refLow: null, refHigh: null };
    await expect(store.saveLabReport(rep, [dup, dup], s.labItems)).rejects.toThrow('重複');
    await expect(store.saveLabReport(rep, [{ ...dup, refLow: 9, refHigh: 3 }], s.labItems)).rejects.toThrow('下限');
  });

  it('項目改名時結果一起改；有結果或內建的項目不能刪', async () => {
    const { store } = setup();
    let s = await store.load();
    await store.saveLabReport({ date: '2026-10-01', kind: '門診檢驗', place: null, note: null }, [{ item: '尿酸', value: 6, text: null, refLow: null, refHigh: null }], s.labItems);
    s = await store.load();
    const uric = s.labItems.find((i) => i.name === '尿酸')!;
    await store.updateLabItem(uric, { ...uric, name: '尿酸 UA' }, s.labItems);
    s = await store.load();
    expect(s.labResults[0].item).toBe('尿酸 UA');
    await expect(store.deleteLabItem(s.labItems.find((i) => i.name === '尿酸 UA')!, s.labResults)).rejects.toThrow('已經有');
    await expect(store.deleteLabItem(s.labItems.find((i) => i.code === HBA1C_CODE)!, s.labResults)).rejects.toThrow('內建');
    await store.addLabItem({ name: '維生素D', unit: 'ng/mL', type: '數字', refLow: 30, refHigh: 100, redLow: null, redHigh: null, options: [], warnOptions: [], badOptions: [] }, s.labItems);
    s = await store.load();
    const vd = s.labItems.find((i) => i.name === '維生素D')!;
    expect(vd).toMatchObject({ unit: 'ng/mL', refLow: 30 });
    await store.deleteLabItem(vd, s.labResults);
    expect((await store.load()).labItems.some((i) => i.name === '維生素D')).toBe(false);
  });

  it('在試算表直接新增的列：補 id；報告或項目對不到的列入需要補齊', async () => {
    const { b, store } = setup();
    await store.load();
    await b.appendRaw('healthLabReports', { date: '2026-09-11', place: '診所' });
    let s = await store.load();
    const rep = s.labReports[0];
    expect(rep).toMatchObject({ kind: '健檢', place: '診所' });
    expect(rep.id).toBeTruthy();
    await b.appendRaw('healthLabResults', { reportId: rep.id, item: '尿酸', value: 6.2 });
    await b.appendRaw('healthLabResults', { reportId: 'nope', item: '尿酸', value: 6.2 });
    await b.appendRaw('healthLabResults', { reportId: rep.id, item: '不存在的項目', value: 1 });
    s = await store.load();
    expect(s.labResults).toHaveLength(1);
    expect(s.issues.map((i) => i.problems[0])).toEqual(['找不到報告「nope」', '項目「不存在的項目」不在檢驗項目清單裡（請先在 APP 新增，或改成清單裡的名稱）']);
  });
});
