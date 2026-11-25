import type { Backend, RowUpdate, TableRow } from './backend';
import { newId } from './ids';

export interface SharedTag {
  id: string;
  name: string;
  color: string | null;
  order: number | null;
  archived: boolean;
}

export function readTagIds(value: unknown): string[] {
  return [...new Set(String(value ?? '').split(',').map((id) => id.trim()).filter(Boolean))];
}

export const writeTagIds = (ids: string[]) => readTagIds(ids.join(',')).join(',') || null;

const liveNamed = (row: TableRow) => !row.empty && row.values.deletedAt == null && !!String(row.values.name ?? '').trim();
const nameOf = (name: string) => name.trim().replace(/^[#＃]+\s*/, '');

export async function loadSharedTags(backend: Backend, now = Date.now()): Promise<SharedTag[]> {
  const rows = (await backend.read('hubTags')).filter(liveNamed);
  const fixes: RowUpdate[] = [];
  const tags = rows.map((row) => {
    const existing = String(row.values.id ?? '').trim();
    const id = existing || newId(now);
    if (!existing) fixes.push({ rowNumber: row.rowNumber, expectId: '', values: { id, createdAt: now, updatedAt: now } });
    return {
      id, name: String(row.values.name).trim(), color: row.values.color ? String(row.values.color) : null,
      order: typeof row.values.order === 'number' ? row.values.order : null, archived: row.values.archived === true,
    };
  });
  if (fixes.length) await backend.update('hubTags', fixes);
  return tags.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.name.localeCompare(b.name, 'zh-Hant'));
}

export async function addSharedTag(backend: Backend, input: string) {
  const name = nameOf(input);
  if (!name) throw new Error('請填標籤名稱');
  const rows = (await backend.read('hubTags')).filter(liveNamed);
  if (rows.some((row) => nameOf(String(row.values.name)).toLowerCase() === name.toLowerCase())) {
    throw new Error(`已經有標籤「${name}」`);
  }
  const now = Date.now();
  const id = newId(now);
  const order = rows.reduce((max, row) => Math.max(max, Number(row.values.order) || 0), 0) + 1;
  await backend.append('hubTags', [{ id, name, order, createdAt: now, updatedAt: now }]);
  return id;
}
