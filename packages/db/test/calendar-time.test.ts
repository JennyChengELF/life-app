import { describe, expect, it } from 'vitest';
import {
  analyzeCalendarLocalTime,
  calendarDurationMinutes,
  convertCalendarInstant,
  resolveCalendarLocalTime,
  timeZoneLabel,
} from '../src';

describe('行事曆時區', () => {
  it('一般當地時間只有一個實際時刻', () => {
    const result = analyzeCalendarLocalTime('2026-04-01', '10:00', 'America/New_York');
    expect(result.kind).toBe('exact');
    expect(result.earlier).toMatchObject({ offset: '-04:00', date: '2026-04-01', time: '10:00' });
  });

  it('春季跳時的不存在時間會辨識並提供往後調整時間', () => {
    const result = analyzeCalendarLocalTime('2026-03-08', '02:30', 'America/New_York');
    expect(result.kind).toBe('nonexistent');
    expect(result.later).toMatchObject({ date: '2026-03-08', time: '03:30', offset: '-04:00' });
    expect(() => resolveCalendarLocalTime('2026-03-08', '02:30', 'America/New_York')).toThrow('不存在');
  });

  it('秋季重複時間預設第一次，也能選第二次', () => {
    const result = analyzeCalendarLocalTime('2026-11-01', '01:30', 'America/New_York');
    expect(result.kind).toBe('ambiguous');
    expect(result.earlier.offset).toBe('-04:00');
    expect(result.later.offset).toBe('-05:00');
    expect(result.later.epochMilliseconds - result.earlier.epochMilliseconds).toBe(3600000);
  });

  it('跨國交通依兩端時區計算實際時間', () => {
    const departure = resolveCalendarLocalTime('2026-09-19', '09:00', 'Asia/Taipei');
    const arrival = resolveCalendarLocalTime('2026-09-19', '13:30', 'Asia/Tokyo');
    expect(calendarDurationMinutes(departure.epochMilliseconds, arrival.epochMilliseconds)).toBe(210);
    expect(convertCalendarInstant(departure.epochMilliseconds, 'Asia/Tokyo')).toMatchObject({ date: '2026-09-19', time: '10:00' });
  });

  it('時區標籤包含地點與當下 UTC 位移', () => {
    expect(timeZoneLabel('Asia/Taipei', Date.UTC(2026, 0, 1))).toBe('台灣・台北（UTC+08:00）');
  });
});
