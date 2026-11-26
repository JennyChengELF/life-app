import { describe, expect, it } from 'vitest';
import { availableMedBatches, canPickMed, defaultMedMode, LocalBackend, MedStore, memoryStorage, newId, parseDateTimeText, type MedItemInput } from '../src';

const chinese: MedItemInput = { name: '測試中藥', kind: '中藥', unit: '包', mode: 'batch', note: '' };
const supplement: MedItemInput = { name: '測試保健品', kind: '保健品', unit: '粒', mode: 'total', note: '' };
const date = '2026-11-25';
const time = parseDateTimeText('2026-11-26 01:10')!;
const dose = (itemId: string, quantity: number, batchId: string | null = null) =>
  ({ itemId, quantity, time, date, batchId, skipStock: false });
const batch = (itemId: string, quantity: number, id = newId()) =>
  ({ id, itemId, quantity, receivedDate: date, expiryDate: '', ingredients: '測試成分' });

describe('用藥紀錄與庫存', () => {
  it('同次服用可儲存多個品項，保留跨午夜的實際時間和歸屬日期', async () => {
    const store = new MedStore(new LocalBackend(memoryStorage()));
    expect(defaultMedMode('中藥')).toBe('batch');
    expect(defaultMedMode('西藥')).toBe('total');
    await store.saveItem(newId(), chinese);
    await store.saveItem(newId(), supplement, undefined, 20);
    const data = await store.load();
    const herb = data.items.find((item) => item.kind === '中藥')!;
    const vitamins = data.items.find((item) => item.kind === '保健品')!;
    const supply = batch(herb.id, 4);
    await store.saveStock(newId(), { batches: [supply] });
    await store.saveLogs(newId(), [dose(herb.id, 1), dose(vitamins.id, 2)]);
    const after = await store.load();
    expect(after.logs).toHaveLength(2);
    expect(after.logs.every((log) => log.date === date && log.time === time)).toBe(true);
    expect(after.batches[0]).toMatchObject({ id: supply.id, received: 4, used: 1, remaining: 3 });
    expect(after.items.find((item) => item.id === vitamins.id)?.remaining).toBe(18);
  });

  it('新選項限有量批次，無庫存先待補，補上新批後只扣一次', async () => {
    const backend = new LocalBackend(memoryStorage());
    const store = new MedStore(backend);
    await store.saveItem(newId(), chinese);
    const item = (await store.load()).items[0];
    const empty = batch(item.id, 1);
    await store.saveStock(newId(), { batches: [empty] });
    await store.saveLogs(newId(), [dose(item.id, 1, empty.id)]);
    expect(availableMedBatches((await store.load()).batches, item.id)).toEqual([]);
    await expect(store.saveLogs(newId(), [dose(item.id, 1, empty.id)])).rejects.toThrow('已無庫存');
    await store.saveLogs(newId(), [dose(item.id, 1)]);
    const pending = (await store.load()).logs.find((log) => log.stockEffect === 'pending')!;
    expect(pending.batchId).toBeNull();
    const newBatch = batch(item.id, 21);
    const command = newId();
    const edit = () => store.saveLogs(command, [dose(item.id, 1, newBatch.id)], { batches: [newBatch] }, pending.id);
    await edit();
    await edit();
    const after = await store.load();
    expect(after.batches).toHaveLength(2);
    expect(after.batches.find((b) => b.id === newBatch.id)?.remaining).toBe(20);
    expect(after.batches.find((b) => b.id === empty.id)?.remaining).toBe(0);
  });

  it('有多個可用批次時必須選，仍可編輯已選的零庫存批次', async () => {
    const store = new MedStore(new LocalBackend(memoryStorage()));
    await store.saveItem(newId(), chinese);
    const item = (await store.load()).items[0];
    const first = batch(item.id, 2);
    const second = batch(item.id, 3);
    await store.saveStock(newId(), { batches: [first, second] });
    await expect(store.saveLogs(newId(), [dose(item.id, 1)])).rejects.toThrow('請選擇');
    await store.saveLogs(newId(), [dose(item.id, 2, first.id)]);
    const log = (await store.load()).logs[0];
    await store.saveLogs(newId(), [dose(item.id, 1, first.id)], {}, log.id);
    expect((await store.load()).batches.find((entry) => entry.id === first.id)?.remaining).toBe(1);
  });

  it('超出庫存可存、修改回算、刪除回補，補登可不扣量', async () => {
    const store = new MedStore(new LocalBackend(memoryStorage()));
    await store.saveItem(newId(), supplement, undefined, 1);
    const item = (await store.load()).items[0];
    await store.saveLogs(newId(), [dose(item.id, 2)]);
    const first = await store.load();
    expect(first.items[0].remaining).toBe(-1);
    expect(canPickMed(first.items[0])).toBe(false);
    const { id } = first.logs[0];
    await store.saveLogs(newId(), [dose(item.id, 1)], {}, id);
    expect((await store.load()).items[0].remaining).toBe(0);
    await store.saveLogs(newId(), [{ ...dose(item.id, 3), skipStock: true }]);
    await store.remove(newId(), 'medLogs', id);
    expect((await store.load()).items[0].remaining).toBe(1);
  });

  it('常用組合編輯可補庫存和建立新批次，組合仍只存品項與劑量', async () => {
    const store = new MedStore(new LocalBackend(memoryStorage()));
    await store.saveItem(newId(), chinese);
    await store.saveItem(newId(), supplement);
    const snap = await store.load();
    const herb = snap.items.find((i) => i.kind === '中藥')!;
    const vitamins = snap.items.find((i) => i.kind === '保健品')!;
    const entries = [dose(herb.id, 1), dose(vitamins.id, 2)];
    await store.saveCombo(newId(), '假日', entries);
    const { id } = (await store.load()).combos[0];
    const changes = { batches: [batch(herb.id, 10)], additions: [{ itemId: vitamins.id, batchId: null, quantity: 5 }] };
    await store.saveCombo(newId(), '假日早上', entries, changes, id);
    const after = await store.load();
    expect(after.combos[0].entries).toEqual([{ itemId: herb.id, quantity: 1 }, { itemId: vitamins.id, quantity: 2 }]);
    expect(after.batches[0].remaining).toBe(10);
    expect(after.items.find((i) => i.id === vitamins.id)?.remaining).toBe(5);
    expect(after.logs).toEqual([]);
  });

  it('只記服用轉成累加，舊紀錄和切換前補登均不扣新的 500 顆', async () => {
    const store = new MedStore(new LocalBackend(memoryStorage()));
    await store.saveItem(newId(), { ...supplement, mode: 'none' });
    const item = (await store.load()).items[0];
    expect(canPickMed(item)).toBe(true);
    const earlier = Date.now() - 86400000;
    await store.saveLogs(newId(), [{ ...dose(item.id, 2), time: earlier }]);
    await store.saveItem(newId(), supplement, item.id, 500);
    await store.saveLogs(newId(), [{ ...dose(item.id, 2), time: earlier + 1000 }]);
    await store.saveLogs(newId(), [{ ...dose(item.id, 2), time: Date.now() + 1000 }]);
    const snap = await store.load();
    expect(snap.items[0]).toMatchObject({ remaining: 498, received: 500, used: 2 });
    expect(snap.logs.map((log) => log.stockEffect)).toEqual(['total', 'none', 'none']);
  });

  it('不完整的試算表資料列出問題，合法的手填紀錄自動補系統欄位', async () => {
    const backend = new LocalBackend(memoryStorage());
    const store = new MedStore(backend);
    await store.saveItem(newId(), supplement, undefined, 5);
    const item = (await store.load()).items[0];
    await backend.appendRaw('medLogs', { itemId: item.id, time, quantity: 2 });
    await backend.appendRaw('medLogs', { time, quantity: -1 });
    const snap = await store.load();
    expect(snap.logs[0]).toMatchObject({ date: '2026-11-26', stockEffect: 'total' });
    expect(snap.items[0].remaining).toBe(3);
    expect(snap.issues).toMatchObject([{ table: 'medLogs', rowNumber: 3 }]);
    expect((await backend.read('medLogs'))[0].values.id).toBe(snap.logs[0].id);
  });

  it('儲存驗證失敗時不會先寫入批次或扣庫存', async () => {
    const store = new MedStore(new LocalBackend(memoryStorage()));
    await store.saveItem(newId(), chinese);
    const item = (await store.load()).items[0];
    const supply = batch(item.id, 21);
    await expect(store.saveLogs(newId(), [dose(item.id, 0, supply.id)], { batches: [supply] })).rejects.toThrow();
    expect(await store.load()).toMatchObject({ batches: [], logs: [] });
  });
});
