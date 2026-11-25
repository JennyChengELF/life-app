/**
 * 綜合 APP（首頁）的資料：存在「生活APP-綜合」試算表。
 * 包含首頁設定與共用資料。
 */
import type { Backend, RowUpdate, RowValues, TableRow } from './backend';
import { personAnniversaryValues, readPersonAnniversaries, type PersonAnniversarySettings } from './person-anniversaries';
import type { EntryRef } from './timeline';

export const HUB_TIMELINE_OPTIONS = [
  ['water', '喝水'],
  ['body', '體重紀錄'],
  ['bp', '血壓'],
  ['glucose', '血糖'],
  ['temp', '體溫'],
  ['occ', '身體尺寸'],
  ['lab', '健檢／檢驗'],
  ['bowel', '廁所大事'],
  ['money', '記帳'],
] as const satisfies readonly (readonly [EntryRef['kind'], string])[];

export type HubTimelineKind = EntryRef['kind'];

export interface PersonAnniversaryProfile {
  id: string;
  nickname: string;
  fullName: string;
  settings: PersonAnniversarySettings;
}

export interface HubSettings {
  /** 首頁「常用」的按鈕（依順序）；null = 還沒設定過，用預設 */
  pinned: string[] | null;
  timelineKinds: HubTimelineKind[];
}

export interface HubSnapshot {
  loadedAt: number;
  settings: HubSettings;
}

const PINNED_KEY = 'hub.pinned';
const TIMELINE_KEY = 'hub.timelineKinds';

/** 「a,b,c」→ 陣列（去掉重複；空字串 = 一個都不放） */
export function parseKeyList(v: unknown): string[] | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return [];
  return [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))];
}

/** 依設定排出常用按鈕：只留認得的；沒設定過用預設 */
export function resolvePinned(pinned: string[] | null, known: readonly string[], defaults: readonly string[]): string[] {
  return (pinned ?? [...defaults]).filter((k) => known.includes(k));
}

export class HubStore {
  constructor(private b: Backend) {}

  async load(now = Date.now()): Promise<HubSnapshot> {
    const rows = await this.b.read('hubSettings');
    const row = this.find(rows, PINNED_KEY);
    const timeline = this.find(rows, TIMELINE_KEY);
    // （2026-11-25 使用者決定：記住首頁時間軸篩選；未設定時顯示全部，取消全部也可儲存。）
    const selected = timeline ? parseKeyList(timeline.values.value ?? '') ?? [] : null;
    const timelineKinds = HUB_TIMELINE_OPTIONS.map(([key]) => key).filter((key) => selected === null || selected.includes(key));
    return { loadedAt: now, settings: { pinned: row ? parseKeyList(row.values.value ?? '') : null, timelineKinds } };
  }

  async savePinned(keys: string[]) {
    await this.saveList(PINNED_KEY, keys);
  }

  async saveTimelineKinds(kinds: HubTimelineKind[]) {
    await this.saveList(TIMELINE_KEY, kinds);
  }

  private async saveList(key: string, keys: string[]) {
    const rows = await this.b.read('hubSettings');
    const row = this.find(rows, key);
    const value = keys.join(',');
    if (row) {
      const u: RowUpdate = { rowNumber: row.rowNumber, values: { value } };
      await this.b.update('hubSettings', [u]);
    } else {
      const v: RowValues = { key, value };
      await this.b.append('hubSettings', [v]);
    }
  }

  async loadPeople() {
    const rows = await this.b.read('hubPeople');
    return rows.flatMap((row) => {
      const { name, fullName, archived, deletedAt } = row.values;
      const nickname = String(name ?? '').trim();
      if (row.empty || deletedAt != null || !nickname) return [];
      return [{ rowNumber: row.rowNumber, nickname, fullName: String(fullName ?? '').trim(), archived: archived === true }];
    }).sort((a, b) => a.nickname.localeCompare(b.nickname, 'zh-Hant'));
  }

  async loadPersonAnniversaryProfiles(): Promise<PersonAnniversaryProfile[]> {
    const rows = await this.b.read('hubPeople');
    return rows.flatMap((row) => {
      const { id, name, fullName, deletedAt } = row.values;
      if (row.empty || deletedAt != null || !id || !String(name ?? '').trim()) return [];
      return [{ id: String(id), nickname: String(name).trim(), fullName: String(fullName ?? '').trim(), settings: readPersonAnniversaries(row.values) }];
    }).sort((a, b) => a.nickname.localeCompare(b.nickname, 'zh-Hant'));
  }

  async savePersonAnniversaryProfile(id: string, settings: PersonAnniversarySettings) {
    const values = personAnniversaryValues(settings);
    const row = (await this.b.read('hubPeople')).find((item) => item.values.id === id && item.values.deletedAt == null);
    if (!row) throw new Error('找不到這筆共用人物');
    await this.b.update('hubPeople', [{ rowNumber: row.rowNumber, expectId: id, values: { ...values, updatedAt: Date.now() } }]);
  }

  private find(rows: TableRow[], key: string) {
    return rows.find((r) => !r.empty && String(r.values.key ?? '').trim() === key) ?? null;
  }
}
