import type { RowValues } from './backend';
import type { TableName } from './schema';
import { newId } from './ids';
import { parseDateText } from './time';
import {
  blankAsset, blankInvestEvent, InvestStore, validateInvest, type InvestAsset, type InvestEvent, type InvestKind,
} from './invest';

const label: Record<string, InvestKind> = {
  '買': 'buy', '賣': 'sell', '基金買': 'buy', '基金贖回': 'redeem', '股利': 'dividend',
  '基金配息': 'dividend', '配股': 'stockDividend',
};

export const INVEST_PASTE_SHEETS = {
  investPasteStockBuy: '買', investPasteStockSell: '賣', investPasteFundBuy: '基金買',
  investPasteFundRedeem: '基金贖回', investPasteStockDividend: '股利',
  investPasteFundDividend: '基金配息', investPasteStockShares: '配股', investPaste: '',
} as const satisfies Partial<Record<TableName, string>>;
type PasteSheet = keyof typeof INVEST_PASTE_SHEETS;
const pasteSheets = Object.keys(INVEST_PASTE_SHEETS) as PasteSheet[];

export interface InvestImportRow {
  table: PasteSheet;
  rowNumber: number;
  event: InvestEvent | null;
  asset: InvestAsset | null;
  errors: string[];
  duplicate: boolean;
  sourceId: string;
  rawKey: string;
}

const key = (e: InvestEvent) => JSON.stringify([
  e.kind, e.asset, e.tradeDate || e.cashDate, e.quantity, e.price, e.cashAmount, e.exDate, e.perUnit,
]);

export async function previewInvestImport(store: InvestStore): Promise<InvestImportRow[]> {
  const [snap, inputs] = await Promise.all([store.load(),
    Promise.all(pasteSheets.map(async (table) => ({ table, rows: await store.backend.read(table) })))]);
  const assets = [...snap.assets];
  const seen = new Set(snap.events.map(key));
  return inputs.flatMap(({ table, rows }) => rows.filter((r) => !r.empty && !r.values.deletedAt).map(({ rowNumber, values: v, errors }) => {
    const item: InvestImportRow = {
      table, rowNumber, event: null, asset: null, errors: errors.length ? [`欄位格式有誤：${errors.join('、')}`] : [],
      duplicate: false, sourceId: String(v.id ?? ''), rawKey: JSON.stringify(v),
    };
    const raw = INVEST_PASTE_SHEETS[table] || String(v.kind ?? '');
    const kind = label[raw];
    const symbol = String(v.symbol ?? '').trim().toUpperCase();
    const date = parseDateText(String(v.date ?? '')) ?? '';
    if (!kind || !symbol || !date) item.errors.push('請填交易種類、日期和代號');
    if (item.errors.length) return item;
    const matches = assets.filter((a) => a.symbol === symbol && (raw.startsWith('基金') ? a.kind === 'fund' : a.kind === 'stock'));
    if (!matches.length && assets.some((a) => a.symbol === symbol && a.kind === 'pending')) {
      item.errors.push('已有相同代號的待補標的，請先在「更多 → 標的與保單」設定類型');
      return item;
    }
    if (matches.length > 1) {
      item.errors.push('同一代號有多個持有帳戶，請在投資 APP 個別補登');
      return item;
    }
    const fund = raw.startsWith('基金');
    const asset: InvestAsset = matches[0] ?? { ...blankAsset, id: newId(), symbol, name: symbol,
      kind: fund ? 'fund' : 'stock', currency: fund ? '' : 'TWD', market: fund ? '' : 'TW' };
    if (!matches.length) assets.push(asset);
    const number = (field: string) => v[field] == null || v[field] === '' ? null : Number(v[field]);
    const dividend = kind === 'dividend';
    const event: InvestEvent = {
      ...blankInvestEvent(kind, ''), id: item.sourceId ? `paste-${table}-${item.sourceId}` : newId(), asset: asset.id,
      tradeDate: fund || dividend ? '' : date, cashDate: fund || dividend ? date : '',
      quantity: number('quantity'), price: number('price'), fee: number('fee'), tax: number('tax'),
      cashAmount: number('cashAmount'), fx: number('fx'), exDate: parseDateText(String(v.exDate ?? '')) ?? '',
      perUnit: number('perUnit'), eligible: number('eligible'),
    };
    if (kind === 'stockDividend' && !event.quantity) item.errors.push('請填實際配發股數');
    if (!dividend && !event.quantity) item.errors.push('請填股數或單位數');
    if (!dividend && kind !== 'stockDividend' && (fund ? event.cashAmount == null : event.price == null)) {
      item.errors.push(fund ? '請填台幣實扣／實收金額' : '請填每股成交價');
    }
    if (dividend && event.cashAmount == null && (!event.exDate || event.perUnit == null)) item.errors.push('請填實收金額，或一併填除息日與每單位配息');
    try { validateInvest(event, assets); } catch (error) { item.errors.push((error as Error).message); }
    item.event = event;
    item.asset = asset;
    item.duplicate = !item.errors.length && seen.has(key(event));
    if (!item.errors.length) seen.add(key(event));
    return item;
  }));
}

export async function importInvestRows(store: InvestStore, rows: InvestImportRow[]) {
  if (!store.backend.writeBatch) throw new Error('這個資料來源不支援整批匯入');
  const valid = rows.filter((row) => !row.errors.length && row.event && row.asset);
  const now = Date.now();
  const tables = [...new Set(valid.map((r) => r.table))];
  const [snap, paste] = await Promise.all([
    store.load(), Promise.all(tables.map(async (table) => [table, await store.backend.read(table)] as const)),
  ]);
  const byTable = new Map(paste);
  const seen = new Set(snap.events.map((e) => e.id));
  const existingAssets = new Set(snap.assets.map((a) => a.id));
  const assets: RowValues[] = [];
  const events: RowValues[] = [];
  const updates = new Map<PasteSheet, { rowNumber: number; expectId: string; values: RowValues }[]>();
  for (const { table, event, asset, rowNumber, sourceId, rawKey } of valid) {
    const source = byTable.get(table)?.find((r) => r.rowNumber === rowNumber &&
      String(r.values.id ?? '') === sourceId && !r.values.deletedAt && JSON.stringify(r.values) === rawKey);
    if (!source) throw new Error('貼上區已更新，請重新預覽');
    if (seen.has(event!.id)) throw new Error('已匯入這筆交易，請重新預覽');
    if (!existingAssets.has(asset!.id)) {
      existingAssets.add(asset!.id);
      assets.push({ ...asset, createdAt: now, updatedAt: now });
    }
    events.push({ ...event, createdAt: now, updatedAt: now });
    const list = updates.get(table) ?? [];
    list.push({ rowNumber, expectId: sourceId, values: { id: sourceId || newId(), deletedAt: now, updatedAt: now } });
    updates.set(table, list);
  }
  if (events.length) await store.backend.writeBatch([
    { table: 'investAssets', append: assets }, { table: 'investEvents', append: events },
    ...[...updates].map(([table, update]) => ({ table, update })),
  ]);
  return events.length;
}
