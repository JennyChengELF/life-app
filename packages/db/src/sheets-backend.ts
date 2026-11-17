/** Google 試算表後端：透過 Sheets API / Drive API 讀寫使用者自己的試算表。 */
import type { Backend, RowUpdate, RowValues, TableRow } from './backend';
import { ConflictError } from './backend';
import { decodeCell, encodeCell } from './codec';
import type { GoogleAuth } from './google-auth';
import { AuthError } from './google-auth';
import type { ColumnDef, FileKey, TableName } from './schema';
import { FILES, SCHEMA_VERSION, TABLES, tablesOfFile } from './schema';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const INFO_SHEET = '說明';
const ID_KEY = (f: FileKey) => `life.sheetId.${f}`;

/** A1 表示法中的工作表名稱（加單引號） */
const q = (title: string) => `'${title.replace(/'/g, "''")}'`;

/** 0 → A、25 → Z、26 → AA */
export function colLetter(index: number): string {
  let s = '';
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class SheetsBackend implements Backend {
  readonly kind = 'sheets' as const;
  private ids: Partial<Record<FileKey, string>> = {};
  /** 每張工作表第一列的欄位名稱 */
  private headers = new Map<TableName, string[]>();

  constructor(private auth: GoogleAuth) {}

  private async api<T = any>(url: string, init: RequestInit = {}): Promise<T> {
    const token = this.auth.getToken();
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      });
    } catch {
      throw new Error('連不上 Google，請檢查網路');
    }
    if (res.status === 401) {
      this.auth.invalidate();
      throw new AuthError('Google 連線已過期，請重新連線');
    }
    if (!res.ok) {
      let msg = `${res.status}`;
      try {
        msg = (await res.json())?.error?.message ?? msg;
      } catch {
        /* ignore */
      }
      throw new ApiError(res.status, `Google 回應錯誤：${msg}`);
    }
    return res.status === 204 ? (undefined as T) : res.json();
  }

  private sid(file: FileKey): string {
    const id = this.ids[file];
    if (!id) throw new Error('試算表還沒準備好');
    return id;
  }

  fileUrl(file: FileKey) {
    const id = this.ids[file];
    return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null;
  }

  async init() {
    for (const file of Object.keys(FILES) as FileKey[]) {
      const sheetTitles = await this.ensureFile(file);
      await this.ensureTables(file, sheetTitles);
    }
  }

  /** 找到（或建立）這個 APP 的試算表，回傳現有的工作表名稱 */
  private async ensureFile(file: FileKey): Promise<string[]> {
    const fields = 'fields=spreadsheetId,sheets.properties.title';
    const cached = localStorage.getItem(ID_KEY(file));
    if (cached) {
      try {
        const s = await this.api(`${SHEETS}/${cached}?${fields}`);
        this.ids[file] = cached;
        return s.sheets.map((x: any) => x.properties.title);
      } catch (e) {
        if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 403)) throw e;
        localStorage.removeItem(ID_KEY(file));
      }
    }
    // 換裝置時：在雲端硬碟找這個 APP 之前建立的檔案
    const query = `name='${FILES[file].title}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
    const found = await this.api(`${DRIVE}?q=${encodeURIComponent(query)}&fields=files(id)&orderBy=createdTime`);
    let id: string | undefined = found.files?.[0]?.id;
    let titles: string[];
    if (id) {
      const s = await this.api(`${SHEETS}/${id}?${fields}`);
      titles = s.sheets.map((x: any) => x.properties.title);
    } else {
      id = await this.createFile(file);
      titles = [INFO_SHEET, ...tablesOfFile(file)];
    }
    this.ids[file] = id;
    localStorage.setItem(ID_KEY(file), id);
    return titles;
  }

  private async createFile(file: FileKey): Promise<string> {
    const tables = tablesOfFile(file);
    const created = await this.api(SHEETS, {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          title: FILES[file].title,
          locale: 'zh_TW',
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        sheets: [
          { properties: { title: INFO_SHEET } },
          ...tables.map((t) => ({ properties: { title: t, gridProperties: { frozenRowCount: 1 } } })),
        ],
      }),
    });
    const id: string = created.spreadsheetId;
    // 寫入欄位名稱與說明
    await this.api(`${SHEETS}/${id}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: [
          { range: `${q(INFO_SHEET)}!A1`, values: this.infoRows(file) },
          ...tables.map((t) => ({ range: `${q(t)}!A1`, values: [TABLES[t].columns.map((c) => c.name)] })),
        ],
      }),
    });
    for (const t of tables) this.headers.set(t, TABLES[t].columns.map((c) => c.name));
    return id;
  }

  private infoRows(file: FileKey): string[][] {
    const rows: string[][] = [
      ['項目', '內容'],
      ['schemaVersion', String(SCHEMA_VERSION)],
      ['說明', FILES[file].description],
      ['注意', '每張工作表的第一列是欄位名稱，請不要修改或刪除；欄位順序可以調整。刪除資料請在 APP 裡操作。'],
      [],
    ];
    for (const t of tablesOfFile(file)) {
      rows.push([`【${t}】`, TABLES[t].description]);
      for (const c of TABLES[t].columns as ColumnDef[]) rows.push([c.name, c.label]);
      rows.push([]);
    }
    return rows;
  }

  /** 補上缺少的工作表、缺少的欄位（資料格式升級時用） */
  private async ensureTables(file: FileKey, existing: string[]) {
    const id = this.sid(file);
    const tables = tablesOfFile(file);
    const missing = tables.filter((t) => !existing.includes(t));
    if (missing.length) {
      await this.api(`${SHEETS}/${id}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({
          requests: missing.map((t) => ({ addSheet: { properties: { title: t, gridProperties: { frozenRowCount: 1 } } } })),
        }),
      });
    }
    const ranges = tables.map((t) => `ranges=${encodeURIComponent(`${q(t)}!1:1`)}`).join('&');
    const res = await this.api(`${SHEETS}/${id}/values:batchGet?${ranges}`);
    const writes: { range: string; values: string[][] }[] = [];
    tables.forEach((t, i) => {
      const header: string[] = (res.valueRanges?.[i]?.values?.[0] ?? []).map((h: unknown) => String(h).trim());
      const add = TABLES[t].columns.map((c) => c.name).filter((n) => !header.includes(n));
      if (add.length) {
        writes.push({ range: `${q(t)}!${colLetter(header.length)}1`, values: [add] });
        header.push(...add);
      }
      this.headers.set(t, header);
    });
    if (writes.length) {
      await this.api(`${SHEETS}/${id}/values:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ valueInputOption: 'RAW', data: writes }),
      });
    }
  }

  private header(table: TableName): string[] {
    const h = this.headers.get(table);
    if (!h) throw new Error('試算表還沒準備好');
    return h;
  }

  async read(table: TableName): Promise<TableRow[]> {
    const id = this.sid(TABLES[table].file);
    const res = await this.api(
      `${SHEETS}/${id}/values/${encodeURIComponent(q(table))}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
    );
    const values: unknown[][] = res.values ?? [];
    const header = (values[0] ?? []).map((h) => String(h).trim());
    this.headers.set(table, header);
    const cols = TABLES[table].columns as ColumnDef[];
    const rows: TableRow[] = [];
    for (let i = 1; i < values.length; i++) {
      const line = values[i] ?? [];
      const row: TableRow = { rowNumber: i + 1, values: {}, errors: [], raw: {}, empty: true };
      for (const c of cols) {
        const idx = header.indexOf(c.name);
        const cell = idx >= 0 ? line[idx] : undefined;
        row.raw[c.name] = cell;
        const d = decodeCell(c.type, cell);
        if (d.ok) {
          row.values[c.name] = d.value;
          if (d.value !== null) row.empty = false;
        } else {
          row.values[c.name] = null;
          row.errors.push(c.name);
          row.empty = false;
        }
      }
      rows.push(row);
    }
    return rows;
  }

  async append(table: TableName, rows: RowValues[]): Promise<number[]> {
    if (!rows.length) return [];
    const id = this.sid(TABLES[table].file);
    const header = this.header(table);
    const cols = TABLES[table].columns as ColumnDef[];
    const values = rows.map((r) =>
      header.map((h) => {
        const c = cols.find((x) => x.name === h);
        return c && h in r ? encodeCell(c.type, r[h]) : '';
      }),
    );
    const res = await this.api(
      `${SHEETS}/${id}/values/${encodeURIComponent(`${q(table)}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body: JSON.stringify({ values }) },
    );
    const m = String(res.updates?.updatedRange ?? '').match(/![A-Z]+(\d+)/);
    const start = m ? Number(m[1]) : NaN;
    return rows.map((_, i) => start + i);
  }

  async update(table: TableName, updates: RowUpdate[]) {
    if (!updates.length) return;
    const id = this.sid(TABLES[table].file);
    const header = this.header(table);
    const cols = TABLES[table].columns as ColumnDef[];
    const idIdx = header.indexOf('id');

    // 寫入前確認 id 沒變（使用者可能在試算表插入 / 刪除了列）
    const checks = updates.filter((u) => u.expectId !== undefined);
    if (checks.length && idIdx >= 0) {
      const ranges = checks.map((u) => `ranges=${encodeURIComponent(`${q(table)}!${colLetter(idIdx)}${u.rowNumber}`)}`).join('&');
      const res = await this.api(`${SHEETS}/${id}/values:batchGet?${ranges}`);
      checks.forEach((u, i) => {
        const actual = String(res.valueRanges?.[i]?.values?.[0]?.[0] ?? '');
        if (actual !== u.expectId) throw new ConflictError();
      });
    }

    const data = updates.flatMap((u) =>
      Object.entries(u.values).map(([name, v]) => {
        const idx = header.indexOf(name);
        const c = cols.find((x) => x.name === name);
        if (idx < 0 || !c) throw new Error(`欄位不存在：${table}.${name}`);
        return { range: `${q(table)}!${colLetter(idx)}${u.rowNumber}`, values: [[encodeCell(c.type, v)]] };
      }),
    );
    await this.api(`${SHEETS}/${id}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
    });
  }
}
