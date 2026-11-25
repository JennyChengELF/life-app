import { recurrenceAddDays } from './calendar-recurrence';
import { resolveCalendarLocalTime } from './calendar-time';
import type { CalendarEventInput } from './calendar';

export const CALENDAR_REMINDER_UNITS = { minutes: '分鐘', hours: '小時', days: '天', weeks: '週' } as const;
export type CalendarReminderUnit = keyof typeof CALENDAR_REMINDER_UNITS;
export type CalendarReminder =
  | { kind: 'start' }
  | { kind: 'before'; amount: number; unit: CalendarReminderUnit }
  | { kind: 'custom'; dayOffset: number; time: string };

export const CALENDAR_REMINDER_LIMITS: Record<CalendarReminderUnit, number> = {
  minutes: 525600, hours: 8760, days: 365, weeks: 52,
};

export function parseCalendarReminders(value: unknown): CalendarReminder[] {
  if (value == null || value === '') return [];
  const items: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(items)) throw new Error('提醒設定格式不正確');
  const rules = new Map<string, CalendarReminder>();
  for (const item of items) {
    let rule: CalendarReminder;
    if (item?.kind === 'start') rule = { kind: 'start' };
    else if (item?.kind === 'before' && Object.hasOwn(CALENDAR_REMINDER_LIMITS, item.unit) &&
      Number.isInteger(item.amount) && item.amount >= 1 && item.amount <= CALENDAR_REMINDER_LIMITS[item.unit as CalendarReminderUnit]) {
      rule = { kind: 'before', unit: item.unit, amount: item.amount };
    } else if (item?.kind === 'custom' && Number.isInteger(item.dayOffset) &&
      Math.abs(item.dayOffset) <= 365 && typeof item.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.time)) {
      rule = { kind: 'custom', dayOffset: item.dayOffset, time: item.time };
    } else throw new Error('請填正確的提醒日期、時間或提前量');
    rules.set(JSON.stringify(rule), rule);
  }
  return [...rules.values()];
}

export function calendarReminderLeadDays(rule: CalendarReminder): number {
  if (rule.kind === 'custom') return -rule.dayOffset;
  if (rule.kind === 'start') return 0;
  if (rule.unit === 'weeks') return rule.amount * 7;
  if (rule.unit === 'days') return rule.amount;
  return Math.ceil(rule.amount / (rule.unit === 'hours' ? 24 : 1440));
}

export function calendarReminderTime(event: CalendarEventInput, rule: CalendarReminder, homeZone: string, currentZone: string) {
  const zone = event.timeType === 'allDay' ? homeZone
    : event.timeMode === 'floatingLocal' ? currentZone : event.startTimeZone ?? homeZone;
  if (rule.kind === 'custom') {
    return resolveCalendarLocalTime(recurrenceAddDays(event.startDate, rule.dayOffset), rule.time, zone).epochMilliseconds;
  }
  if (!event.startTime || event.timeType === 'allDay') throw new Error('全天行程請用指定日期與時間的提醒');
  if (rule.kind === 'before' && (rule.unit === 'days' || rule.unit === 'weeks')) {
    const days = calendarReminderLeadDays(rule);
    return resolveCalendarLocalTime(recurrenceAddDays(event.startDate, -days), event.startTime, zone, event.startDisambiguation).epochMilliseconds;
  }
  const start = resolveCalendarLocalTime(event.startDate, event.startTime, zone, event.startDisambiguation, event.startUtcOffset, event.timeMode === 'fixedZone');
  const minutes = rule.kind === 'start' ? 0 : rule.amount * (rule.unit === 'hours' ? 60 : 1);
  return start.epochMilliseconds - minutes * 60000;
}

export function calendarReminderLabel(rule: CalendarReminder, startDate: string) {
  if (rule.kind === 'start') return '行程開始時';
  if (rule.kind === 'before') return `提前 ${rule.amount} ${CALENDAR_REMINDER_UNITS[rule.unit]}`;
  return `${recurrenceAddDays(startDate, rule.dayOffset)} ${rule.time}`;
}
