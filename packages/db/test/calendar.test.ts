import { describe, expect, it } from 'vitest';
import { CalendarStore, LocalBackend, memoryStorage } from '../src';

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
  it('第一次使用建立一般群組；標題可空白並補成未命名行程', async () => {
    const b = new LocalBackend(memoryStorage());
    const s = new CalendarStore(b);
    let snap = await s.load();
    expect(snap.groups).toHaveLength(1);
    expect(snap.groups[0]).toMatchObject({ name: '一般', archived: false, hidden: false });
    await s.addEvent({ ...base(snap.defaultGroupId), title: '', startDate: '2026-11-20', endDate: '2026-11-20' }, 'E1');
    snap = await s.load();
    expect(snap.events[0]).toMatchObject({ id: 'E1', title: '未命名行程', titleMissing: true, timeType: 'allDay' });
  });

  it('試算表直接輸入會補系統欄位、群組、類型與時區', async () => {
    const b = new LocalBackend(memoryStorage());
    const s = new CalendarStore(b);
    await s.load();
    await b.appendRaw('calendarEvents', { title: '看醫生', startDate: '2026-12-01', startTime: '14:00' });
    const snap = await s.load(1000);
    expect(snap.events[0]).toMatchObject({ title: '看醫生', timeType: 'point', startDate: '2026-12-01', endDate: '2026-12-01', startTimeZone: 'Asia/Taipei' });
    expect(snap.events[0].id).toBeTruthy();
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
    expect((await all.load()).events.map((e) => e.status)).toEqual(['cancelled', 'cancelled']);

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
});
