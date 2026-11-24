import { describe, expect, it } from 'vitest';
import { calendarRecurrenceDates, parseCalendarRecurrence } from '../src';

const rule = (overrides: Record<string, unknown>) => parseCalendarRecurrence({ frequency: 'daily', interval: 1, end: 'never', ...overrides })!;

describe('行事曆重複規則', () => {
  it('每週可複選星期', () => {
    expect(calendarRecurrenceDates(rule({ frequency: 'weekly', weekDays: [1, 3] }), '2026-11-23', '2026-11-23', '2026-12-06')).toEqual(['2026-11-23', '2026-11-25', '2026-11-30', '2026-12-02']);
  });

  it('每個工作日依台灣實際休假與補班', () => {
    expect(calendarRecurrenceDates(rule({ frequency: 'workday' }), '2025-02-07', '2025-02-07', '2025-02-10')).toEqual(['2025-02-07', '2025-02-08', '2025-02-10']);
    expect(calendarRecurrenceDates(rule({ frequency: 'workday' }), '2026-10-09', '2026-10-09', '2026-10-12')).toEqual(['2026-10-12']);
  });

  it('每月 31 日遇到沒有 31 日就跳過', () => {
    expect(calendarRecurrenceDates(rule({ frequency: 'monthlyDate', monthDay: 31 }), '2026-01-31', '2026-01-01', '2026-05-31')).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
  });

  it('每月最後一天會辨識平年與閏年', () => {
    expect(calendarRecurrenceDates(rule({ frequency: 'monthlyLastDay' }), '2028-01-31', '2028-01-01', '2028-03-31')).toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
  });

  it('可選每月第幾個或最後一個星期', () => {
    expect(calendarRecurrenceDates(rule({ frequency: 'monthlyWeekday', weekOrdinal: 2, weekDay: 3 }), '2026-01-14', '2026-01-01', '2026-03-31')).toEqual(['2026-01-14', '2026-02-11', '2026-03-11']);
    expect(calendarRecurrenceDates(rule({ frequency: 'monthlyWeekday', weekOrdinal: -1, weekDay: 5 }), '2026-01-30', '2026-01-01', '2026-03-31')).toEqual(['2026-01-30', '2026-02-27', '2026-03-27']);
  });

  it('指定次數與指定日期都包含第一次', () => {
    expect(calendarRecurrenceDates(rule({ end: 'count', count: 3 }), '2026-11-24', '2026-01-01', '2027-01-01')).toEqual(['2026-11-24', '2026-11-25', '2026-11-26']);
    expect(calendarRecurrenceDates(rule({ end: 'date', until: '2026-11-26' }), '2026-11-24', '2026-01-01', '2027-01-01')).toEqual(['2026-11-24', '2026-11-25', '2026-11-26']);
  });

  it('自訂間隔與每年閏日會跳過不存在日期', () => {
    expect(calendarRecurrenceDates(rule({ frequency: 'custom', interval: 2, customUnit: 'week' }), '2026-11-24', '2026-11-24', '2027-01-01')).toEqual(['2026-11-24', '2026-12-08', '2026-12-22']);
    expect(calendarRecurrenceDates(rule({ frequency: 'yearly' }), '2028-02-29', '2028-01-01', '2033-01-01')).toEqual(['2028-02-29', '2032-02-29']);
  });
});
