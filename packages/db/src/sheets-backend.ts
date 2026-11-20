/** Google 試算表後端：透過 Sheets API / Drive API 讀寫使用者自己的試算表。 */
import type { Backend, RowUpdate, RowValues, TableRow } from './backend';
import { ConflictError } from './backend';
import { decodeCell, encodeCell } from './codec';
import type { GoogleAuth } from './google-auth';
import { AuthError } from './google-auth';
import type { ColumnDef, FileKey, TableDef, TableName } from './schema';
import { FILES, SCHEMA_VERSION, TABLES, tablesOfFile } from './schema';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const INFO_SHEET = '說明';
const ID_KEY = (f: FileKey) => `life.sheetId.${f}`;
/** 放所有試算表的資料夾（💡 名稱暫定） */
const FOLDER_NAME = '生活APP';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FOLDER_PROP = 'lifeAppFolder';
const FOLDER_KEY = 'life.folderId';
/** 試算表已經搬進資料夾過（存在檔案的 appProperties，換裝置也知道） */
const FILED_PROP = 'lifeAppFiled';
const FILED_KEY = 'life.filed';
/** 試算表是哪個 APP 的（存在檔案的 appProperties，值是 FileKey）；用來找檔案，改檔名也找得到 */
const FILE_PROP = 'lifeAppFile';
const MARKED_KEY = 'life.marked';
/** 429 重試前等待的毫秒數（每分鐘額度，最多等約 1 分鐘） */
const RETRY_DELAYS = [2000, 5000, 10000, 20000, 30000];
const READ_PARAMS = 'valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER';

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
    let res: Response;
    // 超過每分鐘讀寫次數（429）→ 等一下自動重試（Google 被擋的請求不會執行，重送是安全的）
    for (let attempt = 0; ; attempt++) {
      const token = this.auth.getToken();
      try {
        res = await fetch(url, {
          ...init,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
        });
      } catch {
        throw new Error('連不上 Google，請檢查網路');
      }
      if (res.status !== 429 || attempt >= RETRY_DELAYS.length) break;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt] + Math.random() * 1000));
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
    const folder = await this.safely(() => this.ensureFolder());
    for (const file of Object.keys(FILES) as FileKey[]) {
      const sheetTitles = await this.ensureFile(file);
      await this.ensureTables(file, sheetTitles);
      await this.safely(() => this.ensureDateFormats(file));
      if (folder) await this.safely(() => this.fileIntoFolder(this.sid(file), folder));
      await this.safely(() => this.ensureMarked(file));
    }
  }

  /** 新增版本的日期欄套用一致格式；每個 schema 版本每份檔案只做一次。 */
  private async ensureDateFormats(file: FileKey) {
    const id = this.sid(file);
    const done = `life.dateFormats.${id}.${SCHEMA_VERSION}`;
    if (localStorage.getItem(done)) return;
    // 只處理本輪新增的表，不覆蓋使用者在既有 APP 試算表自行選的日期顯示格式。
    const formatTables: TableName[] = file === 'period' ? tablesOfFile(file) : file === 'health' ? ['healthConditionLogs'] : [];
    if (!formatTables.length) {
      localStorage.setItem(done, '1');
      return;
    }
    const meta = await this.api(`${SHEETS}/${id}?fields=sheets.properties(title,sheetId)`);
    const sheetIds = new Map<string, number>((meta.sheets ?? []).map((s: any) => [s.properties.title, s.properties.sheetId]));
    const requests: object[] = [];
    for (const table of formatTables) {
      const sheetId = sheetIds.get(table);
      if (sheetId == null) continue;
      const header = this.header(table);
      for (const col of TABLES[table].columns as ColumnDef[]) {
        if (col.type !== 'date' && col.type !== 'datetime') continue;
        const index = header.indexOf(col.name);
        if (index < 0) continue;
        requests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: index, endColumnIndex: index + 1 },
            cell: { userEnteredFormat: { numberFormat: { type: col.type === 'date' ? 'DATE' : 'DATE_TIME', pattern: col.type === 'date' ? 'yyyy-mm-dd' : 'yyyy-mm-dd hh:mm' } } },
            fields: 'userEnteredFormat.numberFormat',
          },
        });
      }
    }
    if (requests.length) await this.api(`${SHEETS}/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
    localStorage.setItem(done, '1');
  }

  /** 整理資料夾失敗不影響使用（檔案留在原處，下次再試）；登入過期照常往外丟 */
  private async safely<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AuthError) throw e;
      console.warn('整理資料夾失敗', e);
      return null;
    }
  }

  /**
   * 所有試算表放在同一個資料夾（2026-11-18 使用者要求，比較好找）。
   * 用 appProperties 認資料夾，使用者改名或移動資料夾都找得到。
   */
  private async ensureFolder(): Promise<string> {
    const cached = localStorage.getItem(FOLDER_KEY);
    if (cached) {
      try {
        const f = await this.api(`${DRIVE}/${cached}?fields=id,trashed`);
        if (!f.trashed) return cached;
      } catch (e) {
        if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 403)) throw e;
      }
      localStorage.removeItem(FOLDER_KEY);
    }
    const query = `mimeType='${FOLDER_MIME}' and appProperties has { key='${FOLDER_PROP}' and value='1' } and trashed=false`;
    const found = await this.api(`${DRIVE}?q=${encodeURIComponent(query)}&fields=files(id)&orderBy=createdTime`);
    let id: string | undefined = found.files?.[0]?.id;
    if (!id) {
      const created = await this.api(`${DRIVE}?fields=id`, {
        method: 'POST',
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME, appProperties: { [FOLDER_PROP]: '1' } }),
      });
      id = created.id as string;
    }
    localStorage.setItem(FOLDER_KEY, id);
    return id;
  }

  /** 試算表第一次被看到時搬進資料夾；只搬一次（之後使用者自己移到別處就不再搬） */
  private async fileIntoFolder(fileId: string, folderId: string) {
    const doneKey = `${FILED_KEY}.${fileId}`;
    if (localStorage.getItem(doneKey)) return;
    const f = await this.api(`${DRIVE}/${fileId}?fields=parents,appProperties`);
    if (!f.appProperties?.[FILED_PROP]) {
      const parents: string[] = f.parents ?? [];
      const remove = parents.filter((p) => p !== folderId);
      const params = new URLSearchParams({ fields: 'id' });
      if (!parents.includes(folderId)) params.set('addParents', folderId);
      if (remove.length) params.set('removeParents', remove.join(','));
      await this.api(`${DRIVE}/${fileId}?${params}`, { method: 'PATCH', body: JSON.stringify({ appProperties: { [FILED_PROP]: '1' } }) });
    }
    localStorage.setItem(doneKey, '1');
  }

  /** 找到（或建立）這個 APP 的試算表，回傳現有的工作表（名稱 → sheetId） */
  private async ensureFile(file: FileKey): Promise<Map<string, number>> {
    const fields = 'fields=spreadsheetId,sheets.properties(title,sheetId)';
    const toMap = (s: any) => new Map<string, number>(s.sheets.map((x: any) => [x.properties.title, x.properties.sheetId]));
    const cached = localStorage.getItem(ID_KEY(file));
    if (cached) {
      try {
        const s = await this.api(`${SHEETS}/${cached}?${fields}`);
        this.ids[file] = cached;
        await this.safely(() => this.renameFormerFileTitle(cached, file));
        return toMap(s);
      } catch (e) {
        if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 403)) throw e;
        localStorage.removeItem(ID_KEY(file));
      }
    }
    // 換裝置時：在雲端硬碟找這個 APP 之前建立的檔案。
    // 先用標記找（使用者改檔名也找得到，2026-11-18 使用者決定）；舊檔案還沒有標記 → 用檔名找，找到就補上標記
    const sheetMime = `mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
    const search = async (cond: string) => {
      const query = `${cond} and ${sheetMime}`;
      const found = await this.api(`${DRIVE}?q=${encodeURIComponent(query)}&fields=files(id)&orderBy=createdTime`);
      return found.files?.[0]?.id as string | undefined;
    };
    let id = await search(`appProperties has { key='${FILE_PROP}' and value='${file}' }`);
    if (!id) {
      id = await search(`name='${FILES[file].title.replace(/'/g, "\\'")}'`);
      for (const former of FILES[file].formerTitles ?? []) {
        if (id) break;
        id = await search(`name='${former.replace(/'/g, "\\'")}'`);
      }
      if (id) await this.safely(() => this.markFile(id!, file));
    }
    let titles: Map<string, number>;
    if (id) {
      const s = await this.api(`${SHEETS}/${id}?${fields}`);
      titles = toMap(s);
    } else {
      id = await this.createFile(file);
      await this.safely(() => this.markFile(id!, file));
      titles = new Map([INFO_SHEET, ...tablesOfFile(file)].map((t) => [t, -1]));
    }
    this.ids[file] = id;
    localStorage.setItem(ID_KEY(file), id);
    await this.safely(() => this.renameFormerFileTitle(id!, file));
    return titles;
  }

  /** APP 改名時只改仍使用舊預設名稱的檔案；使用者自行改過的名稱保持不動。 */
  private async renameFormerFileTitle(fileId: string, file: FileKey) {
    const former = FILES[file].formerTitles;
    if (!former?.length) return;
    const current = await this.api(`${DRIVE}/${fileId}?fields=name`);
    if (!former.includes(current.name)) return;
    await this.api(`${DRIVE}/${fileId}?fields=id`, {
      method: 'PATCH',
      body: JSON.stringify({ name: FILES[file].title }),
    });
  }

  /** 在檔案上加標記（appProperties），之後用標記找；失敗沒關係，下次再補 */
  private async markFile(fileId: string, file: FileKey) {
    await this.api(`${DRIVE}/${fileId}?fields=id`, { method: 'PATCH', body: JSON.stringify({ appProperties: { [FILE_PROP]: file } }) });
    localStorage.setItem(`${MARKED_KEY}.${fileId}`, '1');
  }

  /** 這台裝置已經記得檔案 id（不會再搜尋）的舊檔案，也補上標記，換裝置時才找得到 */
  private async ensureMarked(file: FileKey) {
    const id = this.ids[file];
    if (!id || localStorage.getItem(`${MARKED_KEY}.${id}`)) return;
    const f = await this.api(`${DRIVE}/${id}?fields=appProperties`);
    if (f.appProperties?.[FILE_PROP] === file) localStorage.setItem(`${MARKED_KEY}.${id}`, '1');
    else await this.markFile(id, file);
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
  private async ensureTables(file: FileKey, existingSheets: Map<string, number>) {
    const id = this.sid(file);
    const tables = tablesOfFile(file);
    const existing = [...existingSheets.keys()];
    const requests: object[] = [];
    for (const t of tables) {
      if (existing.includes(t)) continue;
      // 舊名稱的工作表 → 改名（資料保留）
      const former = ((TABLES[t] as TableDef).formerNames ?? []).find((n) => existingSheets.has(n));
      if (former) requests.push({ updateSheetProperties: { properties: { sheetId: existingSheets.get(former), title: t }, fields: 'title' } });
      else requests.push({ addSheet: { properties: { title: t, gridProperties: { frozenRowCount: 1 } } } });
    }
    if (!existing.includes(INFO_SHEET)) requests.push({ addSheet: { properties: { title: INFO_SHEET } } });
    if (requests.length) {
      await this.api(`${SHEETS}/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
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
    // 結構有變（新增工作表或欄位）→ 重寫「說明」工作表
    if (requests.length || writes.length) {
      await this.api(`${SHEETS}/${id}/values/${encodeURIComponent(q(INFO_SHEET))}:clear`, { method: 'POST', body: '{}' });
      writes.push({ range: `${q(INFO_SHEET)}!A1`, values: this.infoRows(file) });
    }
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

  /**
   * 同一時間（同一輪）要讀的工作表先收集起來，同一份試算表合成一次 batchGet。
   * 例：記帳開啟時讀 13 張表 → 只發 2 次讀取（記帳、綜合），避免超過每分鐘讀取上限。
   */
  private pendingReads = new Map<string, { table: TableName; resolve: (r: TableRow[]) => void; reject: (e: unknown) => void }[]>();

  async read(table: TableName): Promise<TableRow[]> {
    const id = this.sid(TABLES[table].file);
    return new Promise((resolve, reject) => {
      let list = this.pendingReads.get(id);
      if (!list) {
        list = [];
        this.pendingReads.set(id, list);
        queueMicrotask(() => void this.flushReads(id));
      }
      list.push({ table, resolve, reject });
    });
  }

  private async flushReads(id: string) {
    const list = this.pendingReads.get(id) ?? [];
    this.pendingReads.delete(id);
    const tables = [...new Set(list.map((x) => x.table))];
    try {
      const ranges = tables.map((t) => `ranges=${encodeURIComponent(q(t))}`).join('&');
      const res = await this.api(`${SHEETS}/${id}/values:batchGet?${ranges}&${READ_PARAMS}`);
      const byTable = new Map<TableName, unknown[][]>(tables.map((t, i) => [t, res.valueRanges?.[i]?.values ?? []]));
      // 每次各自解析（呼叫端可能會改資料內容，不共用同一份）
      for (const x of list) x.resolve(this.parseRows(x.table, byTable.get(x.table)!));
    } catch (e) {
      for (const x of list) x.reject(e);
    }
  }

  private parseRows(table: TableName, values: unknown[][]): TableRow[] {
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
