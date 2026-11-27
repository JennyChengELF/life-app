import type { Backend, RowValues, TableWrite } from './backend';
import { newId } from './ids';
import { parseDateText, toDateKey } from './time';

export const MED_KINDS = ['中藥', '西藥', '保健品'] as const;
export const MED_MODES = ['batch', 'total', 'none'] as const;
export type MedKind = typeof MED_KINDS[number];
export type MedMode = typeof MED_MODES[number];
type StockEffect = MedMode | 'pending';
type Stored = { id: string; rowNumber: number };
export type MedItemInput = { name: string; kind: MedKind; unit: string; mode: MedMode; note: string };
type StockTotals = { received: number; used: number };
export type MedItem = Stored & MedItemInput & StockTotals & { stockSince: number | null; remaining: number | null };
export type MedBatchInput = { receivedDate: string; expiryDate: string; ingredients: string; quantity: number };
export type MedBatch = Stored & Omit<MedBatchInput, 'quantity'> & StockTotals & { itemId: string; remaining: number };
export type MedDose = { itemId: string; quantity: number };
export type MedLogInput = MedDose & { time: number; date: string; batchId: string | null; skipStock: boolean };
export type MedLog = Stored & MedLogInput & { stockEffect: StockEffect };
export type MedCombo = Stored & { name: string; entries: MedDose[] };
export type MedStockChanges = {
  batches?: (MedBatchInput & { id: string; itemId: string })[];
  additions?: (MedDose & { batchId: string | null })[];
};
const TABLES = ['medItems', 'medBatches', 'medStock', 'medLogs', 'medCombos', 'medCommands'] as const;
type MedTable = typeof TABLES[number];
export type MedIssue = { table: MedTable; rowNumber: number; problem: string };
export type MedSnapshot = { items: MedItem[]; batches: MedBatch[]; logs: MedLog[]; combos: MedCombo[]; issues: MedIssue[] };
type BatchBackend = Backend & { writeBatch(writes: TableWrite[]): Promise<void> };
type Loaded = MedSnapshot & { commands: Set<string> };
const str = (v: unknown) => typeof v === 'string' ? v.trim() : '';
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
const validDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && parseDateText(v) === v;
const round = (n: number) => Number(n.toFixed(9));
const positive = (n: number | null) => n != null && n > 0 && round(n) > 0;
const stockEffects: readonly StockEffect[] = ['batch', 'total', 'none', 'pending'];

// （2026-11-26 使用者決定：中藥預設分批，西藥和保健品預設累加。）
export const defaultMedMode = (kind: MedKind): MedMode => kind === '中藥' ? 'batch' : 'total';
export const canPickMed = (item: MedItem) => item.mode === 'none' || (item.remaining ?? 0) > 0;
export const availableMedBatches = (batches: MedBatch[], itemId: string) =>
  batches.filter((batch) => batch.itemId === itemId && batch.remaining > 0);

const initial = (id: string, now: number) => ({ id, createdAt: now, updatedAt: now });
const patch = (row: Stored, values: RowValues) => ({ rowNumber: row.rowNumber, expectId: row.id, values });
const get = <T extends Stored>(rows: T[], id: string) => rows.find((row) => row.id === id);

function decodeEntries(value: unknown): MedDose[] | null {
  try {
    const entries: unknown = JSON.parse(str(value));
    if (!Array.isArray(entries) || !entries.length) return null;
    const valid = entries.every((e) => e && str(e.itemId) && positive(num(e.quantity)));
    if (!valid || new Set(entries.map((e) => e.itemId)).size !== entries.length) return null;
    return entries.map(({ itemId, quantity }) => ({ itemId, quantity }));
  } catch {
    return null;
  }
}

// （2026-11-26 使用者決定：從只記服用切換到累加後，切換前的服用不扣新庫存。）
function deducts(item: MedItem, log: Pick<MedLogInput, 'time' | 'skipStock'>) {
  return !log.skipStock && item.mode !== 'none' && (item.stockSince == null || log.time >= item.stockSince);
}

export class MedStore {
  constructor(private backend: BatchBackend) {}

  async load(): Promise<MedSnapshot> {
    return this.read();
  }

  private async read(): Promise<Loaded> {
    const rows = await Promise.all(TABLES.map((table) => this.backend.read(table)));
    const issues: MedIssue[] = [];
    const fixes: TableWrite[] = [];
    const now = Date.now();
    const readTable = <T>(table: MedTable, parse: (v: RowValues, row: Stored) => T | string) => {
      const result: T[] = [];
      const update = [];
      const used = new Set<string>();
      for (const { rowNumber, values: v, empty, errors } of rows[TABLES.indexOf(table)]) {
        if (empty || v.deletedAt != null) continue;
        const existing = str(v.id);
        const id = existing || newId(now);
        const problem = errors.length ? `格式有誤：${errors.join('、')}` : used.has(id) ? '系統編號重複' : null;
        const decoded = problem ?? parse(v, { id, rowNumber });
        if (typeof decoded === 'string') issues.push({ table, rowNumber, problem: decoded });
        else {
          used.add(id);
          result.push(decoded);
          const missing: RowValues = {};
          if (!existing) missing.id = id;
          if (v.createdAt == null) missing.createdAt = now;
          if (v.updatedAt == null) missing.updatedAt = now;
          if (table === 'medLogs' && v.date == null && num(v.time) != null) missing.date = toDateKey(num(v.time)!);
          if (table === 'medLogs' && !v.stockEffect) missing.stockEffect = (decoded as MedLog).stockEffect;
          if (Object.keys(missing).length) update.push({ rowNumber, expectId: existing, values: missing });
        }
      }
      if (update.length) fixes.push({ table, update });
      return result;
    };

    const items = readTable<MedItem>('medItems', (v, row) => {
      const name = str(v.name);
      const kind = str(v.kind) as MedKind;
      const unit = str(v.unit);
      const mode = (str(v.mode) || defaultMedMode(kind)) as MedMode;
      if (!name || !unit || !MED_KINDS.includes(kind) || !MED_MODES.includes(mode)) return '請確認品項名稱、類型、單位和庫存方式';
      return { ...row, name, kind, unit, mode, note: str(v.note), stockSince: num(v.stockSince), remaining: mode === 'none' ? null : 0, received: 0, used: 0 };
    });
    const batches = readTable<MedBatch>('medBatches', (v, row) => {
      const itemId = str(v.itemId);
      const receivedDate = str(v.receivedDate);
      const expiryDate = str(v.expiryDate);
      if (get(items, itemId)?.mode !== 'batch' || !validDate(receivedDate) || (expiryDate && !validDate(expiryDate)))
        return '請確認分批品項、領藥／購買日期和使用期限';
      return { ...row, itemId, receivedDate, expiryDate, ingredients: str(v.ingredients), remaining: 0, received: 0, used: 0 };
    });
    const stock = readTable('medStock', (v, row) => {
      const itemId = str(v.itemId);
      const batchId = str(v.batchId);
      const quantity = num(v.quantity);
      const item = get(items, itemId);
      const validTarget = batchId ? get(batches, batchId)?.itemId === itemId : item?.mode === 'total';
      if (!item || !validTarget || quantity == null || !positive(quantity)) return '請確認庫存歸屬和增加數量';
      return { ...row, itemId, batchId, quantity };
    });
    const logs = readTable<MedLog>('medLogs', (v, row) => {
      const itemId = str(v.itemId);
      const batchId = str(v.batchId) || null;
      const item = get(items, itemId);
      const time = num(v.time);
      const quantity = num(v.quantity);
      const date = str(v.date) || (time == null ? '' : toDateKey(time));
      const skipStock = v.skipStock === true;
      if (!item || time == null || !validDate(date) || quantity == null || !positive(quantity)
        || (batchId && get(batches, batchId)?.itemId !== itemId)) return '請確認品項、批次、日期時間和服用量';
      const inferred = !deducts(item, { time, skipStock }) ? 'none' : item.mode === 'total' ? 'total' : batchId ? 'batch' : 'pending';
      // （2026-11-27 使用者決定：直接填 skipStock=TRUE 時照常顯示服用紀錄，並且不扣庫存。）
      const stockEffect = (skipStock ? 'none' : str(v.stockEffect) || inferred) as StockEffect;
      if (!stockEffects.includes(stockEffect) || ((stockEffect === 'batch' || stockEffect === 'total' || stockEffect === 'pending') && stockEffect !== inferred))
        return '請確認這筆紀錄的庫存影響';
      return { ...row, itemId, batchId, time, date, quantity, stockEffect, skipStock };
    });
    const combos = readTable<MedCombo>('medCombos', (v, row) => {
      const name = str(v.name);
      const entries = decodeEntries(v.entries);
      if (!name || !entries || entries.some((e) => !get(items, e.itemId))) return '請確認組合名稱、品項和劑量';
      return { ...row, name, entries };
    });
    const commands = new Set(readTable('medCommands', (_v, row) => row).map(({ id }) => id));
    if (fixes.length) await this.backend.writeBatch(fixes);

    for (const change of stock) {
      const target = change.batchId ? get(batches, change.batchId) : get(items, change.itemId);
      if (target) {
        target.received = round(target.received + change.quantity);
        target.remaining = round((target.remaining ?? 0) + change.quantity);
      }
    }
    for (const log of logs) {
      const target = log.stockEffect === 'batch' ? get(batches, log.batchId!) :
        log.stockEffect === 'total' ? get(items, log.itemId) : undefined;
      if (target) {
        target.used = round(target.used + log.quantity);
        target.remaining = round((target.remaining ?? 0) - log.quantity);
      }
    }
    for (const batch of batches) {
      const item = get(items, batch.itemId)!;
      item.received = round(item.received + batch.received);
      item.used = round(item.used + batch.used);
      item.remaining = round((item.remaining ?? 0) + batch.remaining);
    }
    items.sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'));
    batches.sort((a, b) => b.receivedDate.localeCompare(a.receivedDate));
    logs.sort((a, b) => b.time - a.time || a.rowNumber - b.rowNumber);
    return { items, batches, logs, combos, issues, commands };
  }

  private async commit(commandId: string, changes: (data: Loaded, now: number) => TableWrite[]) {
    const data = await this.read();
    if (data.commands.has(commandId)) return;
    const now = Math.floor(Date.now() / 1000) * 1000;
    const writes = changes(data, now);
    await this.backend.writeBatch([...writes, { table: 'medCommands', append: [initial(commandId, now)] }]);
  }

  async saveItem(commandId: string, input: MedItemInput, id?: string, quantity?: number) {
    await this.commit(commandId, (data, now) => {
      const current = id ? get(data.items, id) : undefined;
      if (id && !current) throw new Error('找不到這個品項，請重新整理');
      const name = input.name.trim();
      const unit = input.unit.trim();
      if (!name || !unit || !MED_KINDS.includes(input.kind) || !MED_MODES.includes(input.mode)) throw new Error('請填寫名稱、類型、單位和庫存方式');
      const switching = current?.mode === 'none' && input.mode === 'total';
      if (current && current.mode !== input.mode && !switching) throw new Error('目前支援從「只記服用」切換為「直接累加」');
      if (current && current.unit !== unit && current.mode !== 'none') throw new Error('已有庫存的品項需沿用原單位');
      if (switching && (quantity == null || !Number.isFinite(quantity) || quantity < 0)) throw new Error('請填入目前的實際數量');
      const itemId = id ?? newId(now);
      const values = { ...input, name, unit, stockSince: switching ? now : current?.stockSince ?? null, updatedAt: now };
      const writes: TableWrite[] = [current ? { table: 'medItems', update: [patch(current, values)] } :
        { table: 'medItems', append: [{ ...initial(itemId, now), ...values }] }];
      if (quantity != null && (!Number.isFinite(quantity) || quantity < 0 || input.mode !== 'total')) throw new Error('請確認初始數量');
      if (quantity != null && positive(quantity)) writes.push({
        table: 'medStock', append: [{ ...initial(newId(now), now), itemId, batchId: null, quantity: round(quantity) }],
      });
      return writes;
    });
  }

  private stockWrites(data: Loaded, now: number, changes: MedStockChanges) {
    const newBatches: RowValues[] = [];
    const stock: RowValues[] = [];
    for (const { id, itemId, quantity, receivedDate, expiryDate, ingredients } of changes.batches ?? []) {
      if (get(data.items, itemId)?.mode !== 'batch' || get(data.batches, id) || !validDate(receivedDate)
        || (expiryDate && !validDate(expiryDate)) || !positive(num(quantity))) throw new Error('請確認新批次的日期和數量');
      newBatches.push({ ...initial(id, now), itemId, receivedDate, expiryDate, ingredients: ingredients.trim() });
      data.batches.push({ id, rowNumber: 0, itemId, receivedDate, expiryDate, ingredients, remaining: round(quantity), received: round(quantity), used: 0 });
      stock.push({ ...initial(newId(now), now), itemId, batchId: id, quantity: round(quantity) });
    }
    for (const { itemId, batchId, quantity } of changes.additions ?? []) {
      const item = get(data.items, itemId);
      const batch = batchId ? get(data.batches, batchId) : undefined;
      const target = batchId ? (batch?.itemId === itemId ? batch : undefined) : item?.mode === 'total' ? item : undefined;
      if (!target || !positive(num(quantity))) throw new Error('請確認補貨的品項、批次和數量');
      target.remaining = round((target.remaining ?? 0) + quantity);
      stock.push({ ...initial(newId(now), now), itemId, batchId, quantity: round(quantity) });
    }
    const writes: TableWrite[] = [];
    if (newBatches.length) writes.push({ table: 'medBatches', append: newBatches });
    if (stock.length) writes.push({ table: 'medStock', append: stock });
    return writes;
  }

  async saveStock(commandId: string, changes: MedStockChanges) {
    await this.commit(commandId, (data, now) => this.stockWrites(data, now, changes));
  }

  async saveLogs(commandId: string, inputs: MedLogInput[], changes: MedStockChanges = {}, id?: string) {
    await this.commit(commandId, (data, now) => {
      const current = id ? get(data.logs, id) : undefined;
      if (id && !current) throw new Error('找不到要修改的紀錄');
      if (!inputs.length || new Set(inputs.map((entry) => entry.itemId)).size !== inputs.length) throw new Error('請選至少一個品項');
      const writes = this.stockWrites(data, now, changes);
      const rows = inputs.map((input) => {
        const item = get(data.items, input.itemId);
        if (!item || !positive(num(input.quantity)) || !Number.isFinite(input.time) || !validDate(input.date)) throw new Error('請確認品項、日期時間和服用量');
        const existing = current?.itemId === item.id ? current : undefined;
        const available = availableMedBatches(data.batches, item.id);
        const batch = input.batchId ? get(data.batches, input.batchId) : undefined;
        const retain = !!batch && existing?.batchId === batch.id;
        if (item.mode === 'batch' && input.batchId && (batch?.itemId !== item.id || (!retain && batch.remaining <= 0))) {
          throw new Error(`${item.name} 的批次已無庫存，請重新選擇`);
        }
        // （2026-11-26 使用者決定：有量的批次才可新選；全無庫存可先存待補批次。）
        const batchId = item.mode === 'batch' ? input.batchId ?? (available.length === 1 ? available[0].id : null) : null;
        const shouldDeduct = deducts(item, input);
        if (shouldDeduct && item.mode === 'batch' && !batchId && available.length) throw new Error(`請選擇 ${item.name} 的批次`);
        const stockEffect: StockEffect = !shouldDeduct ? 'none' : item.mode === 'total' ? 'total' : batchId ? 'batch' : 'pending';
        return { ...input, quantity: round(input.quantity), batchId, stockEffect, updatedAt: now };
      });
      const sameIndex = current ? rows.findIndex((row) => row.itemId === current.itemId) : -1;
      const editedIndex = sameIndex < 0 ? 0 : sameIndex;
      writes.push({
        table: 'medLogs',
        update: current ? [patch(current, rows[editedIndex])] : undefined,
        append: rows.filter((_, i) => !current || i !== editedIndex).map((row) => ({ ...initial(newId(now), now), ...row })),
      });
      return writes;
    });
  }

  async saveCombo(commandId: string, name: string, entries: MedDose[], changes: MedStockChanges = {}, id?: string) {
    await this.commit(commandId, (data, now) => {
      const current = id ? get(data.combos, id) : undefined;
      if (id && !current) throw new Error('找不到要修改的組合');
      if (!name.trim() || !entries.length || new Set(entries.map((entry) => entry.itemId)).size !== entries.length
        || entries.some((entry) => !get(data.items, entry.itemId) || !positive(num(entry.quantity)))) throw new Error('請填寫組合名稱、品項和劑量');
      const values = { name: name.trim(), entries: JSON.stringify(entries.map(({ itemId, quantity }) => ({ itemId, quantity: round(quantity) }))), updatedAt: now };
      const writes = this.stockWrites(data, now, changes);
      writes.push(current ? { table: 'medCombos', update: [patch(current, values)] } :
        { table: 'medCombos', append: [{ ...initial(newId(now), now), ...values }] });
      return writes;
    });
  }

  async remove(commandId: string, table: 'medLogs' | 'medCombos', id: string) {
    // （2026-11-26 使用者決定：修改或刪除服用紀錄時，庫存依有效紀錄自動回算。）
    await this.commit(commandId, (data, now) => {
      const row = get<Stored>(table === 'medLogs' ? data.logs : data.combos, id);
      if (!row) throw new Error('找不到要刪除的資料');
      return [{ table, update: [patch(row, { deletedAt: now, updatedAt: now })] }];
    });
  }
}
