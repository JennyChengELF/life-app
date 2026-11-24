/**
 * 行事曆時區與日光節約時間規則。
 * 2026-11-24 使用者決定：固定行程保留所在地鐘面時間；不存在時刻要提示，重複時刻可選第一次／第二次。
 */
import { Temporal } from '@js-temporal/polyfill';

export type CalendarTimeDisambiguation = 'earlier' | 'later';
export type CalendarLocalTimeKind = 'exact' | 'ambiguous' | 'nonexistent';

export interface CalendarResolvedTime {
  epochMilliseconds: number;
  offset: string;
  date: string;
  time: string;
}

export interface CalendarLocalTimeAnalysis {
  kind: CalendarLocalTimeKind;
  earlier: CalendarResolvedTime;
  later: CalendarResolvedTime;
}

const pad = (value: number) => String(value).padStart(2, '0');
const plainText = (date: string, time: string) => `${date}T${time}`;
const resolved = (value: Temporal.ZonedDateTime): CalendarResolvedTime => ({
  epochMilliseconds: value.epochMilliseconds,
  offset: value.offset,
  date: `${value.year}-${pad(value.month)}-${pad(value.day)}`,
  time: `${pad(value.hour)}:${pad(value.minute)}`,
});

export function isValidTimeZone(timeZone: string) {
  try {
    Temporal.Now.instant().toZonedDateTimeISO(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function analyzeCalendarLocalTime(date: string, time: string, timeZone: string): CalendarLocalTimeAnalysis {
  if (!isValidTimeZone(timeZone)) throw new Error('請選擇正確的時區');
  const plain = Temporal.PlainDateTime.from(plainText(date, time));
  const earlierValue = plain.toZonedDateTime(timeZone, { disambiguation: 'earlier' });
  const laterValue = plain.toZonedDateTime(timeZone, { disambiguation: 'later' });
  const earlierMatches = plain.equals(earlierValue.toPlainDateTime());
  const laterMatches = plain.equals(laterValue.toPlainDateTime());
  const kind: CalendarLocalTimeKind = earlierValue.epochMilliseconds === laterValue.epochMilliseconds
    ? 'exact'
    : earlierMatches && laterMatches ? 'ambiguous' : 'nonexistent';
  return { kind, earlier: resolved(earlierValue), later: resolved(laterValue) };
}

export function resolveCalendarLocalTime(
  date: string,
  time: string,
  timeZone: string,
  disambiguation: CalendarTimeDisambiguation = 'earlier',
  storedOffset?: string | null,
  preserveStoredOffset = false,
): CalendarResolvedTime {
  if (preserveStoredOffset && storedOffset) {
    const value = Temporal.ZonedDateTime.from(`${plainText(date, time)}${storedOffset}[${timeZone}]`, { offset: 'use', disambiguation });
    return resolved(value);
  }
  const analysis = analyzeCalendarLocalTime(date, time, timeZone);
  if (analysis.kind === 'nonexistent') throw new Error(`當地時間 ${date} ${time} 不存在`);
  return disambiguation === 'later' ? analysis.later : analysis.earlier;
}

export function convertCalendarInstant(epochMilliseconds: number, timeZone: string): CalendarResolvedTime {
  if (!isValidTimeZone(timeZone)) throw new Error('請選擇正確的時區');
  return resolved(Temporal.Instant.fromEpochMilliseconds(epochMilliseconds).toZonedDateTimeISO(timeZone));
}

export function calendarDurationMinutes(startEpochMilliseconds: number, endEpochMilliseconds: number) {
  return Math.round((endEpochMilliseconds - startEpochMilliseconds) / 60000);
}

export function currentDeviceTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function currentDateInTimeZone(timeZone: string) {
  const value = Temporal.Now.instant().toZonedDateTimeISO(timeZone);
  return `${value.year}-${pad(value.month)}-${pad(value.day)}`;
}

export function timeZoneOffset(timeZone: string, epochMilliseconds = Date.now()) {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds).toZonedDateTimeISO(timeZone).offset;
}

const ZONE_NAMES: Record<string, string> = {
  'Asia/Taipei': '台灣・台北',
  'Asia/Tokyo': '日本・東京',
  'Asia/Seoul': '韓國・首爾',
  'Asia/Shanghai': '中國・上海',
  'Asia/Hong_Kong': '香港',
  'Asia/Singapore': '新加坡',
  'Asia/Bangkok': '泰國・曼谷',
  'Europe/London': '英國・倫敦',
  'Europe/Paris': '法國・巴黎',
  'America/New_York': '美國・紐約',
  'America/Chicago': '美國・芝加哥',
  'America/Denver': '美國・丹佛',
  'America/Los_Angeles': '美國・洛杉磯',
  'Pacific/Honolulu': '美國・檀香山',
  'Australia/Sydney': '澳洲・雪梨',
  UTC: '世界標準時間',
};

export function timeZoneLabel(timeZone: string, epochMilliseconds = Date.now()) {
  const readable = ZONE_NAMES[timeZone] ?? timeZone.replaceAll('_', ' ').replace('/', '・');
  return `${readable}（UTC${timeZoneOffset(timeZone, epochMilliseconds)}）`;
}

export function supportedTimeZones() {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
  const values = intl.supportedValuesOf?.('timeZone') ?? Object.keys(ZONE_NAMES);
  return [...new Set(['Asia/Taipei', ...values, 'UTC'])];
}

export function formatConvertedCalendarTime(value: Pick<CalendarResolvedTime, 'date' | 'time'>) {
  const [year, month, day] = value.date.split('-').map(Number);
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${year}/${pad(month)}/${pad(day)}（${weekday}） ${value.time}`;
}
