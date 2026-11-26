import { describe, expect, it } from 'vitest';
import {
  addSharedTag, bujoDayEntries, bujoMonthlyStats, bujoOccurrences, bujoTaskStatus,
  BujoStore, LocalBackend, memoryStorage, parseDateTimeText,
} from '../src';

const at = (date: string, time = '00:00') => parseDateTimeText(`${date} ${time}`)!;
const fields = { title: '測試待辦', note: '', tagIds: [] };
const weekly = { ...fields, weekday: 3, time: '00:00' };

function setup() {
  const backend = new LocalBackend(memoryStorage());
  const store = new BujoStore(backend);
  const through = async (day: string) => bujoOccurrences(await store.load(), day);
  return { backend, store, through };
}

describe('子彈筆記', () => {
  it('一般待辦日期含首尾，提前完成只顯示在實際完成日，取消後恢復', async () => {
    const { store, through } = setup();
    await store.saveTask({ ...fields, startDate: '2026-11-17', dueDate: '2026-11-23' });
    let [task] = await through('2026-11-24');
    expect(bujoTaskStatus(task, at('2026-11-16', '23:59'))).toBe('upcoming');
    expect(bujoTaskStatus(task, at('2026-11-17'))).toBe('open');
    expect(bujoTaskStatus(task, at('2026-11-23', '23:59'))).toBe('open');
    expect(bujoTaskStatus(task, at('2026-11-24'))).toBe('missed');
    await store.setCompletion(task, '2026-11-20', await store.load(), at('2026-11-20'));
    let entries = await through('2026-11-24');
    expect(bujoDayEntries(entries, '2026-11-20', at('2026-11-21')).completed).toHaveLength(1);
    for (const day of ['21', '22', '23']) {
      expect(bujoDayEntries(entries, `2026-11-${day}`, at('2026-11-21'))).toEqual({ open: [], completed: [], missed: [] });
    }
    [task] = entries;
    await store.setCompletion(task, null, await store.load(), at('2026-11-21'));
    entries = await through('2026-11-24');
    expect(bujoDayEntries(entries, '2026-11-23', at('2026-11-24')).missed).toHaveLength(1);
  });

  it('漏做之後可補登實際完成日並只顯示在完成當天', async () => {
    const { store, through } = setup();
    await store.saveTask({ ...fields, startDate: '2026-12-12', dueDate: '2026-12-18' });
    const [task] = await through('2026-12-20');
    const now = at('2026-12-20');
    await expect(store.setCompletion(task, '2026-12-21', await store.load(), now)).rejects.toThrow('完成日');
    await store.setCompletion(task, '2026-12-16', await store.load(), now);
    const entries = await through('2026-12-20');
    expect(bujoDayEntries(entries, '2026-12-16', now).completed).toHaveLength(1);
    expect(bujoDayEntries(entries, '2026-12-18', now).missed).toHaveLength(0);
  });

  it('每週各次獨立，下一筆到指定時間才出現，上一筆同時列漏做', async () => {
    const { store, through } = setup();
    await store.saveSchedule({ ...weekly, time: '10:30' }, undefined, false, at('2026-11-03'));
    const entries = await through('2026-11-11');
    const previous = entries[0];
    expect(bujoDayEntries(entries, '2026-11-04', at('2026-11-04', '10:29')).open).toHaveLength(0);
    expect(bujoDayEntries(entries, '2026-11-11', at('2026-11-11', '10:29')).open.map(({ id }) => id)).toEqual([previous.id]);
    const day = bujoDayEntries(entries, '2026-11-11', at('2026-11-11', '10:30'));
    expect(day.open.map(({ startDate }) => startDate)).toEqual(['2026-11-11']);
    expect(bujoDayEntries(entries, '2026-11-04', at('2026-11-11', '10:30')).missed).toEqual([previous]);
  });

  it('修改星期和標籤只影響後續，原待辦保留到新排程出現', async () => {
    const { backend, store, through } = setup();
    const first = await addSharedTag(backend, '第一個標籤');
    const second = await addSharedTag(backend, '第二個標籤');
    await store.saveSchedule({ ...weekly, tagIds: [first] }, undefined, false, at('2026-11-03'));
    const [schedule] = (await store.load()).schedules;
    await store.saveSchedule({ ...weekly, weekday: 5, tagIds: [second] }, schedule.seriesId, false, at('2026-11-05'));
    const entries = await through('2026-11-13');
    expect(entries.map(({ startDate, tagIds }) => [startDate, tagIds])).toEqual([
      ['2026-11-04', [first]], ['2026-11-06', [second]], ['2026-11-13', [second]],
    ]);
    expect(entries[0].expiresAt).toBe(at('2026-11-06'));
    expect(entries.map(({ seriesId }) => seriesId)).toEqual(Array(3).fill(schedule.seriesId));
  });

  it('新排程晚於原期限時保留當次，但停用時維持原期限', async () => {
    const { store, through } = setup();
    await store.saveSchedule(weekly, undefined, false, at('2026-11-03'));
    const [schedule] = (await store.load()).schedules;
    const friday = { ...weekly, weekday: 5 };
    await store.saveSchedule(friday, schedule.seriesId, false, at('2026-11-06', '11:00'));
    let [previous] = await through('2026-11-06');
    expect(previous.expiresAt).toBe(at('2026-11-13'));
    await store.saveSchedule(friday, schedule.seriesId, true, at('2026-11-07'));
    [previous] = await through('2026-11-24');
    expect(previous.expiresAt).toBe(at('2026-11-11'));
    expect(await through('2026-11-24')).toHaveLength(1);
  });

  it('重複待辦依原訂出現月份統計，補登後由漏做轉為完成', async () => {
    const { store } = setup();
    await store.saveSchedule(weekly, undefined, false, at('2026-11-24'));
    const now = at('2026-12-03');
    let snap = await store.load(), entries = bujoOccurrences(snap, '2026-12-03');
    expect(bujoMonthlyStats(entries, snap.schedules, '2026-11', now)).toMatchObject([{ completed: 0, missed: 1 }]);
    expect(bujoMonthlyStats(entries, snap.schedules, '2026-12', now)).toMatchObject([{ completed: 0, missed: 0 }]);
    await store.setCompletion(entries[0], '2026-12-01', snap, now);
    snap = await store.load();
    entries = bujoOccurrences(snap, '2026-12-03');
    expect(bujoMonthlyStats(entries, snap.schedules, '2026-11', now)).toMatchObject([{ completed: 1, missed: 0 }]);
    expect(bujoDayEntries(entries, '2026-12-01', now).completed).toHaveLength(1);
    await store.setCompletion(entries[0], null, snap, now);
    expect((await store.load()).completions).toHaveLength(1);
  });

  it('試算表直接新增一般待辦會補編號；錯誤區間標示，刪除保留原列', async () => {
    const { backend, store } = setup();
    await backend.appendRaw('bujoTasks', { title: '直接新增', startDate: '2026-11-17', dueDate: '2026-11-17' });
    await backend.appendRaw('bujoTasks', { title: '填反', startDate: '2026-11-18', dueDate: '2026-11-17' });
    const snap = await store.load();
    expect(snap.issues).toHaveLength(1);
    expect(snap.tasks).toHaveLength(1);
    expect(snap.tasks[0].id).toBeTruthy();
    await store.deleteTask(snap.tasks[0]);
    expect((await store.load()).tasks).toHaveLength(0);
    expect(await backend.read('bujoTasks')).toHaveLength(2);
  });
});
