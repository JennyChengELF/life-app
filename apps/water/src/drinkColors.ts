import type { Drink } from '@life/db';

/** 依飲品清單順序配色：第一個（開水）是藍色 */
const PALETTE = ['#1e88e5', '#f59e0b', '#8b5cf6', '#10b981', '#ec4899', '#a16207', '#0891b2', '#dc2626'];
const UNKNOWN = '#94a3b8';

export function drinkColor(name: string, drinks: Drink[]): string {
  const i = drinks.findIndex((d) => d.name === name);
  return i < 0 ? UNKNOWN : PALETTE[i % PALETTE.length];
}

/** 依飲品加總，順序照清單，清單外的放最後 */
export function totalsByDrink(items: { drink: string; ml: number }[], drinks: Drink[]) {
  const m = new Map<string, number>();
  for (const it of items) m.set(it.drink, (m.get(it.drink) ?? 0) + it.ml);
  const order = (n: string) => {
    const i = drinks.findIndex((d) => d.name === n);
    return i < 0 ? 999 : i;
  };
  return [...m.entries()].map(([drink, ml]) => ({ drink, ml })).sort((a, b) => order(a.drink) - order(b.drink));
}
