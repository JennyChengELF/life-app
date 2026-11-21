import { describe, expect, it } from 'vitest';
import { toHHmm, toInputDateTime } from '../src';

describe('時間顯示', () => {
  it('一律顯示 24 小時制 HH:mm，不包含上午、下午或秒數', () => {
    const morning = new Date(2026, 10, 21, 7, 5, 42).getTime();
    const evening = new Date(2026, 10, 21, 19, 5, 42).getTime();

    expect(toHHmm(morning)).toBe('07:05');
    expect(toHHmm(evening)).toBe('19:05');
  });

  it('日期時間輸入值使用 24 小時制且不帶秒數', () => {
    const time = new Date(2026, 10, 21, 19, 5, 42).getTime();

    expect(toInputDateTime(time)).toBe('2026-11-21T19:05');
  });
});
