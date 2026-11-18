import { describe, expect, it } from 'vitest';
import { HubStore, LocalBackend, memoryStorage, parseKeyList, resolvePinned } from '../src';

describe('綜合首頁的常用按鈕', () => {
  it('沒設定過用預設；設定過照設定（包括一個都不放）；不認得的略過', () => {
    expect(resolvePinned(null, ['a', 'b', 'c'], ['a', 'b'])).toEqual(['a', 'b']);
    expect(resolvePinned(['c', 'x', 'a'], ['a', 'b', 'c'], ['a'])).toEqual(['c', 'a']);
    expect(resolvePinned([], ['a'], ['a'])).toEqual([]);
    expect(parseKeyList(' a, b ,a,')).toEqual(['a', 'b']);
  });

  it('存進試算表、再讀出來', async () => {
    const s = new HubStore(new LocalBackend(memoryStorage()));
    expect((await s.load()).settings.pinned).toBeNull();
    await s.savePinned(['water', 'bowelNew']);
    expect((await s.load()).settings.pinned).toEqual(['water', 'bowelNew']);
    await s.savePinned([]);
    expect((await s.load()).settings.pinned).toEqual([]);
  });
});
