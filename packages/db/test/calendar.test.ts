import { describe, expect, it } from 'vitest';
import { calendarParentKey, CalendarStore, dueCalendarReminders, emptyForm, expandCalendarEvents, findCalendarParent, formToTxn, LocalBackend, memoryStorage, MoneyStore, taiwanDayInfo } from '../src';

const base = (groupId: string) => ({
  title: '台南旅遊',
  groupId,
  parentEventId: null,
  timeType: 'allDay' as const,
  startDate: '2026-11-21',
  startTime: null,
  startTimeZone: null,
  endDate: '2026-11-23',
  endTime: null,
  endTimeZone: null,
  timeMode: 'fixedZone' as const,
  locationType: 'place' as const,
  startPlace: '台南',
  endPlace: null,
  url: null,
  note: null,
  status: 'scheduled' as const,
});

describe('行事曆資料', () => {
  it('單日行程可加細項，重複行程的細項只屬於選定的那一次', async () => {
    const store = new CalendarStore(new LocalBackend(memoryStorage()));
    const { defaultGroupId } = await store.load();
    const day = '2026-11-25';
    const nextWeek = '2026-12-02';
    const work = { ...base(defaultGroupId), title: '上班', startDate: day, endDate: day,
      timeType: 'range' as const, startTime: '09:00', endTime: '18:00', timeMode: 'floatingLocal' as const };
    const meeting = { ...work, title: '部門會議', startTime: '14:00', endTime: '15:00' };
    await store.addEvent(work, 'ONE-DAY');
    await store.addEvent({ ...meeting, parentEventId: 'ONE-DAY' }, 'ONE-DAY-DETAIL');
    await store.addEvent({ ...work, recurrence: { frequency: 'weekly', interval: 1, weekDays: [3], end: 'count', count: 2 } }, 'WORK');
    const first = findCalendarParent(await store.load(), `repeat:WORK:${day}`)!;
    await store.addEvent({ ...meeting, parentEventId: calendarParentKey(first) }, 'WEEK-DETAIL');
    await store.updateRecurringEvent(first, { ...first, title: '本週上班' }, 'single');
    const snapshot = await store.load();
    const occurrences = expandCalendarEvents(snapshot, day, nextWeek).filter((event) => event.recurrenceParentId === 'WORK');
    const detail = snapshot.events.find((event) => event.id === 'WEEK-DETAIL')!;
    expect(occurrences.map((event) => event.startDate)).toEqual([day, nextWeek]);
    expect(occurrences.map((event) => calendarParentKey(event) === detail.parentEventId)).toEqual([true, false]);
    expect(findCalendarParent(snapshot, detail.parentEventId)?.title).toBe('本週上班');
    expect(snapshot.events.find((event) => event.id === 'ONE-DAY-DETAIL')?.parentEventId).toBe('ONE-DAY');
    await store.updateRecurringEvent(occurrences[0], { ...occurrences[0], title: '未來上班' }, 'future');
    const split = await store.load();
    const shiftedDetail = split.events.find((event) => event.id === detail.id)!;
    expect(shiftedDetail.parentEventId).not.toBe(detail.parentEventId);
    expect(findCalendarParent(split, shiftedDetail.parentEventId)?.startDate).toBe(day);
  });

  it('行事曆與記帳用同一份標籤 id，改名後兩邊仍保留關聯', async () => {
    const backend = new LocalBackend(memoryStorage());
    const calendar = new CalendarStore(backend);
    const money = new MoneyStore(backend);
    await backend.append('moneyAccounts', [{ name: '測試現金', type: '現金', currency: 'TWD' }]);
    await money.ensureCategories(['食 / 三餐'], '支出');
    const travel = await calendar.addTag('#旅遊');
    const food = await money.addTag('餐費');
    await expect(money.addTag('旅遊')).rejects.toThrow('已經有標籤');
    const { defaultGroupId } = await calendar.load();
    await calendar.addEvent({ ...base(defaultGroupId), tagIds: [travel, food, food] }, 'TRIP');
    await calendar.addEvent({ ...base(defaultGroupId), parentEventId: 'TRIP' }, 'CHILD');
    await money.saveTxn(formToTxn({
      ...emptyForm('支出'), account: '測試現金', cats: [{ category: '食 / 三餐', amount: 50 }], tagIds: [travel, food],
    }));
    const tag = (await backend.read('hubTags')).find((row) => row.values.id === travel)!;
    await backend.update('hubTags', [{ rowNumber: tag.rowNumber, expectId: travel, values: { name: '旅行', archived: true } }]);
    const [c, m] = await Promise.all([calendar.load(), money.load()]);
    expect(c.sharedTags).toEqual(m.sharedTags);
    expect(c.sharedTags.find((item) => item.id === travel)).toMatchObject({ name: '旅行', archived: true });
    expect(c.events.find((event) => event.id === 'TRIP')?.tagIds).toEqual([travel, food]);
    expect(c.events.find((event) => event.id === 'CHILD')?.tagIds).toEqual([travel, food]);
    expect(m.txns[0].tagIds).toEqual([travel, food]);
  });

  it('行事曆沿用共用人物的暱稱和 id，新增的人物也可供其他 APP 取得', async () => {
    const backend = new LocalBackend(memoryStorage());
    const s = new CalendarStore(backend);
    await backend.append('hubPeople', [{ name: '舊人物' }]);
    const { defaultGroupId, people } = await s.load();
    const old = people[0];
    expect(old).toMatchObject({ nickname: '舊人物', fullName: null });
    const id = await s.addPerson(' 朋友 ', ' 測試姓名 ');
    expect((await new MoneyStore(backend).load()).people.find((person) => person.id === id)?.name).toBe('朋友');
    await expect(s.addPerson('朋友')).rejects.toThrow('已經有暱稱');
    await s.addEvent({ ...base(defaultGroupId), peopleIds: [old.id, id, id] }, 'TRIP');
    const newRow = (await backend.read('hubPeople')).find((row) => row.values.id === id)!;
    await backend.update('hubPeople', [{ rowNumber: newRow.rowNumber, expectId: id, values: { name: '新暱稱', archived: true } }]);
    const snap = await s.load();
    expect(snap.events.find((e) => e.id === 'TRIP')?.peopleIds).toEqual([old.id, id]);
    expect(snap.people.find((person) => person.id === id)).toMatchObject({ nickname: '新暱稱', fullName: '測試姓名', archived: true });
  });

  it('新增細項預設帶入主行程人物，明確清空可保留空名單', async () => {
    const s = new CalendarStore(new LocalBackend(memoryStorage()));
    const { defaultGroupId } = await s.load();
    const personId = await s.addPerson('同行人');
    await s.addEvent({ ...base(defaultGroupId), peopleIds: [personId] }, 'PARENT');
    await s.addEvent({ ...base(defaultGroupId), parentEventId: 'PARENT' }, 'CHILD');
    await s.addEvent({ ...base(defaultGroupId), parentEventId: 'PARENT', peopleIds: [] }, 'EMPTY-CHILD');
    const snap = await s.load();
    expect(snap.events.find((event) => event.id === 'CHILD')?.peopleIds).toEqual([personId]);
    expect(snap.events.find((event) => event.id === 'EMPTY-CHILD')?.peopleIds).toEqual([]);
  });

  it('保存多個提醒，並按每次重複行程的時區計算到期時間及取消例外', async () => {
    const s = new CalendarStore(new LocalBackend(memoryStorage()));
    await s.setCurrentTimeZone('Asia/Taipei');
    const { defaultGroupId } = await s.load();
    await s.addEvent({
      ...base(defaultGroupId), title: '看診', timeType: 'point',
      startDate: '2026-11-26', endDate: '2026-11-26', startTime: '09:00', startTimeZone: 'Asia/Tokyo',
      recurrence: { frequency: 'daily', interval: 1, end: 'count', count: 2 },
      reminders: [{ kind: 'before', amount: 1, unit: 'days' }, { kind: 'before', amount: 30, unit: 'minutes' }],
    }, 'VISIT');
    let snap = await s.load();
    expect(snap.recurrenceMasters[0].reminders).toHaveLength(2);
    const dueAt = (time: string) => dueCalendarReminders(snap, Date.parse(time));
    expect(dueAt('2026-11-25T07:59:59+08:00')).toHaveLength(0);
    expect(dueAt('2026-11-25T08:00:00+08:00').map(({ time, event }) => [time, event.startDate])).toEqual([['08:00', '2026-11-26']]);
    expect(dueAt('2026-11-26T09:00:00+08:00').map(({ time, event }) => [time, event.startDate])).toEqual([['07:30', '2026-11-26'], ['08:00', '2026-11-27']]);
    const first = dueAt('2026-11-26T09:00:00+08:00')[0].event;
    await s.setRecurringEventStatus(first, 'cancelled', 'single');
    snap = await s.load();
    expect(dueAt('2026-11-26T09:00:00+08:00').map(({ event }) => event.startDate)).toEqual(['2026-11-27']);
  });

  it('全天指定提醒依主要時區，顯示到目前所在地當天結束', async () => {
    const s = new CalendarStore(new LocalBackend(memoryStorage()));
    await s.setHomeTimeZone('Asia/Taipei');
    await s.setCurrentTimeZone('Asia/Tokyo');
    const { defaultGroupId } = await s.load();
    await s.addEvent({
      ...base(defaultGroupId),
      reminders: [{ kind: 'custom', dayOffset: 1, time: '23:30' }],
    }, 'TRIP');
    const snap = await s.load();
    expect(dueCalendarReminders(snap, Date.parse('2026-11-23T00:30:00+09:00'))).toMatchObject([{ time: '00:30', event: { id: 'TRIP' } }]);
    expect(dueCalendarReminders(snap, Date.parse('2026-11-24T00:00:00+09:00'))).toEqual([]);
  });

  it('台灣辦公日以官方例外優先，舊年份與未公布年份只按週間推算', () => {
    expect(taiwanDayInfo('2025-02-08')).toMatchObject({ type: 'workday', source: 'official', title: '補班日' });
    expect(taiwanDayInfo('2026-10-09')).toMatchObject({ type: 'holiday', source: 'official', title: '國慶日補假' });
    expect(taiwanDayInfo('1983-01-01')).toMatchObject({ type: 'holiday', source: 'inferred', title: null });
    expect(taiwanDayInfo('2028-01-03')).toMatchObject({ type: 'workday', source: 'provisional', title: null });
  });

  it('第一次使用建立一般群組；標題可空白並補成未命名行程', async () => {
    const b = new LocalBackend(memoryStorage());
    const s = new CalendarStore(b);
    let snap = await s.load();
    expect(snap.groups).toHaveLength(2);
    expect(snap.groups.find((item) => item.name === '一般')).toMatchObject({ kind: 'user', archived: false, hidden: false });
    expect(snap.groups.find((item) => item.name === '台灣休假與補班')).toMatchObject({ kind: 'system', sourceType: 'taiwanOfficeCalendar' });
    await s.addEvent({ ...base(snap.defaultGroupId), title: '', startDate: '2026-11-20', endDate: '2026-11-20' }, 'E1');
    snap = await s.load();
    expect(snap.events.find((item) => item.id === 'E1')).toMatchObject({ id: 'E1', title: '未命名行程', titleMissing: true, timeType: 'allDay' });
  });

  it('試算表直接輸入會補系統欄位、群組、類型與時區', async () => {
    const b = new LocalBackend(memoryStorage());
    const s = new CalendarStore(b);
    await s.load();
    await b.appendRaw('calendarEvents', { title: '看醫生', startDate: '2026-12-01', startTime: '14:00' });
    const snap = await s.load(1000);
    const event = snap.events.find((item) => item.title === '看醫生');
    expect(event).toMatchObject({ title: '看醫生', timeType: 'point', startDate: '2026-12-01', endDate: '2026-12-01', startTimeZone: 'Asia/Taipei', startUtcOffset: '+08:00', timeZoneInferred: true });
    expect(event?.id).toBeTruthy();
  });

  it('浮動時間不保存時區；跨國交通則分開保存出發與抵達時區', async () => {
    const s = new CalendarStore(new LocalBackend(memoryStorage()));
    const group = (await s.load()).defaultGroupId;
    await s.addEvent({ ...base(group), title: '每天吃藥', timeType: 'point', startDate: '2026-12-10', endDate: '2026-12-10', startTime: '09:00', startTimeZone: 'Asia/Taipei', endTimeZone: 'Asia/Taipei', timeMode: 'floatingLocal' }, 'FLOAT');
    await s.addEvent({ ...base(group), title: '飛洛杉磯', timeType: 'range', startDate: '2026-12-11', endDate: '2026-12-11', startTime: '23:00', endTime: '18:00', startTimeZone: 'Asia/Taipei', endTimeZone: 'America/Los_Angeles', locationType: 'route' }, 'FLIGHT');
    const snap = await s.load();
    expect(snap.events.find((item) => item.id === 'FLOAT')).toMatchObject({ timeMode: 'floatingLocal', startTimeZone: null, endTimeZone: null, startUtcOffset: null, endUtcOffset: null });
    expect(snap.events.find((item) => item.id === 'FLIGHT')).toMatchObject({ startTimeZone: 'Asia/Taipei', startUtcOffset: '+08:00', endTimeZone: 'America/Los_Angeles', endUtcOffset: '-08:00' });
  });

  it('主要時區與目前所在地分開設定，確認裝置時區不會改既有主要時區', async () => {
    const s = new CalendarStore(new LocalBackend(memoryStorage()));
    await s.load();
    await s.setHomeTimeZone('Asia/Tokyo');
    await s.confirmDetectedTimeZone('America/New_York', true);
    const snap = await s.load();
    expect(snap).toMatchObject({ homeTimeZone: 'Asia/Tokyo', currentTimeZone: 'America/New_York', lastDetectedTimeZone: 'America/New_York' });
  });

  it('時間點只保存開始時間，結束日期自動等於開始日期', async () => {
    const b = new LocalBackend(memoryStorage());
    const s = new CalendarStore(b);
    const group = (await s.load()).defaultGroupId;
    await s.addEvent({ ...base(group), title: '搶預約', timeType: 'point', startDate: '2026-12-03', startTime: '00:00', endDate: '2026-12-08', endTime: '01:00', startTimeZone: 'Asia/Taipei', endTimeZone: 'Asia/Taipei' }, 'POINT');
    const event = (await s.load()).events.find((item) => item.id === 'POINT');
    expect(event).toMatchObject({ startDate: '2026-12-03', endDate: '2026-12-03', startTime: '00:00', endTime: null });
  });

  it('主行程可新增細項，整趟改期會依相同天數平移', async () => {
    const s = new CalendarStore(new LocalBackend(memoryStorage()));
    const group = (await s.load()).defaultGroupId;
    await s.addEvent(base(group), 'TRIP');
    await s.addEvent(
      { ...base(group), title: '坐高鐵', parentEventId: 'TRIP', timeType: 'range', startDate: '2026-11-21', endDate: '2026-11-21', startTime: '09:00', endTime: '11:00', startTimeZone: 'Asia/Taipei', endTimeZone: 'Asia/Taipei', locationType: 'route', startPlace: '台北', endPlace: '台南' },
      'TRAIN',
    );
    let snap = await s.load();
    const trip = snap.events.find((e) => e.id === 'TRIP')!;
    await s.updateTrip(trip, { ...base(group), startDate: '2026-11-28', endDate: '2026-11-30' }, 'together');
    snap = await s.load();
    expect(snap.events.find((e) => e.id === 'TRAIN')).toMatchObject({ startDate: '2026-11-28', endDate: '2026-11-28', startTime: '09:00' });
  });

  it('整趟改期跨過夏令時間邊界時會重算細項 UTC 位移', async () => {
    const s = new CalendarStore(new LocalBackend(memoryStorage()));
    const group = (await s.load()).defaultGroupId;
    await s.addEvent({ ...base(group), title: '紐約旅遊', startDate: '2026-03-07', endDate: '2026-03-09' }, 'NY-TRIP');
    await s.addEvent({ ...base(group), title: '早餐', parentEventId: 'NY-TRIP', timeType: 'range', startDate: '2026-03-07', endDate: '2026-03-07', startTime: '09:00', endTime: '10:00', startTimeZone: 'America/New_York', endTimeZone: 'America/New_York' }, 'NY-BREAKFAST');
    let snap = await s.load();
    expect(snap.events.find((item) => item.id === 'NY-BREAKFAST')?.startUtcOffset).toBe('-05:00');
    const trip = snap.events.find((item) => item.id === 'NY-TRIP')!;
    await s.updateTrip(trip, { ...base(group), title: '紐約旅遊', startDate: '2026-03-14', endDate: '2026-03-16' }, 'together');
    snap = await s.load();
    expect(snap.events.find((item) => item.id === 'NY-BREAKFAST')).toMatchObject({ startDate: '2026-03-14', startUtcOffset: '-04:00', endUtcOffset: '-04:00' });
  });

  it('取消整趟保留資料並取消細項；只取消主行程會解除細項', async () => {
    const make = async () => {
      const s = new CalendarStore(new LocalBackend(memoryStorage()));
      const group = (await s.load()).defaultGroupId;
      await s.addEvent(base(group), 'TRIP');
      await s.addEvent({ ...base(group), title: '景點', parentEventId: 'TRIP', startDate: '2026-11-22', endDate: '2026-11-22' }, 'SPOT');
      return s;
    };
    const all = await make();
    let trip = (await all.load()).events.find((e) => e.id === 'TRIP')!;
    await all.cancelEvent(trip, true);
    expect((await all.load()).events.filter((e) => !e.systemSource).map((e) => e.status)).toEqual(['cancelled', 'cancelled']);

    const only = await make();
    trip = (await only.load()).events.find((e) => e.id === 'TRIP')!;
    await only.cancelEvent(trip, false);
    const snap = await only.load();
    expect(snap.events.find((e) => e.id === 'TRIP')?.status).toBe('cancelled');
    expect(snap.events.find((e) => e.id === 'SPOT')).toMatchObject({ status: 'scheduled', parentEventId: null });
  });

  it('主行程仍有細項時不能刪除', async () => {
    const s = new CalendarStore(new LocalBackend(memoryStorage()));
    const group = (await s.load()).defaultGroupId;
    await s.addEvent(base(group), 'TRIP');
    await s.addEvent({ ...base(group), title: '景點', parentEventId: 'TRIP', startDate: '2026-11-22', endDate: '2026-11-22' }, 'SPOT');
    const trip = (await s.load()).events.find((e) => e.id === 'TRIP')!;
    await expect(s.deleteEvent(trip)).rejects.toThrow('先解除所有細項');
  });

  it('可先選主行程，但細項日期超出期間時不能儲存', async () => {
    const s = new CalendarStore(new LocalBackend(memoryStorage()));
    const group = (await s.load()).defaultGroupId;
    await s.addEvent(base(group), 'TRIP');
    await expect(s.addEvent({ ...base(group), title: '跨出旅程', parentEventId: 'TRIP', startDate: '2026-11-23', endDate: '2026-11-24' }, 'OUTSIDE')).rejects.toThrow('2026-11-21～2026-11-23');
  });

  it('可把既有行程加入主行程，並在加入時修正日期', async () => {
    const s = new CalendarStore(new LocalBackend(memoryStorage()));
    const group = (await s.load()).defaultGroupId;
    await s.addEvent(base(group), 'TRIP');
    await s.addEvent({ ...base(group), title: '先買車票', startDate: '2026-11-19', endDate: '2026-11-19' }, 'TICKET');
    let snap = await s.load();
    const trip = snap.events.find((item) => item.id === 'TRIP')!;
    const ticket = snap.events.find((item) => item.id === 'TICKET')!;
    await expect(s.attachEventsToTrip(trip, [{ event: ticket, startDate: '2026-11-19', endDate: '2026-11-19' }])).rejects.toThrow('2026-11-21～2026-11-23');
    await s.attachEventsToTrip(trip, [{ event: ticket, startDate: '2026-11-21', endDate: '2026-11-21' }]);
    snap = await s.load();
    expect(snap.events.find((item) => item.id === 'TICKET')).toMatchObject({ parentEventId: 'TRIP', startDate: '2026-11-21', endDate: '2026-11-21' });
  });

  it('細項可移到日期完整包含它的另一個主行程，只改關聯', async () => {
    const s = new CalendarStore(new LocalBackend(memoryStorage()));
    const group = (await s.load()).defaultGroupId;
    await s.addEvent(base(group), 'TRIP1');
    await s.addEvent({ ...base(group), title: '另一趟旅遊', startDate: '2026-11-20', endDate: '2026-11-25' }, 'TRIP2');
    await s.addEvent({ ...base(group), title: '景點', parentEventId: 'TRIP1', startDate: '2026-11-22', endDate: '2026-11-22' }, 'SPOT');
    let snap = await s.load();
    await s.moveEventToTrip(snap.events.find((item) => item.id === 'SPOT')!, 'TRIP2');
    snap = await s.load();
    expect(snap.events.find((item) => item.id === 'SPOT')).toMatchObject({ parentEventId: 'TRIP2', startDate: '2026-11-22', title: '景點' });
  });

  it('台灣官方特殊日期會成為唯讀系統行程；一般週末不建立行程', async () => {
    const s = new CalendarStore(new LocalBackend(memoryStorage()));
    const snap = await s.load();
    expect(snap.events.find((item) => item.startDate === '2026-10-09')).toMatchObject({ title: '國慶日補假', systemSource: 'taiwanOfficeCalendar' });
    expect(snap.events.find((item) => item.startDate === '2025-02-08')).toMatchObject({ title: '補班日', systemSource: 'taiwanOfficeCalendar' });
    expect(snap.events.some((item) => item.startDate === '2026-11-22')).toBe(false);
  });

  it('重複主規則只存一列，畫面需要時才展開發生項目', async () => {
    const s = new CalendarStore(new LocalBackend(memoryStorage()));
    const group = (await s.load()).defaultGroupId;
    await s.addEvent({ ...base(group), title: '瑜珈', startDate: '2026-11-23', endDate: '2026-11-23', recurrence: { frequency: 'weekly', interval: 1, weekDays: [1, 3], end: 'count', count: 4 } }, 'REPEAT');
    const snap = await s.load();
    expect(snap.recurrenceMasters).toHaveLength(1);
    expect(snap.events.some((item) => item.id === 'REPEAT')).toBe(false);
    expect(expandCalendarEvents(snap, '2026-11-23', '2026-12-10').filter((item) => item.recurrenceParentId === 'REPEAT').map((item) => item.startDate)).toEqual(['2026-11-23', '2026-11-25', '2026-11-30', '2026-12-02']);
  });

  it('作為細項的行程本身不能重複', async () => {
    const s = new CalendarStore(new LocalBackend(memoryStorage()));
    const group = (await s.load()).defaultGroupId;
    await s.addEvent(base(group), 'TRIP');
    await expect(s.addEvent({ ...base(group), parentEventId: 'TRIP', startDate: '2026-11-22', endDate: '2026-11-22', recurrence: { frequency: 'daily', interval: 1, end: 'never' } }, 'INVALID')).rejects.toThrow('細項不能設為重複行程');
  });

  it('重複固定時間遇到夏令時間不存在的那次會略過', async () => {
    const s = new CalendarStore(new LocalBackend(memoryStorage()));
    const group = (await s.load()).defaultGroupId;
    await s.addEvent({ ...base(group), title: '半夜工作', timeType: 'point', startDate: '2026-03-07', endDate: '2026-03-07', startTime: '02:30', startTimeZone: 'America/New_York', endTimeZone: 'America/New_York', recurrence: { frequency: 'daily', interval: 1, end: 'count', count: 3 } }, 'DST');
    const snap = await s.load();
    expect(expandCalendarEvents(snap, '2026-03-07', '2026-03-10').filter((item) => item.recurrenceParentId === 'DST').map((item) => item.startDate)).toEqual(['2026-03-07', '2026-03-09']);
  });

  it('可只修改或取消一次重複行程，其他次維持原規則', async () => {
    const s = new CalendarStore(new LocalBackend(memoryStorage()));
    const group = (await s.load()).defaultGroupId;
    await s.addEvent({ ...base(group), title: '復健', startDate: '2026-12-01', endDate: '2026-12-01', recurrence: { frequency: 'daily', interval: 1, end: 'count', count: 3 } }, 'THERAPY');
    let snap = await s.load();
    let rows = expandCalendarEvents(snap, '2026-12-01', '2026-12-03').filter((item) => item.recurrenceParentId === 'THERAPY');
    await s.updateRecurringEvent(rows[1], { ...rows[1], title: '改到下午復健' }, 'single');
    snap = await s.load();
    rows = expandCalendarEvents(snap, '2026-12-01', '2026-12-03').filter((item) => item.recurrenceParentId === 'THERAPY');
    expect(rows.map((item) => item.title)).toEqual(['復健', '改到下午復健', '復健']);
    await s.setRecurringEventStatus(rows[2], 'cancelled', 'single');
    snap = await s.load();
    rows = expandCalendarEvents(snap, '2026-12-01', '2026-12-03').filter((item) => item.recurrenceParentId === 'THERAPY');
    expect(rows.map((item) => item.status)).toEqual(['scheduled', 'scheduled', 'cancelled']);
  });

  it('修改這次及之後會把規則切成前後兩段', async () => {
    const s = new CalendarStore(new LocalBackend(memoryStorage()));
    const group = (await s.load()).defaultGroupId;
    await s.addEvent({ ...base(group), title: '課程', startDate: '2026-12-01', endDate: '2026-12-01', recurrence: { frequency: 'daily', interval: 1, end: 'count', count: 5 } }, 'CLASS');
    let snap = await s.load();
    let rows = expandCalendarEvents(snap, '2026-12-01', '2026-12-05').filter((item) => item.recurrenceParentId);
    await s.updateRecurringEvent(rows[2], { ...rows[2], title: '新課程' }, 'future');
    snap = await s.load();
    rows = expandCalendarEvents(snap, '2026-12-01', '2026-12-05').filter((item) => item.title === '課程' || item.title === '新課程');
    expect(rows.map((item) => item.title)).toEqual(['課程', '課程', '新課程', '新課程', '新課程']);
    expect(snap.recurrenceMasters).toHaveLength(2);
  });

  it('修改全部會保留同一套規則，並套用到每一次', async () => {
    const s = new CalendarStore(new LocalBackend(memoryStorage()));
    const group = (await s.load()).defaultGroupId;
    await s.addEvent({ ...base(group), title: '晨間散步', startDate: '2026-12-01', endDate: '2026-12-01', recurrence: { frequency: 'daily', interval: 1, end: 'count', count: 3 } }, 'WALK');
    let snap = await s.load();
    const selected = expandCalendarEvents(snap, '2026-12-01', '2026-12-03').find((item) => item.startDate === '2026-12-02' && item.recurrenceParentId === 'WALK')!;
    await s.updateRecurringEvent(selected, { ...selected, title: '晚間散步' }, 'all');
    snap = await s.load();
    const rows = expandCalendarEvents(snap, '2026-12-01', '2026-12-03').filter((item) => item.recurrenceParentId === 'WALK');
    expect(rows.map((item) => item.title)).toEqual(['晚間散步', '晚間散步', '晚間散步']);
    expect(snap.recurrenceMasters).toHaveLength(1);
  });

  it('刪除這次及之後會保留先前項目；刪除全部會移除整套規則', async () => {
    const s = new CalendarStore(new LocalBackend(memoryStorage()));
    const group = (await s.load()).defaultGroupId;
    await s.addEvent({ ...base(group), title: '每日記錄', startDate: '2026-12-01', endDate: '2026-12-01', recurrence: { frequency: 'daily', interval: 1, end: 'count', count: 5 } }, 'LOG');
    let snap = await s.load();
    let rows = expandCalendarEvents(snap, '2026-12-01', '2026-12-05').filter((item) => item.recurrenceParentId === 'LOG');
    await s.deleteRecurringEvent(rows[2], 'future');
    snap = await s.load();
    rows = expandCalendarEvents(snap, '2026-12-01', '2026-12-05').filter((item) => item.recurrenceParentId === 'LOG');
    expect(rows.map((item) => item.startDate)).toEqual(['2026-12-01', '2026-12-02']);

    await s.deleteRecurringEvent(rows[0], 'all');
    snap = await s.load();
    expect(snap.recurrenceMasters).toHaveLength(0);
    expect(expandCalendarEvents(snap, '2026-12-01', '2026-12-05').some((item) => item.title === '每日記錄')).toBe(false);
  });
});
