/** 本機測試模式：資料存在瀏覽器（還沒設定 Google 時開發用），不會同步到其他裝置。 */
import type { Backend, RowUpdate, RowValues, TableRow, TableWrite } from './backend';
import { ConflictError } from './backend';
import type { TableName } from './schema';
import type { TableDef } from './schema';
import { TABLES } from './schema';

type KV = Pick<Storage, 'getItem' | 'setItem'>;

export function memoryStorage(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

export class LocalBackend implements Backend {
  readonly kind = 'local' as const;
  constructor(private storage: KV = globalThis.localStorage) {}

  private key(t: TableName) {
    return `life.local.${t}`;
  }
  private load(t: TableName): RowValues[] {
    let text = this.storage.getItem(this.key(t));
    // 表改過名稱：讀舊名稱的資料
    for (const old of (TABLES[t] as TableDef).formerNames ?? []) text ??= this.storage.getItem(`life.local.${old}`);
    return JSON.parse(text ?? '[]');
  }
  private save(t: TableName, rows: RowValues[]) {
    this.storage.setItem(this.key(t), JSON.stringify(rows));
  }

  async init() {}

  async read(table: TableName): Promise<TableRow[]> {
    const cols = TABLES[table].columns.map((c) => c.name);
    return this.load(table).map((r, i) => {
      const values: RowValues = {};
      for (const c of cols) values[c] = r[c] ?? null;
      return {
        rowNumber: i + 2,
        values,
        errors: [],
        raw: { ...values },
        empty: cols.every((c) => values[c] === null || values[c] === ''),
      };
    });
  }

  async append(table: TableName, rows: RowValues[]) {
    const all = this.load(table);
    const start = all.length + 2;
    all.push(...rows);
    this.save(table, all);
    return rows.map((_, i) => start + i);
  }

  async update(table: TableName, updates: RowUpdate[]) {
    const all = this.load(table);
    for (const u of updates) {
      const row = all[u.rowNumber - 2];
      if (!row) throw new ConflictError();
      if (u.expectId !== undefined && (row.id ?? '') !== u.expectId) throw new ConflictError();
      Object.assign(row, u.values);
    }
    this.save(table, all);
  }

  async writeBatch(writes: TableWrite[]) {
    const before = new Map<TableName, RowValues[]>();
    const after = new Map<TableName, RowValues[]>();
    for (const { table, append = [], update = [] } of writes) {
      if (!after.has(table)) {
        const rows = this.load(table);
        before.set(table, rows);
        after.set(table, rows.map((row) => ({ ...row })));
      }
      const rows = after.get(table)!;
      for (const { rowNumber, expectId, values } of update) {
        const row = rows[rowNumber - 2];
        if (!row || (expectId !== undefined && (row.id ?? '') !== expectId)) throw new ConflictError();
        Object.assign(row, values);
      }
      rows.push(...append);
    }
    const written: TableName[] = [];
    try {
      for (const [table, rows] of after) {
        this.save(table, rows);
        written.push(table);
      }
    } catch (error) {
      for (const table of written.reverse()) this.save(table, before.get(table)!);
      throw error;
    }
  }

  /** 測試用：模擬使用者直接在試算表新增一列（沒有 id） */
  async appendRaw(table: TableName, row: RowValues) {
    return this.append(table, [row]);
  }

  fileUrl() {
    return null;
  }
}
