import { afterEach, describe, expect, it, vi } from 'vitest';
import { estimateTwdAmount, fetchReferenceRate } from '../src/exchange-rates';

afterEach(() => vi.unstubAllGlobals());

describe('外幣參考匯率', () => {
  const rate = (date: string, rate: number, base = 'JPY') => ({ base, quote: 'TWD', date, rate });

  it('查交易日及之前的日期並選同幣別最近一筆有效報價', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json([
      rate('2026-11-20', 0.21),
      rate('2026-11-24', 0.22),
      rate('2026-11-23', 0.23, 'USD'),
      rate('2026-11-22', 0),
      rate('2026-11-19', 0.20),
    ]));
    vi.stubGlobal('fetch', fetch);

    await expect(fetchReferenceRate('JPY', '2026-11-23', new AbortController().signal))
      .resolves.toEqual({ date: '2026-11-20', rate: 0.21 });
    expect(new URL(fetch.mock.calls[0][0]).searchParams.toString())
      .toBe('base=JPY&quotes=TWD&from=2026-11-09&to=2026-11-23');
    expect(fetch.mock.calls[0][1].credentials).toBe('omit');
  });

  it('當日有牌價時優先使用當日，查無資料時留空', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json([rate('2026-11-22', 0.21), rate('2026-11-23', 0.215)]))
      .mockResolvedValueOnce(Response.json([])));
    const { signal } = new AbortController();
    await expect(fetchReferenceRate('JPY', '2026-11-23', signal))
      .resolves.toEqual({ date: '2026-11-23', rate: 0.215 });
    await expect(fetchReferenceRate('JPY', '2026-11-23', signal)).resolves.toBeNull();
  });

  it('四捨五入到台幣整元並支援退款；零元和不合法的結果留空', () => {
    expect(estimateTwdAmount(1_000, 0.2156)).toBe(216);
    expect(estimateTwdAmount(-1_000, 0.215)).toBe(215);
    expect(estimateTwdAmount(1, 0.21)).toBeNull();
    expect(estimateTwdAmount(0, 0.21)).toBeNull();
    expect(estimateTwdAmount(1_000, -0.21)).toBeNull();
  });
});
