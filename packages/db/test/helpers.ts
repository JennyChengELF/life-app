import type { MoneyStore } from '../src';

/**
 * 測試用的分類（2026-11-18 預設分類改成只有第一層之後，測試自己建子分類）
 */
export async function addTestCategories(store: MoneyStore) {
  await store.ensureCategories(['食 / 三餐', '食 / 飲料點心', '食 / 食材', '住 / 日用品', '樂 / 娛樂', '人情', '人情 / 送禮'], '支出');
  await store.load();
}
