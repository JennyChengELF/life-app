/**
 * 行事曆資料與規則。
 * 2026-11-19 使用者決定：待辦不進行事曆；旅遊可用主行程＋獨立細項。
 */
import type { Backend, RowUpdate, RowValues, TableRow } from './backend';
import { newId } from './ids';
import {
  analyzeCalendarLocalTime,
  convertCalendarInstant,
  isValidTimeZone,
  resolveCalendarLocalTime,
  type CalendarTimeDisambiguation,
} from './calendar-time';
import {
  calendarRecurrenceDates,
  parseCalendarRecurrence,
  recurrenceAddDays,
  serializeCalendarRecurrence,
  type CalendarRecurrence,
} from './calendar-recurrence';
import { TAIWAN_CALENDAR_GROUP_NAME, TAIWAN_CALENDAR_GROUP_SOURCE, taiwanSpecialDays } from './taiwan-calendar';
import { calendarReminderLeadDays, calendarReminderTime, parseCalendarReminders, type CalendarReminder } from './calendar-reminders';
import { addSharedTag, loadSharedTags, readTagIds, writeTagIds, type SharedTag } from './shared-tags';

export const DEFAULT_CALENDAR_TIME_ZONE = 'Asia/Taipei';
export const DEFAULT_CALENDAR_COLOR = '#1f6fd1';
const DEFAULT_GROUP_KEY = 'calendar.defaultGroupId';
const HOME_TIME_ZONE_KEY = 'calendar.homeTimeZone';
const CURRENT_TIME_ZONE_KEY = 'calendar.currentTimeZone';
const LAST_DETECTED_TIME_ZONE_KEY = 'calendar.lastDetectedTimeZone';
const RECENT_TIME_ZONES_KEY = 'calendar.recentTimeZones';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export type CalendarTimeType = 'range' | 'point' | 'allDay';
export type CalendarTimeMode = 'fixedZone' | 'floatingLocal';
export type CalendarEventStatus = 'scheduled' | 'cancelled';
export type CalendarLocationType = 'place' | 'route' | 'online' | null;
export type CalendarRecurrenceScope = 'single' | 'future' | 'all';

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
  startUtcOffset?: string | null;
  startDisambiguation?: CalendarTimeDisambiguation;
  endDate: string;
  endTime: string | null;
  endTimeZone: string | null;
  endUtcOffset?: string | null;
  endDisambiguation?: CalendarTimeDisambiguation;
  timeMode: CalendarTimeMode;
  timeZoneInferred?: boolean;
  locationType: CalendarLocationType;
  startPlace: string | null;
  endPlace: string | null;
  url: string | null;
  note: string | null;
  status: CalendarEventStatus;
  recurrence?: CalendarRecurrence | null;
  recurrenceParentId?: string | null;
  recurrenceInstanceKey?: string | null;
  recurrenceExceptions?: string[];
  reminders?: CalendarReminder[];
  peopleIds?: string[];
  tagIds?: string[];
}

export interface CalendarEvent extends CalendarEventInput {
  rowNumber: number;
  id: string;
  createdVia: string;
  createdAt: number;
  updatedAt: number;
  /** 原始標題空白；畫面顯示「未命名行程」，並提醒之後補齊 */
  titleMissing: boolean;
  /** 由系統資料產生的唯讀行程；一般行程為 null。 */
  systemSource: string | null;
  startUtcOffset: string | null;
  startDisambiguation: CalendarTimeDisambiguation;
  endUtcOffset: string | null;
  endDisambiguation: CalendarTimeDisambiguation;
  timeZoneInferred: boolean;
  recurrence: CalendarRecurrence | null;
  recurrenceParentId: string | null;
  recurrenceInstanceKey: string | null;
  recurrenceExceptions: string[];
  /** 由重複主規則即時計算，或是已保存的單次例外。 */
  isRecurrenceInstance: boolean;
  /** true 代表這次已另存成可獨立修改／取消的資料列。 */
  recurrenceOverride: boolean;
}

export interface CalendarIssue {
  table: 'calendarGroups' | 'calendarEvents' | 'hubPeople';
  rowNumber: number;
  text: string;
}

export interface CalendarPerson {
  id: string;
  nickname: string;
  fullName: string | null;
  archived: boolean;
}

export interface CalendarSnapshot {
  loadedAt: number;
  groups: CalendarGroup[];
  events: CalendarEvent[];
  recurrenceMasters: CalendarEvent[];
  people: CalendarPerson[];
  sharedTags: SharedTag[];
  defaultGroupId: string;
  homeTimeZone: string;
  currentTimeZone: string;
  lastDetectedTimeZone: string | null;
  recentTimeZones: string[];
  timeZoneRulesUpdated: number;
  issues: CalendarIssue[];
}

export interface TripChildAction {
  event: Pick<CalendarEvent, 'rowNumber' | 'id'>;
  action: 'move' | 'detach' | 'cancel';
  /** action = move 時的新日期 */
  startDate?: string;
  endDate?: string;
}

export interface TripAttachAction {
  event: Pick<CalendarEvent, 'rowNumber' | 'id' | 'timeType' | 'parentEventId' | 'systemSource'>;
  startDate: string;
  endDate: string;
}

const str = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const uniquePersonIds = (ids: string[]) => [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
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

/** 依畫面需要的日期範圍展開重複行程，不把每一次發生都寫進試算表。 */
export function expandCalendarEvents(snapshot: CalendarSnapshot, fromDate: string, toDate: string) {
  const events = [...snapshot.events];
  for (const master of snapshot.recurrenceMasters) {
    if (!master.recurrence || master.startDate > toDate) continue;
    const skipped = new Set(master.recurrenceExceptions);
    for (const override of snapshot.events) {
      if (override.recurrenceParentId === master.id && override.recurrenceInstanceKey) skipped.add(override.recurrenceInstanceKey);
    }
    const durationDays = dateDiffDays(master.startDate, master.endDate);
    for (const instanceDate of calendarRecurrenceDates(master.recurrence, master.startDate, fromDate, toDate)) {
      if (skipped.has(instanceDate)) continue;
      try {
        // （2026-11-24 使用者決定：重複行程遇到日光節約不存在的當地時間時，略過該次，不默默挪動。）
        const prepared = prepareEventInput({
          ...master,
          startDate: instanceDate,
          endDate: recurrenceAddDays(instanceDate, durationDays),
          recurrenceParentId: master.id,
          recurrenceInstanceKey: instanceDate,
        });
        events.push({
          ...master,
          ...prepared,
          rowNumber: 0,
          id: `repeat:${master.id}:${instanceDate}`,
          recurrenceParentId: master.id,
          recurrenceInstanceKey: instanceDate,
          recurrenceExceptions: master.recurrenceExceptions,
          isRecurrenceInstance: true,
          recurrenceOverride: false,
        });
      } catch {
        // 不存在的 DST 時刻或該次跨國交通換算無效時，這一次不產生。
      }
    }
  }
  return sortCalendarEvents(events);
}

export function recurrenceMasterOf(snapshot: CalendarSnapshot, event: CalendarEvent) {
  if (!event.recurrenceParentId) return null;
  return snapshot.recurrenceMasters.find((master) => master.id === event.recurrenceParentId) ?? null;
}

export function dueCalendarReminders(snapshot: CalendarSnapshot, now = Date.now()) {
  const today = convertCalendarInstant(now, snapshot.currentTimeZone).date;
  const masters = snapshot.recurrenceMasters.filter((event) => event.status === 'scheduled' && event.reminders?.length);
  const offsets = masters.flatMap((event) => event.reminders!.map(calendarReminderLeadDays));
  const first = offsets.reduce((min, days) => Math.min(min, days), 0);
  const last = offsets.reduce((max, days) => Math.max(max, days), 0);
  const events = expandCalendarEvents({ ...snapshot, recurrenceMasters: masters }, addDateDays(today, first - 2), addDateDays(today, last + 3));
  const groups = new Set(snapshot.groups.filter((group) => !group.hidden).map((group) => group.id));
  const due: { id: string; event: CalendarEvent; time: string; at: number }[] = [];
  for (const event of events) {
    if (event.status !== 'scheduled' || !event.reminders?.length || !groups.has(event.groupId)) continue;
    for (const [index, rule] of event.reminders.entries()) {
      try {
        const at = calendarReminderTime(event, rule, snapshot.homeTimeZone, snapshot.currentTimeZone);
        // 網頁版只顯示目前所在地今天已到時間的提醒。
        if (at > now || at < now - 27 * 3600000) continue;
        const local = convertCalendarInstant(at, snapshot.currentTimeZone);
        if (local.date === today) due.push({ id: `${event.id}:${index}`, event, time: local.time, at });
      } catch {
        // 略過當地不存在的時刻，例如重複行程的提醒碰上夏令時間跳時。
      }
    }
  }
  return due.sort((a, b) => a.at - b.at);
}

function eventValues(input: CalendarEventInput): RowValues {
  // （2026-11-20 使用者決定：時間點不顯示結束欄位；結束日期存開始日、結束時間留空。）
  const endDate = input.timeType === 'point' ? input.startDate : input.endDate;
  const fixedTimeZone = input.timeType !== 'allDay' && input.timeMode === 'fixedZone';
  const reminders = parseCalendarReminders(input.reminders);
  return {
    title: input.title.trim() || null,
    groupId: input.groupId,
    parentEventId: input.parentEventId,
    timeType: input.timeType,
    startDate: input.startDate,
    startTime: input.timeType === 'allDay' ? null : input.startTime,
    startTimeZone: fixedTimeZone ? input.startTimeZone : null,
    startUtcOffset: fixedTimeZone ? input.startUtcOffset ?? null : null,
    startDisambiguation: fixedTimeZone ? input.startDisambiguation ?? 'earlier' : null,
    endDate,
    endTime: input.timeType === 'range' ? input.endTime : null,
    endTimeZone: fixedTimeZone ? input.endTimeZone : null,
    endUtcOffset: fixedTimeZone ? input.endUtcOffset ?? null : null,
    endDisambiguation: fixedTimeZone ? input.endDisambiguation ?? 'earlier' : null,
    timeMode: input.timeMode,
    timeZoneInferred: fixedTimeZone ? input.timeZoneInferred ?? false : false,
    locationType: input.locationType,
    startPlace: input.startPlace?.trim() || null,
    endPlace: input.locationType === 'route' ? input.endPlace?.trim() || null : null,
    url: input.url?.trim() || null,
    note: input.note?.trim() || null,
    status: input.status,
    reminders: reminders.length ? JSON.stringify(reminders) : null,
    ...(input.peopleIds === undefined ? {} : { peopleIds: uniquePersonIds(input.peopleIds).join(',') || null }),
    ...(input.tagIds === undefined ? {} : { tagIds: writeTagIds(input.tagIds) }),
    recurrence: serializeCalendarRecurrence(input.recurrence ?? null),
    recurrenceParentId: input.recurrenceParentId ?? null,
    recurrenceInstanceKey: input.recurrenceInstanceKey ?? null,
    exceptions: input.recurrenceExceptions?.length ? JSON.stringify([...new Set(input.recurrenceExceptions)].sort()) : null,
  };
}

function prepareEventInput(input: CalendarEventInput, previous?: CalendarEvent): CalendarEventInput {
  if (input.timeType === 'allDay' || input.timeMode === 'floatingLocal') {
    return { ...input, startTimeZone: null, endTimeZone: null, startUtcOffset: null, endUtcOffset: null, startDisambiguation: 'earlier', endDisambiguation: 'earlier', timeZoneInferred: false };
  }
  const startTimeZone = input.startTimeZone ?? DEFAULT_CALENDAR_TIME_ZONE;
  const endTimeZone = input.locationType === 'route' && input.timeType === 'range' ? input.endTimeZone ?? startTimeZone : startTimeZone;
  if (!isValidTimeZone(startTimeZone) || !isValidTimeZone(endTimeZone)) throw new Error('請選擇正確的時區');
  const startDisambiguation = input.startDisambiguation === 'later' ? 'later' : 'earlier';
  const endDisambiguation = input.endDisambiguation === 'later' ? 'later' : 'earlier';
  const preserveStart = !!previous && previous.startDate === input.startDate && previous.startTime === input.startTime && previous.startTimeZone === startTimeZone && previous.startDisambiguation === startDisambiguation;
  const preserveEnd = !!previous && previous.endDate === input.endDate && previous.endTime === input.endTime && previous.endTimeZone === endTimeZone && previous.endDisambiguation === endDisambiguation;
  const start = resolveCalendarLocalTime(input.startDate, input.startTime!, startTimeZone, startDisambiguation, input.startUtcOffset, preserveStart);
  const end = input.timeType === 'point'
    ? start
    : resolveCalendarLocalTime(input.endDate, input.endTime!, endTimeZone, endDisambiguation, input.endUtcOffset, preserveEnd);
  return {
    ...input,
    startTimeZone,
    endTimeZone,
    startUtcOffset: start.offset,
    endUtcOffset: end.offset,
    startDisambiguation,
    endDisambiguation: input.timeType === 'point' ? startDisambiguation : endDisambiguation,
    timeZoneInferred: input.timeZoneInferred ?? false,
  };
}

function validateEvent(input: CalendarEventInput) {
  const endDate = input.timeType === 'point' ? input.startDate : input.endDate;
  if (!DATE_RE.test(input.startDate) || !DATE_RE.test(endDate)) throw new Error('請填正確的日期');
  if (endDate < input.startDate) throw new Error('結束日期不能早於開始日期');
  if (input.timeType !== 'allDay' && (!input.startTime || !TIME_RE.test(input.startTime))) throw new Error('請填正確的開始時間');
  if (input.timeType === 'range' && (!input.endTime || !TIME_RE.test(input.endTime))) throw new Error('請填正確的結束時間');
  const separateRouteZones = input.timeMode === 'fixedZone' && input.locationType === 'route' && input.startTimeZone !== input.endTimeZone;
  if (input.timeType === 'range' && input.startDate === input.endDate && input.endTime! <= input.startTime! && !separateRouteZones) throw new Error('同一天的結束時間必須晚於開始時間');
  if (input.recurrence) parseCalendarRecurrence(input.recurrence);
  if (input.recurrence && input.parentEventId) throw new Error('重複行程不能同時屬於主行程');
  const reminders = parseCalendarReminders(input.reminders);
  if (input.timeType === 'allDay' && reminders.some((rule) => rule.kind !== 'custom')) throw new Error('全天行程請用指定日期與時間的提醒');
}

function validatePreparedEvent(input: CalendarEventInput) {
  validateEvent(input);
  if (input.timeType === 'range' && input.timeMode === 'fixedZone' && input.locationType === 'route' && input.startTimeZone && input.endTimeZone && input.startUtcOffset && input.endUtcOffset) {
    const start = resolveCalendarLocalTime(input.startDate, input.startTime!, input.startTimeZone, input.startDisambiguation, input.startUtcOffset, true);
    const end = resolveCalendarLocalTime(input.endDate, input.endTime!, input.endTimeZone, input.endDisambiguation, input.endUtcOffset, true);
    if (end.epochMilliseconds <= start.epochMilliseconds) throw new Error('抵達時間換算後必須晚於出發時間');
  }
}

export class CalendarStore {
  constructor(
    private b: Backend,
    private via = 'calendar',
  ) {}

  private async loadPeople(now: number, issues: CalendarIssue[]) {
    const rows = await this.b.read('hubPeople');
    const people: CalendarPerson[] = [];
    const fixes: RowUpdate[] = [];
    const seenNicknames = new Set<string>();
    for (const row of rows) {
      if (row.empty || deleted(row)) continue;
      // （2026-11-25 使用者確認：既有 name 當作唯一暱稱，姓名另存，行程透過 id 連結。）
      const nickname = str(row.values.name);
      if (!nickname || seenNicknames.has(nickname)) {
        issues.push({ table: 'hubPeople', rowNumber: row.rowNumber, text: nickname ? `人物暱稱「${nickname}」重複` : '人物缺少暱稱' });
      }
      if (!nickname) continue;
      seenNicknames.add(nickname);
      const currentId = str(row.values.id);
      const id = currentId ?? newId(now);
      if (!currentId) fixes.push({ rowNumber: row.rowNumber, expectId: '', values: { id, createdAt: now, updatedAt: now } });
      people.push({ id, nickname, fullName: str(row.values.fullName), archived: bool(row.values.archived) });
    }
    if (fixes.length) await this.b.update('hubPeople', fixes);
    return people.sort((a, b) => a.nickname.localeCompare(b.nickname, 'zh-Hant'));
  }

  async addPerson(nickname: string, fullName = '') {
    const name = nickname.trim();
    if (!name) throw new Error('請填暱稱');
    const rows = (await this.b.read('hubPeople')).filter((row) => !row.empty && !deleted(row));
    if (rows.some((row) => str(row.values.name) === name)) throw new Error(`已經有暱稱「${name}」`);
    const now = Date.now();
    const id = newId(now);
    const sort = rows.reduce((max, row) => Math.max(max, num(row.values.sort, 0)), 0) + 1;
    await this.b.append('hubPeople', [{ id, name, fullName: fullName.trim() || null, sort, createdAt: now, updatedAt: now }]);
    return id;
  }

  addTag(name: string) {
    return addSharedTag(this.b, name);
  }

  async load(now = Date.now(), { includePeople = true, includeTags = true } = {}): Promise<CalendarSnapshot> {
    let groupRows = await this.b.read('calendarGroups');
    if (!groupRows.some((r) => !r.empty && !deleted(r) && str(r.values.kind) !== 'system')) {
      await this.b.append('calendarGroups', [
        { name: '一般', color: DEFAULT_CALENDAR_COLOR, kind: 'user', sort: 1, hidden: false, archived: false, id: newId(now), createdAt: now, updatedAt: now },
      ]);
      groupRows = await this.b.read('calendarGroups');
    }
    // （2026-11-24 使用者決定：國定假日、補假與補班放在同一個「台灣休假與補班」系統群組。）
    if (!groupRows.some((r) => !r.empty && !deleted(r) && str(r.values.sourceType) === TAIWAN_CALENDAR_GROUP_SOURCE)) {
      await this.b.append('calendarGroups', [
        { name: TAIWAN_CALENDAR_GROUP_NAME, color: '#d64545', kind: 'system', sourceType: TAIWAN_CALENDAR_GROUP_SOURCE, sort: 999, hidden: false, archived: false, id: newId(now + 1), createdAt: now, updatedAt: now },
      ]);
      groupRows = await this.b.read('calendarGroups');
    }

    const issues: CalendarIssue[] = [];
    const fixes: RowUpdate[] = [];
    const groups: CalendarGroup[] = [];
    for (const r of groupRows) {
      if (r.empty || deleted(r)) continue;
      const sourceType = str(r.values.sourceType);
      let name = str(r.values.name);
      const patch: RowValues = {};
      if (sourceType === TAIWAN_CALENDAR_GROUP_SOURCE) {
        if (name !== TAIWAN_CALENDAR_GROUP_NAME) patch.name = TAIWAN_CALENDAR_GROUP_NAME;
        if (str(r.values.kind) !== 'system') patch.kind = 'system';
        name = TAIWAN_CALENDAR_GROUP_NAME;
      } else if (!name) {
        issues.push({ table: 'calendarGroups', rowNumber: r.rowNumber, text: '群組缺少名稱' });
        continue;
      }
      const id = str(r.values.id) ?? newId(now);
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
        kind: sourceType === TAIWAN_CALENDAR_GROUP_SOURCE || str(r.values.kind) === 'system' ? 'system' : 'user',
        sourceType,
        sort: num(r.values.sort, groups.length + 1),
        hidden: bool(r.values.hidden),
        archived: bool(r.values.archived),
      });
    }
    if (fixes.length) await this.b.update('calendarGroups', fixes);
    groups.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-Hant'));

    const settingRows = await this.b.read('calendarSettings');
    const findSetting = (key: string) => settingRows.find((r) => !r.empty && str(r.values.key) === key) ?? null;
    const setting = findSetting(DEFAULT_GROUP_KEY);
    const configured = setting ? str(setting.values.value) : null;
    const defaultGroupId = groups.some((g) => g.id === configured && !g.archived && g.kind === 'user') ? configured! : groups.find((g) => !g.archived && g.kind === 'user')?.id ?? groups[0].id;
    if (configured !== defaultGroupId) await this.saveSetting(setting ?? null, DEFAULT_GROUP_KEY, defaultGroupId);

    // （2026-11-24 使用者決定：主要時區只能手動改；偵測到裝置時區變更時先詢問，不直接改既有行程。）
    const rawHomeTimeZone = str(findSetting(HOME_TIME_ZONE_KEY)?.values.value);
    const homeTimeZone = rawHomeTimeZone && isValidTimeZone(rawHomeTimeZone) ? rawHomeTimeZone : DEFAULT_CALENDAR_TIME_ZONE;
    if (rawHomeTimeZone !== homeTimeZone) await this.saveSetting(findSetting(HOME_TIME_ZONE_KEY), HOME_TIME_ZONE_KEY, homeTimeZone);
    const rawCurrentTimeZone = str(findSetting(CURRENT_TIME_ZONE_KEY)?.values.value);
    const currentTimeZone = rawCurrentTimeZone && isValidTimeZone(rawCurrentTimeZone) ? rawCurrentTimeZone : homeTimeZone;
    if (rawCurrentTimeZone !== currentTimeZone) await this.saveSetting(findSetting(CURRENT_TIME_ZONE_KEY), CURRENT_TIME_ZONE_KEY, currentTimeZone);
    const rawLastDetected = str(findSetting(LAST_DETECTED_TIME_ZONE_KEY)?.values.value);
    const lastDetectedTimeZone = rawLastDetected && isValidTimeZone(rawLastDetected) ? rawLastDetected : null;
    let recentTimeZones: string[] = [];
    try {
      const parsed = JSON.parse(str(findSetting(RECENT_TIME_ZONES_KEY)?.values.value) ?? '[]');
      if (Array.isArray(parsed)) recentTimeZones = [...new Set(parsed.filter((item): item is string => typeof item === 'string' && isValidTimeZone(item)))].slice(0, 8);
    } catch {
      // 設定值損壞時忽略，之後儲存行程會重新建立。
    }
    const today = convertCalendarInstant(now, homeTimeZone).date;
    let timeZoneRulesUpdated = 0;

    const [eventRows, people, sharedTags] = await Promise.all([
      this.b.read('calendarEvents'),
      includePeople ? this.loadPeople(now, issues) : [],
      includeTags ? loadSharedTags(this.b, now) : [],
    ]);
    const eventFixes: RowUpdate[] = [];
    const loadedEvents: CalendarEvent[] = [];
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
      const timeMode: CalendarTimeMode = str(r.values.timeMode) === 'floatingLocal' ? 'floatingLocal' : 'fixedZone';
      const locationType = (['place', 'route', 'online'].includes(str(r.values.locationType) ?? '') ? str(r.values.locationType) : null) as CalendarLocationType;
      let startTimeZone: string | null = null;
      let endTimeZone: string | null = null;
      let startUtcOffset: string | null = null;
      let endUtcOffset: string | null = null;
      const startDisambiguation: CalendarTimeDisambiguation = str(r.values.startDisambiguation) === 'later' ? 'later' : 'earlier';
      const endDisambiguation: CalendarTimeDisambiguation = str(r.values.endDisambiguation) === 'later' ? 'later' : 'earlier';
      let timeZoneInferred = false;
      let recurrence: CalendarRecurrence | null = null;
      try {
        recurrence = parseCalendarRecurrence(str(r.values.recurrence));
      } catch (error) {
        issues.push({ table: 'calendarEvents', rowNumber: r.rowNumber, text: error instanceof Error ? error.message : '重複規則格式看不懂' });
      }
      const recurrenceParentId = str(r.values.recurrenceParentId);
      const recurrenceInstanceKey = str(r.values.recurrenceInstanceKey);
      let recurrenceExceptions: string[] = [];
      const rawExceptions = str(r.values.exceptions);
      if (rawExceptions) {
        try {
          const parsed = JSON.parse(rawExceptions);
          if (!Array.isArray(parsed) || parsed.some((date) => typeof date !== 'string' || !DATE_RE.test(date))) throw new Error();
          recurrenceExceptions = [...new Set(parsed)].sort();
        } catch {
          const legacy = rawExceptions.split(',').map((date) => date.trim()).filter((date) => DATE_RE.test(date));
          if (legacy.length) {
            recurrenceExceptions = [...new Set(legacy)].sort();
            patch.exceptions = JSON.stringify(recurrenceExceptions);
          } else issues.push({ table: 'calendarEvents', rowNumber: r.rowNumber, text: '重複行程的例外日期格式看不懂' });
        }
      }

      if (timeType !== 'allDay' && timeMode === 'fixedZone') {
        const rawStartTimeZone = str(r.values.startTimeZone);
        startTimeZone = rawStartTimeZone ?? homeTimeZone;
        timeZoneInferred = bool(r.values.timeZoneInferred) || !rawStartTimeZone;
        if (!isValidTimeZone(startTimeZone)) {
          issues.push({ table: 'calendarEvents', rowNumber: r.rowNumber, text: '開始時區格式看不懂' });
          continue;
        }
        const rawEndTimeZone = str(r.values.endTimeZone);
        endTimeZone = locationType === 'route' && timeType === 'range' ? rawEndTimeZone ?? startTimeZone : startTimeZone;
        if (!isValidTimeZone(endTimeZone)) {
          issues.push({ table: 'calendarEvents', rowNumber: r.rowNumber, text: '結束時區格式看不懂' });
          continue;
        }
        if (!rawStartTimeZone) patch.startTimeZone = startTimeZone;
        if (!rawStartTimeZone) patch.timeZoneInferred = true;
        if (!rawEndTimeZone || rawEndTimeZone !== endTimeZone) patch.endTimeZone = endTimeZone;
        if (!['earlier', 'later'].includes(str(r.values.startDisambiguation) ?? '')) patch.startDisambiguation = startDisambiguation;
        if (!['earlier', 'later'].includes(str(r.values.endDisambiguation) ?? '')) patch.endDisambiguation = timeType === 'point' ? startDisambiguation : endDisambiguation;

        try {
          const startAnalysis = analyzeCalendarLocalTime(startDate, startTime!, startTimeZone);
          if (startAnalysis.kind === 'nonexistent') throw new Error('開始時間是當地不存在的時間');
          const computedStart = startDisambiguation === 'later' ? startAnalysis.later : startAnalysis.earlier;
          const storedStart = str(r.values.startUtcOffset);
          if (storedStart && startDate < today) resolveCalendarLocalTime(startDate, startTime!, startTimeZone, startDisambiguation, storedStart, true);
          startUtcOffset = storedStart && startDate < today ? storedStart : computedStart.offset;
          if (!storedStart || (startDate >= today && storedStart !== computedStart.offset)) {
            patch.startUtcOffset = computedStart.offset;
            if (storedStart && storedStart !== computedStart.offset) timeZoneRulesUpdated += 1;
          }

          if (timeType === 'point') {
            endUtcOffset = startUtcOffset;
            if (str(r.values.endUtcOffset) !== startUtcOffset) patch.endUtcOffset = startUtcOffset;
          } else {
            const endAnalysis = analyzeCalendarLocalTime(endDate, endTime!, endTimeZone);
            if (endAnalysis.kind === 'nonexistent') throw new Error('結束時間是當地不存在的時間');
            const computedEnd = endDisambiguation === 'later' ? endAnalysis.later : endAnalysis.earlier;
            const storedEnd = str(r.values.endUtcOffset);
            if (storedEnd && endDate < today) resolveCalendarLocalTime(endDate, endTime!, endTimeZone, endDisambiguation, storedEnd, true);
            endUtcOffset = storedEnd && endDate < today ? storedEnd : computedEnd.offset;
            if (!storedEnd || (endDate >= today && storedEnd !== computedEnd.offset)) {
              patch.endUtcOffset = computedEnd.offset;
              if (storedEnd && storedEnd !== computedEnd.offset) timeZoneRulesUpdated += 1;
            }
            if (locationType === 'route' && resolveCalendarLocalTime(endDate, endTime!, endTimeZone, endDisambiguation, endUtcOffset, true).epochMilliseconds <= resolveCalendarLocalTime(startDate, startTime!, startTimeZone, startDisambiguation, startUtcOffset, true).epochMilliseconds) throw new Error('抵達時間換算後必須晚於出發時間');
          }
        } catch (error) {
          issues.push({ table: 'calendarEvents', rowNumber: r.rowNumber, text: error instanceof Error ? error.message : '時區時間格式看不懂' });
          continue;
        }
      } else {
        if (r.values.startTimeZone != null) patch.startTimeZone = null;
        if (r.values.endTimeZone != null) patch.endTimeZone = null;
        if (r.values.startUtcOffset != null) patch.startUtcOffset = null;
        if (r.values.endUtcOffset != null) patch.endUtcOffset = null;
        if (r.values.startDisambiguation != null) patch.startDisambiguation = null;
        if (r.values.endDisambiguation != null) patch.endDisambiguation = null;
        if (bool(r.values.timeZoneInferred)) patch.timeZoneInferred = false;
      }
      if (!r.values.id) Object.assign(patch, { id, createdAt: now, updatedAt: now, createdVia: str(r.values.createdVia) ?? 'sheet' });
      if (titleMissing) issues.push({ table: 'calendarEvents', rowNumber: r.rowNumber, text: '行程還沒有標題' });
      if (!str(r.values.groupId)) patch.groupId = defaultGroupId;
      if (!rawType) patch.timeType = timeType;
      if (!rawEndDate || (timeType === 'point' && rawEndDate !== startDate)) patch.endDate = endDate;
      if (timeType === 'point' && endTime) patch.endTime = null;
      if (!str(r.values.status)) patch.status = 'scheduled';
      if (!str(r.values.timeMode)) patch.timeMode = 'fixedZone';
      if (Object.keys(patch).length) eventFixes.push({ rowNumber: r.rowNumber, values: patch, expectId: str(r.values.id) ?? '' });
      let reminders: CalendarReminder[] = [];
      try {
        reminders = parseCalendarReminders(r.values.reminders);
        if (timeType === 'allDay' && reminders.some((rule) => rule.kind !== 'custom')) throw new Error();
      } catch {
        issues.push({ table: 'calendarEvents', rowNumber: r.rowNumber, text: '提醒設定格式不正確，請在行事曆重新設定' });
        reminders = reminders.filter((rule) => rule.kind === 'custom');
      }
      loadedEvents.push({
        rowNumber: r.rowNumber,
        id,
        title,
        groupId: str(r.values.groupId) ?? defaultGroupId,
        parentEventId: str(r.values.parentEventId),
        timeType,
        startDate,
        startTime: timeType === 'allDay' ? null : startTime,
        startTimeZone,
        startUtcOffset,
        startDisambiguation,
        endDate,
        endTime: timeType === 'range' ? endTime : null,
        endTimeZone,
        endUtcOffset,
        endDisambiguation: timeType === 'point' ? startDisambiguation : endDisambiguation,
        timeMode,
        timeZoneInferred,
        locationType,
        startPlace: str(r.values.startPlace),
        endPlace: str(r.values.endPlace),
        url: str(r.values.url),
        note: str(r.values.note),
        status: str(r.values.status) === 'cancelled' ? 'cancelled' : 'scheduled',
        reminders,
        peopleIds: uniquePersonIds((str(r.values.peopleIds) ?? '').split(',')),
        tagIds: readTagIds(r.values.tagIds),
        createdVia: str(r.values.createdVia) ?? 'sheet',
        createdAt: num(r.values.createdAt, now),
        updatedAt: num(r.values.updatedAt, now),
        titleMissing,
        systemSource: null,
        recurrence,
        recurrenceParentId,
        recurrenceInstanceKey,
        recurrenceExceptions,
        isRecurrenceInstance: !!recurrenceParentId && !!recurrenceInstanceKey,
        recurrenceOverride: !!recurrenceParentId && !!recurrenceInstanceKey,
      });
    }
    if (eventFixes.length) await this.b.update('calendarEvents', eventFixes);
    const recurrenceMasters = loadedEvents.filter((event) => !!event.recurrence && !event.recurrenceParentId);
    const recurrenceMasterMap = new Map(recurrenceMasters.map((event) => [event.id, event]));
    const events = loadedEvents.filter((event) => !recurrenceMasters.includes(event));
    for (const event of events) {
      if (!event.recurrenceParentId) continue;
      const master = recurrenceMasterMap.get(event.recurrenceParentId);
      if (!master) {
        issues.push({ table: 'calendarEvents', rowNumber: event.rowNumber, text: '找不到重複行程的原始規則' });
        continue;
      }
      event.recurrence = master.recurrence;
      event.recurrenceExceptions = master.recurrenceExceptions;
      event.isRecurrenceInstance = true;
      event.recurrenceOverride = true;
    }
    const taiwanGroup = groups.find((g) => g.sourceType === TAIWAN_CALENDAR_GROUP_SOURCE && !g.archived);
    if (taiwanGroup) {
      for (const day of taiwanSpecialDays()) {
        events.push({
          rowNumber: 0,
          id: `system:${TAIWAN_CALENDAR_GROUP_SOURCE}:${day.date}`,
          title: day.title ?? (day.type === 'workday' ? '補班日' : '休假日'),
          groupId: taiwanGroup.id,
          parentEventId: null,
          timeType: 'allDay',
          startDate: day.date,
          startTime: null,
          startTimeZone: null,
          startUtcOffset: null,
          startDisambiguation: 'earlier',
          endDate: day.date,
          endTime: null,
          endTimeZone: null,
          endUtcOffset: null,
          endDisambiguation: 'earlier',
          timeMode: 'fixedZone',
          timeZoneInferred: false,
          locationType: null,
          startPlace: null,
          endPlace: null,
          url: null,
          note: day.type === 'workday' ? '依台灣政府行政機關辦公日曆，此日為補班日。' : '依台灣政府行政機關辦公日曆顯示。',
          status: 'scheduled',
          createdVia: TAIWAN_CALENDAR_GROUP_SOURCE,
          createdAt: 0,
          updatedAt: 0,
          titleMissing: false,
          systemSource: TAIWAN_CALENDAR_GROUP_SOURCE,
          recurrence: null,
          recurrenceParentId: null,
          recurrenceInstanceKey: null,
          recurrenceExceptions: [],
          isRecurrenceInstance: false,
          recurrenceOverride: false,
        });
      }
    }
    return { loadedAt: now, groups, events: sortCalendarEvents(events), recurrenceMasters, people, sharedTags, defaultGroupId, homeTimeZone, currentTimeZone, lastDetectedTimeZone, recentTimeZones, timeZoneRulesUpdated, issues };
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
    const current = (await this.load()).groups.find((item) => item.id === group.id);
    if (!current) throw new Error('找不到群組');
    if (current.kind === 'system' && (patch.name !== undefined || patch.archived !== undefined)) throw new Error('系統群組只能調整顏色、排序與顯示');
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
    const group = (await this.load()).groups.find((item) => item.id === id);
    if (!group || group.kind !== 'user' || group.archived) throw new Error('系統群組不能設為預設群組');
    const rows = await this.b.read('calendarSettings');
    const row = rows.find((r) => !r.empty && str(r.values.key) === DEFAULT_GROUP_KEY) ?? null;
    await this.saveSetting(row, DEFAULT_GROUP_KEY, id);
  }

  async setHomeTimeZone(timeZone: string) {
    if (!isValidTimeZone(timeZone)) throw new Error('請選擇正確的主要時區');
    const rows = await this.b.read('calendarSettings');
    await this.saveSetting(rows.find((r) => !r.empty && str(r.values.key) === HOME_TIME_ZONE_KEY) ?? null, HOME_TIME_ZONE_KEY, timeZone);
  }

  async setCurrentTimeZone(timeZone: string) {
    if (!isValidTimeZone(timeZone)) throw new Error('請選擇正確的目前時區');
    const rows = await this.b.read('calendarSettings');
    await this.saveSetting(rows.find((r) => !r.empty && str(r.values.key) === CURRENT_TIME_ZONE_KEY) ?? null, CURRENT_TIME_ZONE_KEY, timeZone);
  }

  /** 裝置時區改變只記錄使用者選擇，不改主要時區與既有行程。（2026-11-24 使用者決定） */
  async confirmDetectedTimeZone(timeZone: string, useAsCurrent: boolean) {
    if (!isValidTimeZone(timeZone)) throw new Error('裝置回報的時區無法使用');
    const rows = await this.b.read('calendarSettings');
    await this.saveSetting(rows.find((r) => !r.empty && str(r.values.key) === LAST_DETECTED_TIME_ZONE_KEY) ?? null, LAST_DETECTED_TIME_ZONE_KEY, timeZone);
    if (useAsCurrent) await this.saveSetting(rows.find((r) => !r.empty && str(r.values.key) === CURRENT_TIME_ZONE_KEY) ?? null, CURRENT_TIME_ZONE_KEY, timeZone);
  }

  private async saveSetting(row: TableRow | null, key: string, value: string) {
    if (row) await this.b.update('calendarSettings', [{ rowNumber: row.rowNumber, values: { value } }]);
    else await this.b.append('calendarSettings', [{ key, value }]);
  }

  private async rememberTimeZones(input: CalendarEventInput) {
    if (input.timeType === 'allDay' || input.timeMode === 'floatingLocal') return;
    const zones = [input.startTimeZone, input.endTimeZone].filter((item): item is string => !!item && isValidTimeZone(item));
    if (!zones.length) return;
    const rows = await this.b.read('calendarSettings');
    const row = rows.find((r) => !r.empty && str(r.values.key) === RECENT_TIME_ZONES_KEY) ?? null;
    let current: string[] = [];
    try {
      const parsed = JSON.parse(str(row?.values.value) ?? '[]');
      if (Array.isArray(parsed)) current = parsed.filter((item): item is string => typeof item === 'string' && isValidTimeZone(item));
    } catch {
      // 以這次的正確選項重新建立最近使用清單。
    }
    await this.saveSetting(row, RECENT_TIME_ZONES_KEY, JSON.stringify([...new Set([...zones, ...current])].slice(0, 8)));
  }

  async addEvent(input: CalendarEventInput, id = newId()) {
    validateEvent(input);
    const prepared = prepareEventInput(input);
    validatePreparedEvent(prepared);
    const snap = await this.load();
    if (!snap.groups.some((g) => g.id === prepared.groupId && !g.archived && g.kind === 'user')) throw new Error('請選擇可用的行事曆群組');
    if (prepared.parentEventId) {
      const parent = snap.events.find((e) => e.id === prepared.parentEventId);
      if (!parent) throw new Error('找不到主行程');
      const endDate = prepared.timeType === 'point' ? prepared.startDate : prepared.endDate;
      if (prepared.startDate < parent.startDate || endDate > parent.endDate) throw new Error(`細項日期必須在主行程的 ${parent.startDate}～${parent.endDate} 之內`);
      prepared.peopleIds ??= parent.peopleIds;
      prepared.tagIds ??= parent.tagIds;
    }
    const now = Date.now();
    await this.b.append('calendarEvents', [{ ...eventValues(prepared), createdVia: this.via, id, createdAt: now, updatedAt: now }]);
    await this.rememberTimeZones(prepared);
    return id;
  }

  async updateEvent(event: Pick<CalendarEvent, 'rowNumber' | 'id'>, input: CalendarEventInput) {
    if ((event as CalendarEvent).systemSource) throw new Error('系統行程不能在這裡修改');
    if ((event as CalendarEvent).recurrenceParentId) throw new Error('請先選擇要修改單次、這次及之後，或全部重複行程');
    validateEvent(input);
    const snap = await this.load();
    const prepared = prepareEventInput(input, snap.events.find((item) => item.id === event.id));
    validatePreparedEvent(prepared);
    if (prepared.recurrence && snap.events.some((item) => item.parentEventId === event.id)) throw new Error('已有細項的主行程不能改成重複行程');
    if (prepared.parentEventId) {
      const parent = snap.events.find((item) => item.id === prepared.parentEventId);
      if (!parent) throw new Error('找不到主行程');
      const endDate = prepared.timeType === 'point' ? prepared.startDate : prepared.endDate;
      if (prepared.startDate < parent.startDate || endDate > parent.endDate) throw new Error(`細項日期必須在主行程的 ${parent.startDate}～${parent.endDate} 之內`);
    }
    await this.b.update('calendarEvents', [{ rowNumber: event.rowNumber, values: { ...eventValues(prepared), updatedAt: Date.now() }, expectId: event.id }]);
    await this.rememberTimeZones(prepared);
  }

  private async recurrenceContext(event: CalendarEvent) {
    if (!event.recurrenceParentId || !event.recurrenceInstanceKey) throw new Error('這筆不是重複行程的發生項目');
    const snap = await this.load();
    const master = snap.recurrenceMasters.find((item) => item.id === event.recurrenceParentId);
    if (!master?.recurrence) throw new Error('找不到重複行程的原始規則');
    const overrides = snap.events.filter((item) => item.recurrenceParentId === master.id && item.recurrenceInstanceKey);
    return { snap, master, overrides, key: event.recurrenceInstanceKey };
  }

  private async saveSingleRecurrenceOverride(event: CalendarEvent, input: CalendarEventInput) {
    const { master, key } = await this.recurrenceContext(event);
    const now = Date.now();
    const overrideInput: CalendarEventInput = {
      ...input,
      parentEventId: null,
      recurrence: null,
      recurrenceParentId: master.id,
      recurrenceInstanceKey: key,
      recurrenceExceptions: [],
    };
    validateEvent(overrideInput);
    const prepared = prepareEventInput(overrideInput, event);
    validatePreparedEvent(prepared);
    if (event.recurrenceOverride) {
      await this.b.update('calendarEvents', [{ rowNumber: event.rowNumber, values: { ...eventValues(prepared), updatedAt: now }, expectId: event.id }]);
    } else {
      await this.b.append('calendarEvents', [{ ...eventValues(prepared), createdVia: this.via, id: newId(now), createdAt: now, updatedAt: now }]);
    }
    const exceptions = [...new Set([...master.recurrenceExceptions, key])].sort();
    await this.b.update('calendarEvents', [{ rowNumber: master.rowNumber, values: { exceptions: JSON.stringify(exceptions), updatedAt: now }, expectId: master.id }]);
    await this.rememberTimeZones(prepared);
  }

  private async updateAllRecurring(event: CalendarEvent, input: CalendarEventInput) {
    const { master, overrides } = await this.recurrenceContext(event);
    const now = Date.now();
    const delta = dateDiffDays(event.startDate, input.startDate);
    const duration = dateDiffDays(input.startDate, input.endDate);
    const shiftedExceptions = master.recurrenceExceptions.map((date) => addDateDays(date, delta));
    const masterInput: CalendarEventInput = {
      ...input,
      parentEventId: null,
      startDate: addDateDays(master.startDate, delta),
      endDate: addDateDays(master.startDate, delta + duration),
      recurrence: input.recurrence ?? master.recurrence,
      recurrenceParentId: null,
      recurrenceInstanceKey: null,
      recurrenceExceptions: shiftedExceptions,
    };
    validateEvent(masterInput);
    const prepared = prepareEventInput(masterInput, master);
    validatePreparedEvent(prepared);
    const updates: RowUpdate[] = [{ rowNumber: master.rowNumber, values: { ...eventValues(prepared), updatedAt: now }, expectId: master.id }];
    if (delta) {
      for (const override of overrides) {
        const shifted = prepareEventInput({
          ...override,
          startDate: addDateDays(override.startDate, delta),
          endDate: addDateDays(override.endDate, delta),
          recurrence: null,
          recurrenceParentId: master.id,
          recurrenceInstanceKey: addDateDays(override.recurrenceInstanceKey!, delta),
          recurrenceExceptions: [],
        }, override);
        validatePreparedEvent(shifted);
        updates.push({ rowNumber: override.rowNumber, values: { ...eventValues(shifted), updatedAt: now }, expectId: override.id });
      }
    }
    await this.b.update('calendarEvents', updates);
    await this.rememberTimeZones(prepared);
  }

  private async splitRecurringSeries(event: CalendarEvent, input: CalendarEventInput) {
    const { master, overrides, key } = await this.recurrenceContext(event);
    const now = Date.now();
    const beforeDates = calendarRecurrenceDates(master.recurrence!, master.startDate, master.startDate, addDateDays(key, -1));
    const beforeCount = beforeDates.length;
    const oldRule = master.recurrence!;
    const requestedRule = input.recurrence ?? oldRule;
    const ruleChanged = serializeCalendarRecurrence(requestedRule) !== serializeCalendarRecurrence(oldRule);
    const newRule: CalendarRecurrence = !ruleChanged && oldRule.end === 'count'
      ? { ...oldRule, count: Math.max(1, oldRule.count! - beforeCount) }
      : { ...requestedRule };
    const delta = dateDiffDays(key, input.startDate);
    const overrideKeys = new Set(overrides.map((item) => item.recurrenceInstanceKey));
    const newExceptions = master.recurrenceExceptions
      .filter((date) => date > key || (date === key && !overrideKeys.has(key)))
      .map((date) => addDateDays(date, delta));
    const newSeriesId = newId(now);
    const newInput: CalendarEventInput = {
      ...input,
      parentEventId: null,
      recurrence: newRule,
      recurrenceParentId: null,
      recurrenceInstanceKey: null,
      recurrenceExceptions: newExceptions,
    };
    validateEvent(newInput);
    const prepared = prepareEventInput(newInput);
    validatePreparedEvent(prepared);
    await this.b.append('calendarEvents', [{ ...eventValues(prepared), createdVia: this.via, id: newSeriesId, createdAt: now, updatedAt: now }]);

    const originalValues: RowValues = beforeCount
      ? { recurrence: serializeCalendarRecurrence({ ...oldRule, end: 'count', count: beforeCount }), exceptions: JSON.stringify(master.recurrenceExceptions.filter((date) => date < key)), updatedAt: now }
      : { deletedAt: now, updatedAt: now };
    const updates: RowUpdate[] = [{ rowNumber: master.rowNumber, values: originalValues, expectId: master.id }];
    for (const override of overrides.filter((item) => item.recurrenceInstanceKey! >= key)) {
      if (override.recurrenceInstanceKey === key) {
        updates.push({ rowNumber: override.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: override.id });
        continue;
      }
      const shifted = prepareEventInput({
        ...override,
        startDate: addDateDays(override.startDate, delta),
        endDate: addDateDays(override.endDate, delta),
        recurrence: null,
        recurrenceParentId: newSeriesId,
        recurrenceInstanceKey: addDateDays(override.recurrenceInstanceKey!, delta),
        recurrenceExceptions: [],
      }, override);
      validatePreparedEvent(shifted);
      updates.push({ rowNumber: override.rowNumber, values: { ...eventValues(shifted), updatedAt: now }, expectId: override.id });
    }
    await this.b.update('calendarEvents', updates);
    await this.rememberTimeZones(prepared);
  }

  async updateRecurringEvent(event: CalendarEvent, input: CalendarEventInput, scope: CalendarRecurrenceScope) {
    if (scope === 'single') return this.saveSingleRecurrenceOverride(event, { ...input, recurrence: null });
    if (scope === 'future') return this.splitRecurringSeries(event, input);
    return this.updateAllRecurring(event, input);
  }

  async setRecurringEventStatus(event: CalendarEvent, status: CalendarEventStatus, scope: CalendarRecurrenceScope) {
    if (scope === 'single') return this.saveSingleRecurrenceOverride(event, { ...event, status, recurrence: null });
    if (scope === 'future') return this.splitRecurringSeries(event, { ...event, status });
    const { master, overrides } = await this.recurrenceContext(event);
    const now = Date.now();
    await this.b.update('calendarEvents', [
      { rowNumber: master.rowNumber, values: { status, updatedAt: now }, expectId: master.id },
      ...overrides.map((override) => ({ rowNumber: override.rowNumber, values: { status, updatedAt: now }, expectId: override.id })),
    ]);
  }

  async deleteRecurringEvent(event: CalendarEvent, scope: CalendarRecurrenceScope) {
    const { master, overrides, key } = await this.recurrenceContext(event);
    const now = Date.now();
    if (scope === 'single') {
      const exceptions = [...new Set([...master.recurrenceExceptions, key])].sort();
      const updates: RowUpdate[] = [{ rowNumber: master.rowNumber, values: { exceptions: JSON.stringify(exceptions), updatedAt: now }, expectId: master.id }];
      if (event.recurrenceOverride) updates.push({ rowNumber: event.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: event.id });
      await this.b.update('calendarEvents', updates);
      return;
    }
    if (scope === 'all') {
      await this.b.update('calendarEvents', [
        { rowNumber: master.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: master.id },
        ...overrides.map((override) => ({ rowNumber: override.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: override.id })),
      ]);
      return;
    }
    const beforeCount = calendarRecurrenceDates(master.recurrence!, master.startDate, master.startDate, addDateDays(key, -1)).length;
    const originalValues: RowValues = beforeCount
      ? { recurrence: serializeCalendarRecurrence({ ...master.recurrence!, end: 'count', count: beforeCount }), exceptions: JSON.stringify(master.recurrenceExceptions.filter((date) => date < key)), updatedAt: now }
      : { deletedAt: now, updatedAt: now };
    await this.b.update('calendarEvents', [
      { rowNumber: master.rowNumber, values: originalValues, expectId: master.id },
      ...overrides.filter((override) => override.recurrenceInstanceKey! >= key).map((override) => ({ rowNumber: override.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: override.id })),
    ]);
  }

  /** 主行程改期：together = 所有細項依相同天數平移；onlyParent = 只改主行程。（2026-11-19 使用者決定） */
  async updateTrip(event: CalendarEvent, input: CalendarEventInput, mode: 'together' | 'onlyParent') {
    if (event.recurrence || input.recurrence) throw new Error('重複行程不能當作主行程');
    validateEvent(input);
    const prepared = prepareEventInput(input, event);
    validatePreparedEvent(prepared);
    const snap = await this.load();
    const children = snap.events.filter((e) => e.parentEventId === event.id);
    const updates: RowUpdate[] = [{ rowNumber: event.rowNumber, values: { ...eventValues(prepared), updatedAt: Date.now() }, expectId: event.id }];
    if (mode === 'together') {
      const delta = dateDiffDays(event.startDate, prepared.startDate);
      for (const child of children) {
        const moved = prepareEventInput({ ...child, startDate: addDateDays(child.startDate, delta), endDate: addDateDays(child.endDate, delta) }, child);
        validatePreparedEvent(moved);
        updates.push({ rowNumber: child.rowNumber, values: { ...eventValues(moved), updatedAt: Date.now() }, expectId: child.id });
      }
    }
    await this.b.update('calendarEvents', updates);
    await this.rememberTimeZones(prepared);
  }

  /** 只改主行程時，超出新期間的細項逐筆移入 / 解除 / 取消。（2026-11-19 使用者決定） */
  async updateTripSelective(event: CalendarEvent, input: CalendarEventInput, actions: TripChildAction[]) {
    if (event.recurrence || input.recurrence) throw new Error('重複行程不能當作主行程');
    validateEvent(input);
    const prepared = prepareEventInput(input, event);
    validatePreparedEvent(prepared);
    const snap = await this.load();
    const now = Date.now();
    const updates: RowUpdate[] = [{ rowNumber: event.rowNumber, values: { ...eventValues(prepared), updatedAt: now }, expectId: event.id }];
    for (const item of actions) {
      if (item.action === 'move') {
        if (!item.startDate || !item.endDate || !DATE_RE.test(item.startDate) || !DATE_RE.test(item.endDate)) throw new Error('請填細項的新日期');
        if (item.startDate < prepared.startDate || item.endDate > prepared.endDate || item.endDate < item.startDate) throw new Error('細項的新日期必須在主行程期間內');
        const current = snap.events.find((candidate) => candidate.id === item.event.id);
        if (!current) throw new Error('找不到要移動的細項');
        const moved = prepareEventInput({ ...current, startDate: item.startDate, endDate: item.endDate }, current);
        validatePreparedEvent(moved);
        updates.push({ rowNumber: item.event.rowNumber, values: { ...eventValues(moved), updatedAt: now }, expectId: item.event.id });
      } else if (item.action === 'detach') {
        updates.push({ rowNumber: item.event.rowNumber, values: { parentEventId: null, updatedAt: now }, expectId: item.event.id });
      } else {
        updates.push({ rowNumber: item.event.rowNumber, values: { status: 'cancelled', updatedAt: now }, expectId: item.event.id });
      }
    }
    await this.b.update('calendarEvents', updates);
    await this.rememberTimeZones(prepared);
  }

  async detachEvent(event: Pick<CalendarEvent, 'rowNumber' | 'id'>) {
    await this.b.update('calendarEvents', [{ rowNumber: event.rowNumber, values: { parentEventId: null, updatedAt: Date.now() }, expectId: event.id }]);
  }

  /** 把一或多筆既有一般行程加入主行程；日期可在確認畫面修正，但儲存時必須完整落在期間內。 */
  async attachEventsToTrip(parent: CalendarEvent, actions: TripAttachAction[]) {
    if (parent.parentEventId || parent.recurrence || parent.endDate <= parent.startDate || parent.systemSource) throw new Error('這筆不是可用的主行程');
    const snap = await this.load();
    const now = Date.now();
    const updates: RowUpdate[] = [];
    for (const action of actions) {
      const current = snap.events.find((item) => item.id === action.event.id);
      if (!current || current.systemSource || current.parentEventId || current.recurrence || current.id === parent.id) throw new Error('選取的行程已不能加入');
      const endDate = current.timeType === 'point' ? action.startDate : action.endDate;
      if (!DATE_RE.test(action.startDate) || !DATE_RE.test(endDate) || endDate < action.startDate) throw new Error(`「${current.title}」的日期不正確`);
      if (action.startDate < parent.startDate || endDate > parent.endDate) throw new Error(`「${current.title}」的日期必須在主行程的 ${parent.startDate}～${parent.endDate} 之內`);
      const moved = prepareEventInput({ ...current, parentEventId: parent.id, startDate: action.startDate, endDate }, current);
      validatePreparedEvent(moved);
      updates.push({ rowNumber: current.rowNumber, values: { ...eventValues(moved), updatedAt: now }, expectId: current.id });
    }
    if (updates.length) await this.b.update('calendarEvents', updates);
  }

  /** 細項移到另一個主行程時只改關聯，不改日期或其他內容。 */
  async moveEventToTrip(event: CalendarEvent, parentId: string) {
    if (!event.parentEventId || event.systemSource) throw new Error('這筆不是可移動的細項');
    const snap = await this.load();
    const parent = snap.events.find((item) => item.id === parentId);
    if (!parent || parent.parentEventId || parent.recurrence || parent.endDate <= parent.startDate || parent.systemSource || parent.status !== 'scheduled') throw new Error('找不到可用的主行程');
    if (event.startDate < parent.startDate || event.endDate > parent.endDate) throw new Error(`細項日期必須在主行程的 ${parent.startDate}～${parent.endDate} 之內`);
    await this.b.update('calendarEvents', [{ rowNumber: event.rowNumber, values: { parentEventId: parent.id, updatedAt: Date.now() }, expectId: event.id }]);
  }

  /** 取消整趟會連同細項；只取消主行程會解除細項。（2026-11-19 使用者決定） */
  async cancelEvent(event: CalendarEvent, wholeTrip: boolean) {
    if (event.systemSource) throw new Error('系統行程不能取消');
    const snap = await this.load();
    const updates: RowUpdate[] = [{ rowNumber: event.rowNumber, values: { status: 'cancelled', updatedAt: Date.now() }, expectId: event.id }];
    const children = snap.events.filter((e) => e.parentEventId === event.id);
    for (const child of children) {
      updates.push({ rowNumber: child.rowNumber, values: wholeTrip ? { status: 'cancelled', updatedAt: Date.now() } : { parentEventId: null, updatedAt: Date.now() }, expectId: child.id });
    }
    await this.b.update('calendarEvents', updates);
  }

  async restoreEvent(event: Pick<CalendarEvent, 'rowNumber' | 'id'>) {
    if ((event as CalendarEvent).systemSource) throw new Error('系統行程不能修改');
    await this.b.update('calendarEvents', [{ rowNumber: event.rowNumber, values: { status: 'scheduled', updatedAt: Date.now() }, expectId: event.id }]);
  }

  async deleteEvent(event: CalendarEvent) {
    if (event.systemSource) throw new Error('系統行程不能刪除');
    const snap = await this.load();
    if (snap.events.some((e) => e.parentEventId === event.id)) throw new Error('請先解除所有細項，再刪除主行程');
    const now = Date.now();
    await this.b.update('calendarEvents', [{ rowNumber: event.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: event.id }]);
  }
}
