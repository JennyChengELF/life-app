import { taiwanDayInfo } from './taiwan-calendar';

/**
 * 行事曆重複規則。
 * 2026-11-24 使用者決定：每個工作日依台灣實際辦公日曆；沒有 31 日的月份跳過；每月最後一天依當月天數。
 */
export type CalendarRecurrenceFrequency = 'daily' | 'workday' | 'weekly' | 'monthlyDate' | 'monthlyWeekday' | 'monthlyLastDay' | 'yearly' | 'custom';
export type CalendarRecurrenceEnd = 'never' | 'date' | 'count';
export type CalendarRecurrenceUnit = 'day' | 'week' | 'month' | 'year';

export interface CalendarRecurrence {
  frequency: CalendarRecurrenceFrequency;
  interval: number;
  weekDays?: number[];
  monthDay?: number;
  weekOrdinal?: 1 | 2 | 3 | 4 | 5 | -1;
  weekDay?: number;
  customUnit?: CalendarRecurrenceUnit;
  end: CalendarRecurrenceEnd;
  until?: string;
  count?: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FREQUENCIES: CalendarRecurrenceFrequency[] = ['daily', 'workday', 'weekly', 'monthlyDate', 'monthlyWeekday', 'monthlyLastDay', 'yearly', 'custom'];
const ENDINGS: CalendarRecurrenceEnd[] = ['never', 'date', 'count'];
const UNITS: CalendarRecurrenceUnit[] = ['day', 'week', 'month', 'year'];
const pad = (value: number) => String(value).padStart(2, '0');

function dateParts(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

function utcDate(date: string) {
  const { year, month, day } = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day));
}

export function recurrenceAddDays(date: string, days: number) {
  const value = utcDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

function daysBetween(from: string, to: string) {
  return Math.round((utcDate(to).getTime() - utcDate(from).getTime()) / 86400000);
}

function weekday(date: string) {
  return utcDate(date).getUTCDay();
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthDistance(from: string, to: string) {
  const a = dateParts(from);
  const b = dateParts(to);
  return (b.year - a.year) * 12 + b.month - a.month;
}

function weekDistance(from: string, to: string) {
  const mondayOffset = (weekday(from) + 6) % 7;
  const firstMonday = recurrenceAddDays(from, -mondayOffset);
  return Math.floor(daysBetween(firstMonday, to) / 7);
}

function nthWeekdayOfMonth(year: number, month: number, targetWeekday: number, ordinal: number) {
  if (ordinal === -1) {
    const lastDay = daysInMonth(year, month);
    const lastWeekday = weekday(`${year}-${pad(month)}-${pad(lastDay)}`);
    return lastDay - ((lastWeekday - targetWeekday + 7) % 7);
  }
  const firstWeekday = weekday(`${year}-${pad(month)}-01`);
  const result = 1 + ((targetWeekday - firstWeekday + 7) % 7) + (ordinal - 1) * 7;
  return result <= daysInMonth(year, month) ? result : null;
}

export function parseCalendarRecurrence(value: unknown): CalendarRecurrence | null {
  if (value == null || String(value).trim() === '') return null;
  let raw: unknown = value;
  if (typeof value === 'string') {
    try { raw = JSON.parse(value); } catch { throw new Error('重複規則格式看不懂'); }
  }
  if (!raw || typeof raw !== 'object') throw new Error('重複規則格式看不懂');
  const item = raw as Record<string, unknown>;
  const frequency = String(item.frequency ?? '') as CalendarRecurrenceFrequency;
  const end = String(item.end ?? 'never') as CalendarRecurrenceEnd;
  const interval = Number(item.interval ?? 1);
  if (!FREQUENCIES.includes(frequency) || !ENDINGS.includes(end) || !Number.isInteger(interval) || interval < 1 || interval > 999) throw new Error('重複規則格式看不懂');
  const rule: CalendarRecurrence = { frequency, interval, end };
  if (frequency === 'weekly') {
    const weekDays = Array.isArray(item.weekDays) ? [...new Set(item.weekDays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort() : [];
    if (!weekDays.length) throw new Error('每週重複至少要選一天');
    rule.weekDays = weekDays;
  }
  if (frequency === 'monthlyDate') {
    const monthDay = Number(item.monthDay);
    if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) throw new Error('每月日期必須是 1～31 日');
    rule.monthDay = monthDay;
  }
  if (frequency === 'monthlyWeekday') {
    const weekOrdinal = Number(item.weekOrdinal);
    const weekDay = Number(item.weekDay);
    if (![1, 2, 3, 4, 5, -1].includes(weekOrdinal) || !Number.isInteger(weekDay) || weekDay < 0 || weekDay > 6) throw new Error('每月第幾個星期設定不正確');
    rule.weekOrdinal = weekOrdinal as CalendarRecurrence['weekOrdinal'];
    rule.weekDay = weekDay;
  }
  if (frequency === 'custom') {
    const customUnit = String(item.customUnit ?? '') as CalendarRecurrenceUnit;
    if (!UNITS.includes(customUnit)) throw new Error('自訂重複單位不正確');
    rule.customUnit = customUnit;
  }
  if (end === 'date') {
    const until = String(item.until ?? '');
    if (!DATE_RE.test(until)) throw new Error('請填重複結束日期');
    rule.until = until;
  }
  if (end === 'count') {
    const count = Number(item.count);
    if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error('重複次數必須是 1～10000');
    rule.count = count;
  }
  return rule;
}

export function serializeCalendarRecurrence(rule: CalendarRecurrence | null) {
  return rule ? JSON.stringify(parseCalendarRecurrence(rule)) : null;
}

function matches(rule: CalendarRecurrence, startDate: string, date: string) {
  if (date < startDate) return false;
  const interval = rule.interval;
  const start = dateParts(startDate);
  const current = dateParts(date);
  if (rule.frequency === 'daily') return daysBetween(startDate, date) % interval === 0;
  if (rule.frequency === 'workday') return taiwanDayInfo(date).type === 'workday';
  if (rule.frequency === 'weekly') return weekDistance(startDate, date) % interval === 0 && rule.weekDays!.includes(weekday(date));
  if (rule.frequency === 'monthlyDate') return monthDistance(startDate, date) % interval === 0 && current.day === rule.monthDay;
  if (rule.frequency === 'monthlyLastDay') return monthDistance(startDate, date) % interval === 0 && current.day === daysInMonth(current.year, current.month);
  if (rule.frequency === 'monthlyWeekday') return monthDistance(startDate, date) % interval === 0 && current.day === nthWeekdayOfMonth(current.year, current.month, rule.weekDay!, rule.weekOrdinal!);
  if (rule.frequency === 'yearly') return (current.year - start.year) % interval === 0 && current.month === start.month && current.day === start.day;
  if (rule.customUnit === 'day') return daysBetween(startDate, date) % interval === 0;
  if (rule.customUnit === 'week') return weekDistance(startDate, date) % interval === 0 && weekday(date) === weekday(startDate);
  if (rule.customUnit === 'month') return monthDistance(startDate, date) % interval === 0 && current.day === start.day;
  return (current.year - start.year) % interval === 0 && current.month === start.month && current.day === start.day;
}

export function calendarRecurrenceDates(ruleInput: CalendarRecurrence, startDate: string, fromDate: string, toDate: string) {
  const rule = parseCalendarRecurrence(ruleInput)!;
  if (!DATE_RE.test(startDate) || !DATE_RE.test(fromDate) || !DATE_RE.test(toDate) || toDate < fromDate) return [];
  const lastDate = rule.end === 'date' && rule.until! < toDate ? rule.until! : toDate;
  if (lastDate < startDate) return [];
  const result: string[] = [];
  let occurrenceCount = 0;
  let date = startDate;
  let guard = 0;
  while (date <= lastDate && guard < 200000) {
    if (matches(rule, startDate, date)) {
      occurrenceCount += 1;
      if (date >= fromDate) result.push(date);
      if (rule.end === 'count' && occurrenceCount >= rule.count!) break;
    }
    date = recurrenceAddDays(date, 1);
    guard += 1;
  }
  return result;
}

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
export function calendarRecurrenceText(rule: CalendarRecurrence) {
  if (rule.frequency === 'daily') return rule.interval === 1 ? '每天' : `每 ${rule.interval} 天`;
  if (rule.frequency === 'workday') return '每個台灣工作日';
  if (rule.frequency === 'weekly') return `${rule.interval === 1 ? '每週' : `每 ${rule.interval} 週`}（${rule.weekDays!.map((day) => `週${WEEK_LABELS[day]}`).join('、')}）`;
  if (rule.frequency === 'monthlyDate') return `${rule.interval === 1 ? '每月' : `每 ${rule.interval} 個月`} ${rule.monthDay} 日`;
  if (rule.frequency === 'monthlyLastDay') return `${rule.interval === 1 ? '每月' : `每 ${rule.interval} 個月`}最後一天`;
  if (rule.frequency === 'monthlyWeekday') return `${rule.interval === 1 ? '每月' : `每 ${rule.interval} 個月`}第${rule.weekOrdinal === -1 ? '最後一個' : rule.weekOrdinal}個週${WEEK_LABELS[rule.weekDay!]}`;
  if (rule.frequency === 'yearly') return rule.interval === 1 ? '每年' : `每 ${rule.interval} 年`;
  const units: Record<CalendarRecurrenceUnit, string> = { day: '天', week: '週', month: '個月', year: '年' };
  return `每 ${rule.interval} ${units[rule.customUnit!]}`;
}

export function calendarRecurrenceEndText(rule: CalendarRecurrence) {
  if (rule.end === 'date') return `到 ${rule.until}`;
  if (rule.end === 'count') return `共 ${rule.count} 次`;
  return '不設定結束日期';
}
