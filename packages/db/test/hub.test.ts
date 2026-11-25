import { describe, expect, it } from 'vitest';
import { HUB_TIMELINE_OPTIONS, HubStore, LocalBackend, memoryStorage, parseKeyList, resolvePinned } from '../src';

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

describe('綜合首頁的更多', () => {
  it('時間軸預設全選，可持續記住選項及全部取消', async () => {
    const backend = new LocalBackend(memoryStorage());
    const store = new HubStore(backend);
    expect((await store.load()).settings.timelineKinds).toEqual(HUB_TIMELINE_OPTIONS.map(([key]) => key));
    await store.savePinned(['water']);
    await store.saveTimelineKinds(['water', 'money']);
    expect((await new HubStore(backend).load()).settings).toEqual({ pinned: ['water'], timelineKinds: ['water', 'money'] });
    await store.saveTimelineKinds([]);
    expect((await new HubStore(backend).load()).settings.timelineKinds).toEqual([]);
  });

  it('人物表包含直接輸入及停用的人物，略過已刪除的列', async () => {
    const backend = new LocalBackend(memoryStorage());
    await backend.appendRaw('hubPeople', { name: '測試甲', fullName: '假資料', archived: true });
    await backend.appendRaw('hubPeople', { name: '測試乙', deletedAt: Date.now() });
    expect(await new HubStore(backend).loadPeople()).toEqual([
      expect.objectContaining({ nickname: '測試甲', fullName: '假資料', archived: true }),
    ]);
  });
});
