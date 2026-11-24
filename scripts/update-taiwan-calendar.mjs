/**
 * GitHub Pages 建置用：下載政府開放資料，產生同網域的辦公日曆 JSON。
 * 不修改儲存庫；產物只會放進這次部署的 apps/calendar/dist。
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const url = 'https://data.ntpc.gov.tw/api/datasets/308dcd75-6434-45bc-a95f-584da4fed251/json?page=0&size=5000';
const response = await fetch(url);
if (!response.ok) throw new Error(`政府辦公日曆下載失敗：${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length < 300) throw new Error('政府辦公日曆資料筆數異常');

const dateKey = (value) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
const isWeekend = (value) => {
  const date = dateKey(value);
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
};
const includedForEveryone = (row) => row.holidaycategory !== '特定節日' || (row.name === '勞動節' && Number(row.year) >= 2026);
const titleOf = (row, type) => {
  if (row.name?.trim()) return row.name.trim();
  if (type === 'workday') return '補班日';
  if (row.holidaycategory === '補假' && row.description?.trim()) return row.description.trim();
  return row.holidaycategory === '調整放假日' ? '調整放假日' : row.description?.trim() || '休假日';
};

const days = rows.filter((row) => {
  const holiday = row.isholiday === '是';
  return includedForEveryone(row) && (row.name || holiday !== isWeekend(row.date));
}).map((row) => {
  const type = row.isholiday === '是' ? 'holiday' : 'workday';
  return { date: dateKey(row.date), type, title: titleOf(row, type) };
}).sort((a, b) => a.date.localeCompare(b.date));

const years = rows.map((row) => Number(row.year)).filter(Number.isFinite);
const version = createHash('sha256').update(JSON.stringify(days)).digest('hex').slice(0, 16);
const resource = { version, firstYear: Math.min(...years), lastYear: Math.max(...years), days };
await mkdir(new URL('../apps/calendar/public/', import.meta.url), { recursive: true });
await writeFile(new URL('../apps/calendar/public/taiwan-calendar.json', import.meta.url), `${JSON.stringify(resource)}\n`);
console.log(`台灣辦公日曆 ${resource.firstYear}～${resource.lastYear}，${days.length} 個特殊日期，版本 ${version}`);
