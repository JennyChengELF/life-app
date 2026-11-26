import type { CellValue } from './codec';
import type { FileKey, TableName } from './schema';

export type RowValues = Record<string, CellValue>;

export interface TableRow {
  /** 試算表的列號（第 1 列是欄位名稱，資料從第 2 列開始） */
  rowNumber: number;
  /** 已轉換成 APP 值；轉換失敗的欄位放在 errors，值為 null */
  values: RowValues;
  /** 格式錯誤的欄位名稱 */
  errors: string[];
  /** 原始內容（格式錯誤時顯示給使用者看） */
  raw: Record<string, unknown>;
  /** 整列都是空的 */
  empty: boolean;
}

export interface RowUpdate {
  rowNumber: number;
  /** 只更新這些欄位 */
  values: RowValues;
  /** 寫入前確認這一列的 id 還是這個值（'' = 應該是空白），避免使用者在試算表插入 / 刪除列後寫錯列 */
  expectId?: string;
}

export interface TableWrite {
  table: TableName;
  append?: RowValues[];
  update?: RowUpdate[];
}

/** 資料存取後端：Google 試算表，或本機測試模式 */
export interface Backend {
  readonly kind: 'sheets' | 'local';
  /** 確認試算表與工作表都存在（不存在就建立） */
  init(): Promise<void>;
  read(table: TableName): Promise<TableRow[]>;
  /** 回傳新增的列號 */
  append(table: TableName, rows: RowValues[]): Promise<number[]>;
  update(table: TableName, updates: RowUpdate[]): Promise<void>;
  /** 試算表網址（本機模式為 null） */
  fileUrl(file: FileKey): string | null;
}

export class ConflictError extends Error {
  constructor() {
    super('試算表的資料剛被修改過（可能插入或刪除了列），請重新整理後再試一次');
    this.name = 'ConflictError';
  }
}
