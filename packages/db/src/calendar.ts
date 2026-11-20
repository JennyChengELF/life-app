/**
 * 行事曆資料與規則。
 * 2026-11-19 使用者決定：待辦不進行事曆；旅遊可用主行程＋獨立細項。
 */
import type { Backend, RowUpdate, RowValues, TableRow } from './backend';
import { newId } from './ids';

export const DEFAULT_CALENDAR_TIME_ZONE = 'Asia/Taipei';
export const DEFAULT_CALENDAR_COLOR = '#1f6fd1';
const DEFAULT_GROUP_KEY = 'calendar.defaultGroupId';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export type CalendarTimeType = 'range' | 'point' | 'allDay';
export type CalendarTimeMode = 'fixedZone' | 'floatingLocal';
export type CalendarEventStatus = 'scheduled' | 'cancelled';
export type CalendarLocationType = 'place' | 'route' | 'online' | null;

export interface CalendarGroup {
  rowNumber: number;
  id: string;
  name: string;
  color: string;
  kind: 'user' | 'system';
  sourceType: string | null;
  sort: number;
  hidden: boolean;
  archived: boolean;
}

export interface CalendarEventInput {
  title: string;
  groupId: string;
  parentEventId: string | null;
  timeType: CalendarTimeType;
  startDate: string;
  startTime: string | null;
  startTimeZone: string | null;
  endDate: string;
  endTime: string | null;
  endTimeZone: string | null;
  timeMode: CalendarTimeMode;
  locationType: CalendarLocationType;
  startPlace: string | null;
  endPlace: string | null;
  url: string | null;
  note: string | null;
  status: CalendarEventStatus;
}

export interface CalendarEvent extends CalendarEventInput {
  rowNumber: number;
  id: string;
  createdVia: string;
  createdAt: number;
  updatedAt: number;
  /** 原始標題空白；畫面顯示「未命名行程」，並提醒之後補齊 */
  titleMissing: boolean;
}

export interface CalendarIssue {
  table: 'calendarGroups' | 'calendarEvents';
  rowNumber: number;
  text: string;
}

export interface CalendarSnapshot {
  loadedAt: number;
  groups: CalendarGroup[];
  events: CalendarEvent[];
  defaultGroupId: string;
  issues: CalendarIssue[];
}

export interface TripChildAction {
  event: Pick<CalendarEvent, 'rowNumber' | 'id'>;
  action: 'move' | 'detach' | 'cancel';
  /** action = move 時的新日期 */
  startDate?: string;
  endDate?: string;
}

const str = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || fallback);
const bool = (v: unknown) => v === true || String(v).toLowerCase() === 'true';
const deleted = (r: TableRow) => r.values.deletedAt != null;

export function addDateDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + days));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
}

export function dateDiffDays(from: string, to: string): number {
  const ms = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(to) - ms(from)) / 86400000);
}

export function dateInRange(date: string, start: string, end: string) {
  return date >= start && date <= end;
}

export function eventOnDate(e: Pick<CalendarEvent, 'startDate' | 'endDate'>, date: string) {
  return dateInRange(date, e.startDate, e.endDate);
}

export function sortCalendarEvents<T extends Pick<CalendarEvent, 'startDate' | 'startTime' | 'timeType' | 'title'>>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    const date = a.startDate.localeCompare(b.startDate);
    if (date) return date;
    const all = Number(a.timeType !== 'allDay') - Number(b.timeType !== 'allDay');
    if (all) return all;
    return (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.title.localeCompare(b.title, 'zh-Hant');
  });
}

function eventValues(input: CalendarEventInput): RowValues {
  // （2026-11-20 使用者決定：時間點不顯示結束欄位；結束日期存開始日、結束時間留空。）
  const endDate = input.timeType === 'point' ? input.startDate : input.endDate;
  return {
    title: input.title.trim() || null,
    groupId: input.groupId,
    parentEventId: input.parentEventId,
    timeType: input.timeType,
    startDate: input.startDate,
    startTime: input.timeType === 'allDay' ? null : input.startTime,
    startTimeZone: input.timeType === 'allDay' ? null : input.startTimeZone,
    endDate,
    endTime: input.timeType === 'range' ? input.endTime : null,
    endTimeZone: input.timeType === 'allDay' ? null : input.endTimeZone,
    timeMode: input.timeMode,
    locationType: input.locationType,
    startPlace: input.startPlace?.trim() || null,
    endPlace: input.locationType === 'route' ? input.endPlace?.trim() || null : null,
    url: input.url?.trim() || null,
    note: input.note?.trim() || null,
    status: input.status,
  };
}

function validateEvent(input: CalendarEventInput) {
  const endDate = input.timeType === 'point' ? input.startDate : input.endDate;
  if (!DATE_RE.test(input.startDate) || !DATE_RE.test(endDate)) throw new Error('請填正確的日期');
  if (endDate < input.startDate) throw new Error('結束日期不能早於開始日期');
  if (input.timeType !== 'allDay' && (!input.startTime || !TIME_RE.test(input.startTime))) throw new Error('請填正確的開始時間');
  if (input.timeType === 'range' && (!input.endTime || !TIME_RE.test(input.endTime))) throw new Error('請填正確的結束時間');
  if (input.timeType === 'range' && input.startDate === input.endDate && input.endTime! <= input.startTime!) throw new Error('同一天的結束時間必須晚於開始時間');
}

export class CalendarStore {
  constructor(
    private b: Backend,
    private via = 'calendar',
  ) {}

  async load(now = Date.now()): Promise<CalendarSnapshot> {
    let groupRows = await this.b.read('calendarGroups');
    if (!groupRows.some((r) => !r.empty && !deleted(r))) {
      await this.b.append('calendarGroups', [
        { name: '一般', color: DEFAULT_CALENDAR_COLOR, kind: 'user', sort: 1, hidden: false, archived: false, id: newId(now), createdAt: now, updatedAt: now },
      ]);
      groupRows = await this.b.read('calendarGroups');
    }

    const issues: CalendarIssue[] = [];
    const fixes: RowUpdate[] = [];
    const groups: CalendarGroup[] = [];
    for (const r of groupRows) {
      if (r.empty || deleted(r)) continue;
      const name = str(r.values.name);
      if (!name) {
        issues.push({ table: 'calendarGroups', rowNumber: r.rowNumber, text: '群組缺少名稱' });
        continue;
      }
      const id = str(r.values.id) ?? newId(now);
      const patch: RowValues = {};
      if (!r.values.id) Object.assign(patch, { id, createdAt: now, updatedAt: now });
      if (!str(r.values.color)) patch.color = DEFAULT_CALENDAR_COLOR;
      if (!str(r.values.kind)) patch.kind = 'user';
      if (r.values.sort == null) patch.sort = groups.length + 1;
      if (Object.keys(patch).length) fixes.push({ rowNumber: r.rowNumber, values: patch, expectId: str(r.values.id) ?? '' });
      groups.push({
        rowNumber: r.rowNumber,
        id,
        name,
        color: str(r.values.color) ?? DEFAULT_CALENDAR_COLOR,
        kind: str(r.values.kind) === 'system' ? 'system' : 'user',
        sourceType: str(r.values.sourceType),
        sort: num(r.values.sort, groups.length + 1),
        hidden: bool(r.values.hidden),
        archived: bool(r.values.archived),
      });
    }
    if (fixes.length) await this.b.update('calendarGroups', fixes);
    groups.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-Hant'));

    const settingRows = await this.b.read('calendarSettings');
    const setting = settingRows.find((r) => !r.empty && str(r.values.key) === DEFAULT_GROUP_KEY);
    const configured = setting ? str(setting.values.value) : null;
    const defaultGroupId = groups.some((g) => g.id === configured && !g.archived) ? configured! : groups.find((g) => !g.archived)?.id ?? groups[0].id;
    if (configured !== defaultGroupId) await this.saveSetting(setting ?? null, DEFAULT_GROUP_KEY, defaultGroupId);

    const eventRows = await this.b.read('calendarEvents');
    const eventFixes: RowUpdate[] = [];
    const events: CalendarEvent[] = [];
    for (const r of eventRows) {
      if (r.empty || deleted(r)) continue;
      if (r.errors.includes('startDate')) {
        issues.push({ table: 'calendarEvents', rowNumber: r.rowNumber, text: '開始日期格式看不懂' });
        continue;
      }
      const startDate = str(r.values.startDate);
      if (!startDate || !DATE_RE.test(startDate)) {
        issues.push({ table: 'calendarEvents', rowNumber: r.rowNumber, text: '行程缺少開始日期' });
        continue;
      }
      const startTime = str(r.values.startTime);
      const endTime = str(r.values.endTime);
      const rawType = str(r.values.timeType);
      const timeType: CalendarTimeType = rawType === 'range' || rawType === 'point' || rawType === 'allDay' ? rawType : startTime ? (endTime ? 'range' : 'point') : 'allDay';
      if (timeType !== 'allDay' && (!startTime || !TIME_RE.test(startTime))) {
        issues.push({ table: 'calendarEvents', rowNumber: r.rowNumber, text: '開始時間格式看不懂' });
        continue;
      }
      if (timeType === 'range' && (!endTime || !TIME_RE.test(endTime))) {
        issues.push({ table: 'calendarEvents', rowNumber: r.rowNumber, text: '結束時間格式看不懂' });
        continue;
      }
      const id = str(r.values.id) ?? newId(now);
      const title = str(r.values.title) ?? '未命名行程';
      const titleMissing = !str(r.values.title);
      const rawEndDate = str(r.values.endDate);
      const endDate = timeType === 'point' ? startDate : rawEndDate ?? startDate;
      const patch: RowValues = {};
      if (!r.values.id) Object.assign(patch, { id, createdAt: now, updatedAt: now, createdVia: str(r.values.createdVia) ?? 'sheet' });
      if (titleMissing) issues.push({ table: 'calendarEvents', rowNumber: r.rowNumber, text: '行程還沒有標題' });
      if (!str(r.values.groupId)) patch.groupId = defaultGroupId;
      if (!rawType) patch.timeType = timeType;
      if (!rawEndDate || (timeType === 'point' && rawEndDate !== startDate)) patch.endDate = endDate;
      if (timeType === 'point' && endTime) patch.endTime = null;
      if (!str(r.values.status)) patch.status = 'scheduled';
      if (!str(r.values.timeMode)) patch.timeMode = 'fixedZone';
      if (timeType !== 'allDay' && !str(r.values.startTimeZone)) patch.startTimeZone = DEFAULT_CALENDAR_TIME_ZONE;
      if (timeType !== 'allDay' && !str(r.values.endTimeZone)) patch.endTimeZone = DEFAULT_CALENDAR_TIME_ZONE;
      if (Object.keys(patch).length) eventFixes.push({ rowNumber: r.rowNumber, values: patch, expectId: str(r.values.id) ?? '' });
      events.push({
        rowNumber: r.rowNumber,
        id,
        title,
        groupId: str(r.values.groupId) ?? defaultGroupId,
        parentEventId: str(r.values.parentEventId),
        timeType,
        startDate,
        startTime: timeType === 'allDay' ? null : startTime,
        startTimeZone: timeType === 'allDay' ? null : str(r.values.startTimeZone) ?? DEFAULT_CALENDAR_TIME_ZONE,
        endDate,
        endTime: timeType === 'range' ? endTime : null,
        endTimeZone: timeType === 'allDay' ? null : str(r.values.endTimeZone) ?? DEFAULT_CALENDAR_TIME_ZONE,
        timeMode: str(r.values.timeMode) === 'floatingLocal' ? 'floatingLocal' : 'fixedZone',
        locationType: (['place', 'route', 'online'].includes(str(r.values.locationType) ?? '') ? str(r.values.locationType) : null) as CalendarLocationType,
        startPlace: str(r.values.startPlace),
        endPlace: str(r.values.endPlace),
        url: str(r.values.url),
        note: str(r.values.note),
        status: str(r.values.status) === 'cancelled' ? 'cancelled' : 'scheduled',
        createdVia: str(r.values.createdVia) ?? 'sheet',
        createdAt: num(r.values.createdAt, now),
        updatedAt: num(r.values.updatedAt, now),
        titleMissing,
      });
    }
    if (eventFixes.length) await this.b.update('calendarEvents', eventFixes);
    return { loadedAt: now, groups, events: sortCalendarEvents(events), defaultGroupId, issues };
  }

  async addGroup(name: string, color = DEFAULT_CALENDAR_COLOR) {
    const n = name.trim();
    if (!n) throw new Error('請填群組名稱');
    const snap = await this.load();
    if (snap.groups.some((g) => g.name === n && !g.archived)) throw new Error('已有同名群組');
    const now = Date.now();
    const id = newId(now);
    await this.b.append('calendarGroups', [{ name: n, color, kind: 'user', sort: Math.max(0, ...snap.groups.map((g) => g.sort)) + 1, hidden: false, archived: false, id, createdAt: now, updatedAt: now }]);
    return id;
  }

  async updateGroup(group: Pick<CalendarGroup, 'rowNumber' | 'id'>, patch: Partial<Pick<CalendarGroup, 'name' | 'color' | 'hidden' | 'archived' | 'sort'>>) {
    const values: RowValues = { updatedAt: Date.now() };
    if (patch.name !== undefined) {
      const n = patch.name.trim();
      if (!n) throw new Error('請填群組名稱');
      values.name = n;
    }
    if (patch.color !== undefined) values.color = patch.color;
    if (patch.hidden !== undefined) values.hidden = patch.hidden;
    if (patch.archived !== undefined) values.archived = patch.archived;
    if (patch.sort !== undefined) values.sort = patch.sort;
    await this.b.update('calendarGroups', [{ rowNumber: group.rowNumber, values, expectId: group.id }]);
  }

  async setDefaultGroup(id: string) {
    const rows = await this.b.read('calendarSettings');
    const row = rows.find((r) => !r.empty && str(r.values.key) === DEFAULT_GROUP_KEY) ?? null;
    await this.saveSetting(row, DEFAULT_GROUP_KEY, id);
  }

  private async saveSetting(row: TableRow | null, key: string, value: string) {
    if (row) await this.b.update('calendarSettings', [{ rowNumber: row.rowNumber, values: { value } }]);
    else await this.b.append('calendarSettings', [{ key, value }]);
  }

  async addEvent(input: CalendarEventInput, id = newId()) {
    validateEvent(input);
    const snap = await this.load();
    if (!snap.groups.some((g) => g.id === input.groupId && !g.archived)) throw new Error('請選擇可用的行事曆群組');
    if (input.parentEventId) {
      const parent = snap.events.find((e) => e.id === input.parentEventId);
      if (!parent) throw new Error('找不到主行程');
      const endDate = input.timeType === 'point' ? input.startDate : input.endDate;
      if (input.startDate < parent.startDate || endDate > parent.endDate) throw new Error(`細項日期必須在主行程的 ${parent.startDate}～${parent.endDate} 之內`);
    }
    const now = Date.now();
    await this.b.append('calendarEvents', [{ ...eventValues(input), createdVia: this.via, id, createdAt: now, updatedAt: now }]);
    return id;
  }

  async updateEvent(event: Pick<CalendarEvent, 'rowNumber' | 'id'>, input: CalendarEventInput) {
    validateEvent(input);
    if (input.parentEventId) {
      const snap = await this.load();
      const parent = snap.events.find((item) => item.id === input.parentEventId);
      if (!parent) throw new Error('找不到主行程');
      const endDate = input.timeType === 'point' ? input.startDate : input.endDate;
      if (input.startDate < parent.startDate || endDate > parent.endDate) throw new Error(`細項日期必須在主行程的 ${parent.startDate}～${parent.endDate} 之內`);
    }
    await this.b.update('calendarEvents', [{ rowNumber: event.rowNumber, values: { ...eventValues(input), updatedAt: Date.now() }, expectId: event.id }]);
  }

  /** 主行程改期：together = 所有細項依相同天數平移；onlyParent = 只改主行程。（2026-11-19 使用者決定） */
  async updateTrip(event: CalendarEvent, input: CalendarEventInput, mode: 'together' | 'onlyParent') {
    validateEvent(input);
    const snap = await this.load();
    const children = snap.events.filter((e) => e.parentEventId === event.id);
    const updates: RowUpdate[] = [{ rowNumber: event.rowNumber, values: { ...eventValues(input), updatedAt: Date.now() }, expectId: event.id }];
    if (mode === 'together') {
      const delta = dateDiffDays(event.startDate, input.startDate);
      for (const child of children) updates.push({ rowNumber: child.rowNumber, values: { startDate: addDateDays(child.startDate, delta), endDate: addDateDays(child.endDate, delta), updatedAt: Date.now() }, expectId: child.id });
    }
    await this.b.update('calendarEvents', updates);
  }

  /** 只改主行程時，超出新期間的細項逐筆移入 / 解除 / 取消。（2026-11-19 使用者決定） */
  async updateTripSelective(event: CalendarEvent, input: CalendarEventInput, actions: TripChildAction[]) {
    validateEvent(input);
    const now = Date.now();
    const updates: RowUpdate[] = [{ rowNumber: event.rowNumber, values: { ...eventValues(input), updatedAt: now }, expectId: event.id }];
    for (const item of actions) {
      if (item.action === 'move') {
        if (!item.startDate || !item.endDate || !DATE_RE.test(item.startDate) || !DATE_RE.test(item.endDate)) throw new Error('請填細項的新日期');
        if (item.startDate < input.startDate || item.endDate > input.endDate || item.endDate < item.startDate) throw new Error('細項的新日期必須在主行程期間內');
        updates.push({ rowNumber: item.event.rowNumber, values: { startDate: item.startDate, endDate: item.endDate, updatedAt: now }, expectId: item.event.id });
      } else if (item.action === 'detach') {
        updates.push({ rowNumber: item.event.rowNumber, values: { parentEventId: null, updatedAt: now }, expectId: item.event.id });
      } else {
        updates.push({ rowNumber: item.event.rowNumber, values: { status: 'cancelled', updatedAt: now }, expectId: item.event.id });
      }
    }
    await this.b.update('calendarEvents', updates);
  }

  async detachEvent(event: Pick<CalendarEvent, 'rowNumber' | 'id'>) {
    await this.b.update('calendarEvents', [{ rowNumber: event.rowNumber, values: { parentEventId: null, updatedAt: Date.now() }, expectId: event.id }]);
  }

  /** 取消整趟會連同細項；只取消主行程會解除細項。（2026-11-19 使用者決定） */
  async cancelEvent(event: CalendarEvent, wholeTrip: boolean) {
    const snap = await this.load();
    const updates: RowUpdate[] = [{ rowNumber: event.rowNumber, values: { status: 'cancelled', updatedAt: Date.now() }, expectId: event.id }];
    const children = snap.events.filter((e) => e.parentEventId === event.id);
    for (const child of children) {
      updates.push({ rowNumber: child.rowNumber, values: wholeTrip ? { status: 'cancelled', updatedAt: Date.now() } : { parentEventId: null, updatedAt: Date.now() }, expectId: child.id });
    }
    await this.b.update('calendarEvents', updates);
  }

  async restoreEvent(event: Pick<CalendarEvent, 'rowNumber' | 'id'>) {
    await this.b.update('calendarEvents', [{ rowNumber: event.rowNumber, values: { status: 'scheduled', updatedAt: Date.now() }, expectId: event.id }]);
  }

  async deleteEvent(event: CalendarEvent) {
    const snap = await this.load();
    if (snap.events.some((e) => e.parentEventId === event.id)) throw new Error('請先解除所有細項，再刪除主行程');
    const now = Date.now();
    await this.b.update('calendarEvents', [{ rowNumber: event.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: event.id }]);
  }
}
