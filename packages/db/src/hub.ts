/**
 * 綜合 APP（首頁）的資料：存在「生活APP-綜合」試算表。
 * 目前只有設定；之後人物、商店等共用資料也放這份（2026-11-18 使用者決定）。
 */
import type { Backend, RowUpdate, RowValues, TableRow } from './backend';

export interface HubSettings {
  /** 首頁「常用」的按鈕（依順序）；null = 還沒設定過，用預設 */
  pinned: string[] | null;
}

export interface HubSnapshot {
  loadedAt: number;
  settings: HubSettings;
}

const PINNED_KEY = 'hub.pinned';

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
    // 沒有這一列 = 還沒設定過（和「設定成一個都不放」不同）
    return { loadedAt: now, settings: { pinned: row ? parseKeyList(row.values.value ?? '') : null } };
  }

  async savePinned(keys: string[]) {
    const rows = await this.b.read('hubSettings');
    const row = this.find(rows, PINNED_KEY);
    const value = keys.join(',');
    if (row) {
      const u: RowUpdate = { rowNumber: row.rowNumber, values: { value } };
      await this.b.update('hubSettings', [u]);
    } else {
      const v: RowValues = { key: PINNED_KEY, value };
      await this.b.append('hubSettings', [v]);
    }
  }

  private find(rows: TableRow[], key: string) {
    return rows.find((r) => !r.empty && String(r.values.key ?? '').trim() === key) ?? null;
  }
}
