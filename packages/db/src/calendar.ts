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
import { TAIWAN_CALENDAR_GROUP_NAME, TAIWAN_CALENDAR_GROUP_SOURCE, taiwanSpecialDays } from './taiwan-calendar';

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
  const fixedTimeZone = input.timeType !== 'allDay' && input.timeMode === 'fixedZone';
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

  async load(now = Date.now()): Promise<CalendarSnapshot> {
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
      const timeMode: CalendarTimeMode = str(r.values.timeMode) === 'floatingLocal' ? 'floatingLocal' : 'fixedZone';
      const locationType = (['place', 'route', 'online'].includes(str(r.values.locationType) ?? '') ? str(r.values.locationType) : null) as CalendarLocationType;
      let startTimeZone: string | null = null;
      let endTimeZone: string | null = null;
      let startUtcOffset: string | null = null;
      let endUtcOffset: string | null = null;
      const startDisambiguation: CalendarTimeDisambiguation = str(r.values.startDisambiguation) === 'later' ? 'later' : 'earlier';
      const endDisambiguation: CalendarTimeDisambiguation = str(r.values.endDisambiguation) === 'later' ? 'later' : 'earlier';
      let timeZoneInferred = false;

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
      events.push({
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
        createdVia: str(r.values.createdVia) ?? 'sheet',
        createdAt: num(r.values.createdAt, now),
        updatedAt: num(r.values.updatedAt, now),
        titleMissing,
        systemSource: null,
      });
    }
    if (eventFixes.length) await this.b.update('calendarEvents', eventFixes);
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
        });
      }
    }
    return { loadedAt: now, groups, events: sortCalendarEvents(events), defaultGroupId, homeTimeZone, currentTimeZone, lastDetectedTimeZone, recentTimeZones, timeZoneRulesUpdated, issues };
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
    }
    const now = Date.now();
    await this.b.append('calendarEvents', [{ ...eventValues(prepared), createdVia: this.via, id, createdAt: now, updatedAt: now }]);
    await this.rememberTimeZones(prepared);
    return id;
  }

  async updateEvent(event: Pick<CalendarEvent, 'rowNumber' | 'id'>, input: CalendarEventInput) {
    if ((event as CalendarEvent).systemSource) throw new Error('系統行程不能在這裡修改');
    validateEvent(input);
    const snap = await this.load();
    const prepared = prepareEventInput(input, snap.events.find((item) => item.id === event.id));
    validatePreparedEvent(prepared);
    if (prepared.parentEventId) {
      const parent = snap.events.find((item) => item.id === prepared.parentEventId);
      if (!parent) throw new Error('找不到主行程');
      const endDate = prepared.timeType === 'point' ? prepared.startDate : prepared.endDate;
      if (prepared.startDate < parent.startDate || endDate > parent.endDate) throw new Error(`細項日期必須在主行程的 ${parent.startDate}～${parent.endDate} 之內`);
    }
    await this.b.update('calendarEvents', [{ rowNumber: event.rowNumber, values: { ...eventValues(prepared), updatedAt: Date.now() }, expectId: event.id }]);
    await this.rememberTimeZones(prepared);
  }

  /** 主行程改期：together = 所有細項依相同天數平移；onlyParent = 只改主行程。（2026-11-19 使用者決定） */
  async updateTrip(event: CalendarEvent, input: CalendarEventInput, mode: 'together' | 'onlyParent') {
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
    if (parent.parentEventId || parent.endDate <= parent.startDate || parent.systemSource) throw new Error('這筆不是可用的主行程');
    const snap = await this.load();
    const now = Date.now();
    const updates: RowUpdate[] = [];
    for (const action of actions) {
      const current = snap.events.find((item) => item.id === action.event.id);
      if (!current || current.systemSource || current.parentEventId || current.id === parent.id) throw new Error('選取的行程已不能加入');
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
    if (!parent || parent.parentEventId || parent.endDate <= parent.startDate || parent.systemSource || parent.status !== 'scheduled') throw new Error('找不到可用的主行程');
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
