import { describe, expect, it } from 'vitest';
import {
  addSharedTag, bujoDayEntries, bujoMonthlyStats, bujoOccurrences, bujoTaskStatus,
  BujoStore, CalendarStore, expandCalendarEvents, LocalBackend, memoryStorage, parseDateTimeText, type CalendarEventInput,
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
      expect(bujoDayEntries(entries, `2026-11-${day}`, at('2026-11-21'))).toEqual({ open: [], completed: [], missed: [], cancelled: [] });
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

  it('下一筆到指定時間才出現；上一筆在同日凌晨已截止', async () => {
    const { store, through } = setup();
    await store.saveSchedule({ ...weekly, time: '10:30' }, undefined, false, at('2026-11-03'));
    const entries = await through('2026-11-11');
    const previous = entries[0];
    expect(bujoDayEntries(entries, '2026-11-04', at('2026-11-04', '10:29')).open).toHaveLength(0);
    expect(bujoDayEntries(entries, '2026-11-10', at('2026-11-10', '23:59')).open.map(({ id }) => id)).toEqual([previous.id]);
    expect(bujoDayEntries(entries, '2026-11-11', at('2026-11-11', '10:29')).open).toEqual([]);
    expect(bujoDayEntries(entries, '2026-11-11', at('2026-11-10')).open.map(({ startDate }) => startDate)).toEqual(['2026-11-11']);
    expect(bujoDayEntries(entries, '2026-11-04', at('2026-11-11')).missed).toEqual([previous]);
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

  it('自訂地點、共用機構和人物可儲存；舊版本的重複項目保留自己的關聯', async () => {
    const { backend, store, through } = setup();
    await backend.appendRaw('hubOrganizations', { name: '測試機構' });
    const calendar = new CalendarStore(backend);
    const person = await calendar.addPerson('測試人物');
    const org = (await store.load()).organizations[0].id;
    await store.saveTask({ ...fields, startDate: '2026-11-06', dueDate: '2026-11-06', organizationId: org, peopleIds: [person] });
    await store.saveSchedule({ ...weekly, place: '測試地點', peopleIds: [person] }, undefined, false, at('2026-11-03'));
    const [schedule] = (await store.load()).schedules;
    await store.saveSchedule({ ...weekly, organizationId: org }, schedule.seriesId, false, at('2026-11-05'));
    const entries = await through('2026-11-11');
    expect(entries.map(({ place, organizationId, peopleIds }) => [place, organizationId, peopleIds])).toEqual([
      ['測試地點', null, [person]], ['', org, [person]], ['', org, []],
    ]);
  });
});

async function calendarSetup(repeat = true) {
  const { backend, store, through } = setup();
  const cal = new CalendarStore(backend);
  const person = await cal.addPerson('同行測試');
  const groupId = (await cal.load()).defaultGroupId;
  const input: CalendarEventInput = {
    title: '測試行程', groupId, parentEventId: null, timeType: 'point',
    startDate: '2026-12-02', endDate: '2026-12-02', startTime: '23:58', endTime: null,
    startTimeZone: null, endTimeZone: null, timeMode: 'floatingLocal',
    locationType: 'place', startPlace: '測試機構', endPlace: null, url: null, note: null,
    status: 'scheduled', peopleIds: [person], bujoEnabled: true,
    recurrence: repeat ? { frequency: 'weekly', interval: 1, weekDays: [3], end: 'never' } : null,
  };
  const id = await cal.addEvent(input);
  const eventOf = async (day: string) => expandCalendarEvents(await cal.load(), day, day)
    .find((event) => event.startDate === day && event.title === input.title)!;
  return { store, through, cal, input, eventOf, person, id };
}

describe('行事曆連動待辦', () => {
  it('單次行程帶入地點及人物、改期跟隨、取消及恢復，刪除後保留已完成紀錄', async () => {
    const { store, through, cal, input, eventOf, person, id } = await calendarSetup(false);
    const original = await eventOf('2026-12-02');
    let [linked] = (await through('2026-12-10')).filter((entry) => entry.calendarStatus);
    expect(linked).toMatchObject({ id: `calendar:${id}`, place: '測試機構', peopleIds: [person], dueDate: '2026-12-02' });
    await cal.updateEvent(original, { ...input, startDate: '2026-12-03', endDate: '2026-12-03', startPlace: '新地點' });
    const moved = await eventOf('2026-12-03');
    await cal.cancelEvent(moved, false);
    [linked] = (await through('2026-12-10')).filter((entry) => entry.calendarStatus);
    expect(bujoTaskStatus(linked, at('2026-12-03'))).toBe('cancelled');
    await cal.restoreEvent(moved);
    [linked] = (await through('2026-12-10')).filter((entry) => entry.calendarStatus);
    expect(linked).toMatchObject({ startDate: '2026-12-03', place: '新地點', calendarStatus: 'scheduled' });
    await store.setCompletion(linked, '2026-12-03', await store.load(), at('2026-12-03', '12:00'));
    await cal.deleteEvent(moved);
    [linked] = await through('2026-12-10');
    expect(linked).toMatchObject({ id: `calendar:${id}`, completedDate: '2026-12-03', calendarStatus: 'unlinked' });
  });

  it('取消一週不延長上一週，也不算漏做；恢復後沿用同一筆', async () => {
    const { through, cal, eventOf } = await calendarSetup();
    const target = await eventOf('2026-12-09');
    const original = (await through('2026-12-16'))[1];
    await cal.setRecurringEventStatus(target, 'cancelled', 'single');
    const entries = await through('2026-12-16');
    expect(entries[0].expiresAt).toBe(at('2026-12-09'));
    expect(entries[1]).toMatchObject({ id: original.id, calendarStatus: 'cancelled' });
    expect(bujoDayEntries(entries, '2026-12-09', at('2026-12-10')).cancelled).toEqual([entries[1]]);
    expect(entries[2].calendarStatus).toBe('scheduled');
    expect(bujoMonthlyStats(entries, [], '2026-12', at('2026-12-10'))).toMatchObject([{ completed: 0, missed: 1 }]);
    const cancelled = await eventOf('2026-12-09');
    await cal.setRecurringEventStatus(cancelled, 'scheduled', 'single');
    expect((await through('2026-12-16'))[1]).toMatchObject({ id: original.id, calendarStatus: 'scheduled' });
  });

  it('分段改期保留同一組統計及已完成的發生項目；單次刪除移除舊項目', async () => {
    const { store, through, cal, eventOf } = await calendarSetup();
    const entry = (await through('2026-12-16'))[1];
    await store.setCompletion(entry, '2026-12-09', await store.load(), at('2026-12-09', '23:59'));
    const event = await eventOf('2026-12-09');
    await cal.updateRecurringEvent(event, {
      ...event, startDate: '2026-12-10', endDate: '2026-12-10',
      recurrence: { ...event.recurrence!, weekDays: [4] },
    }, 'future');
    let entries = await through('2026-12-17');
    expect(entries[0].expiresAt).toBe(at('2026-12-10'));
    expect(entries[1]).toMatchObject({ id: entry.id, startDate: '2026-12-10', completedDate: '2026-12-09', statDate: '2026-12-09' });
    expect(new Set(entries.map(({ seriesId }) => seriesId)).size).toBe(1);
    const next = await eventOf('2026-12-17');
    await cal.deleteRecurringEvent(next, 'single');
    entries = await through('2026-12-17');
    expect(entries.some(({ startDate }) => startDate === '2026-12-17')).toBe(false);
    expect(entries[1].expiresAt).toBe(at('2026-12-17'));
  });

  it('單次改期後取消，保留改期後的日期界線，不延長上一筆', async () => {
    const { through, cal, eventOf } = await calendarSetup();
    const next = await eventOf('2026-12-09');
    await cal.updateRecurringEvent(next, { ...next, startDate: '2026-12-08', endDate: '2026-12-08' }, 'single');
    await cal.setRecurringEventStatus(await eventOf('2026-12-08'), 'cancelled', 'single');
    const entries = await through('2026-12-09');
    expect(entries[0].expiresAt).toBe(at('2026-12-08'));
    expect(entries[1]).toMatchObject({ startDate: '2026-12-08', statDate: '2026-12-09', calendarStatus: 'cancelled' });
  });

  it('全部改期沿用發生項目的完成紀錄；之後取消與刪除只影響指定範圍', async () => {
    const { store, through, cal, eventOf } = await calendarSetup();
    const [completed] = await through('2026-12-09');
    await store.setCompletion(completed, '2026-12-02', await store.load(), at('2026-12-02', '23:59'));
    const first = await eventOf('2026-12-02');
    await cal.updateRecurringEvent(first, {
      ...first, startDate: '2026-12-03', endDate: '2026-12-03',
      recurrence: { ...first.recurrence!, weekDays: [4] },
    }, 'all');
    const future = await eventOf('2026-12-10');
    await cal.setRecurringEventStatus(future, 'cancelled', 'future');
    let entries = await through('2026-12-17');
    expect(entries.map(({ startDate, calendarStatus }) => [startDate, calendarStatus])).toEqual([
      ['2026-12-03', 'scheduled'], ['2026-12-10', 'cancelled'], ['2026-12-17', 'cancelled'],
    ]);
    expect(entries[0]).toMatchObject({ id: completed.id, completedDate: '2026-12-02', expiresAt: at('2026-12-10') });
    await cal.deleteRecurringEvent(await eventOf('2026-12-10'), 'all');
    entries = await through('2026-12-17');
    expect(entries).toHaveLength(1);
    expect(entries[0].completedDate).toBe('2026-12-02');
  });
});
