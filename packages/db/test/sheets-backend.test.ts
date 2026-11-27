import { afterEach, expect, it, vi } from 'vitest';
import { memoryStorage, SheetsBackend, TABLES, tablesOfFile, type GoogleAuth } from '../src';

afterEach(() => vi.unstubAllGlobals());

function oldCalendarSheet(failWrite = false) {
  const storage = memoryStorage();
  storage.setItem('life.sheetId.calendar', 'test-id');
  storage.setItem('life.folderId', 'test-folder');
  storage.setItem('life.marked.test-id', '1');
  storage.setItem('life.filed.test-id', '1');
  vi.stubGlobal('localStorage', storage);
  const calls: { operation: string; body: any }[] = [];
  const tables = tablesOfFile('calendar');
  const eventColumns = TABLES.calendarEvents.columns.map(({ name }) => name);
  const initialColumns = 34;
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const operation = url.pathname.split('/test-id').at(-1)!;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    if (url.hostname !== 'sheets.googleapis.com') return Response.json({ id: 'test-folder', trashed: false });
    if (operation === '') return Response.json({ sheets: [
      ...tables.map((title, sheetId) => ({ properties: { title, sheetId,
        gridProperties: { columnCount: title === 'calendarEvents' ? initialColumns : 26 } } })),
      { properties: { title: '說明', sheetId: 20, gridProperties: { columnCount: 26 } } },
    ] });
    if (operation === '/values:batchGet') return Response.json({ valueRanges: tables.map((name) => ({
      values: [name === 'calendarEvents' ? eventColumns.slice(0, initialColumns) : TABLES[name].columns.map(({ name }) => name)],
    })) });
    calls.push({ operation, body });
    if (failWrite && operation === '/values:batchUpdate') {
      return Response.json({ error: { message: 'Invalid data[0]: Range exceeds grid limits' } }, { status: 400 });
    }
    return Response.json({});
  }));
  const backend = new SheetsBackend({ getToken: () => 'test-token' } as GoogleAuth);
  return { backend, calls, eventColumns, initialColumns, sheetId: tables.indexOf('calendarEvents') };
}

it('舊行事曆工作表先擴充欄數，再寫入缺漏的欄名', async () => {
  const { backend, calls, eventColumns, initialColumns, sheetId } = oldCalendarSheet();
  await backend.init(['calendar']);
  expect(calls[0]).toEqual({ operation: ':batchUpdate', body: { requests: [
    { appendDimension: { sheetId, dimension: 'COLUMNS', length: eventColumns.length - initialColumns } },
  ] } });
  const result = calls.find(({ operation }) => operation === '/values:batchUpdate');
  expect(result?.body.data[0]).toEqual({ range: "'calendarEvents'!AI1", values: [eventColumns.slice(initialColumns)] });
});

it('Google 只回傳寫入索引時，也會顯示試算表與工作表名稱', async () => {
  const { backend } = oldCalendarSheet(true);
  await expect(backend.init(['calendar'])).rejects.toThrow('生活APP-行事曆／calendarEvents');
});
