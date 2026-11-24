import { describe, expect, it } from 'vitest';
import { CalendarStore, LocalBackend, memoryStorage, taiwanDayInfo } from '../src';

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
});
