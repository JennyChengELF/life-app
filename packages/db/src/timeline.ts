/**
 * 一天的時間軸：把那天記的東西（身體、血壓、血糖、體溫、偶爾量測、喝水）依時間排。
 * 健康 APP 的總覽、綜合首頁共用。
 */
import type { HealthSnapshot } from './health';
import { bodyField, bodyValue, mismatchFields } from './health';
import type { Judge } from './vitals';
import { judgeBp, judgeGlucose, judgeTemp } from './vitals';
import type { WaterSnapshot } from './water';
import { computeGoal, drinkOf, goalWeight } from './water';

/** 點一列要修改的是哪一筆 */
export type EntryRef =
  | { app: 'health'; kind: 'body' | 'bp' | 'glucose' | 'temp'; id: string }
  | { app: 'health'; kind: 'occ'; id: string }
  | { app: 'water'; kind: 'water'; id: string };

export interface TimelineEntry {
  key: string;
  time: number;
  icon: string;
  name: string;
  value: string;
  /** 第二行小字 */
  extra?: string;
  judge?: Judge | null;
  /** 數值對不起來（例：BMI） */
  warn?: boolean;
  note?: string | null;
  ref: EntryRef;
}

const decimalsOfTemp = (kind: string) => (kind === '基礎' ? 2 : 1);

export function healthEntries(snap: HealthSnapshot, date: string): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const m of snap.body) {
    if (m.date !== date) continue;
    // 體重以外：設定裡打勾、這筆有填的項目
    const extra = snap.settings.bodyFields
      .filter((k) => k !== 'kg')
      .map((k) => ({ k, v: bodyValue(m, k, snap) }))
      .filter((x) => x.v != null)
      .map(({ k, v }) => {
        const f = bodyField(k);
        return `${f.label} ${v!.toFixed(f.decimals)}${f.unit === '%' ? '%' : f.unit ? ` ${f.unit}` : ''}`;
      });
    out.push({
      key: m.id,
      time: m.time,
      icon: '⚖️',
      name: '體重',
      value: `${m.kg.toFixed(1)} kg`,
      extra: extra.join('、') || undefined,
      warn: mismatchFields(m, snap).length > 0,
      note: m.note,
      ref: { app: 'health', kind: 'body', id: m.id },
    });
  }
  for (const x of snap.bp) {
    if (x.date !== date) continue;
    out.push({
      key: x.id,
      time: x.time,
      icon: '🩸',
      name: '血壓',
      value: `${x.systolic}/${x.diastolic}${x.pulse != null ? ` · 脈搏 ${x.pulse}` : ''}`,
      judge: judgeBp(x.systolic, x.diastolic),
      note: x.note,
      ref: { app: 'health', kind: 'bp', id: x.id },
    });
  }
  for (const x of snap.glucose) {
    if (x.date !== date) continue;
    out.push({
      key: x.id,
      time: x.time,
      icon: '🍬',
      name: `血糖 ${x.timing}`,
      value: `${x.mgdl} mg/dL`,
      judge: judgeGlucose(x.timing, x.mgdl),
      note: x.note,
      ref: { app: 'health', kind: 'glucose', id: x.id },
    });
  }
  for (const x of snap.temps) {
    if (x.date !== date) continue;
    out.push({
      key: x.id,
      time: x.time,
      icon: '🌡️',
      name: x.kind === '基礎' ? '基礎體溫' : `體溫${x.site ? ` ${x.site}` : ''}`,
      value: `${x.celsius.toFixed(decimalsOfTemp(x.kind))} °C`,
      judge: judgeTemp(x.kind, x.celsius),
      note: x.note,
      ref: { app: 'health', kind: 'temp', id: x.id },
    });
  }
  // 偶爾量測：同一個時間記的合成一列
  const occ = new Map<number, HealthSnapshot['occ']>();
  for (const o of snap.occ) if (o.date === date) occ.set(o.time, [...(occ.get(o.time) ?? []), o]);
  const unit = (name: string) => snap.items.find((i) => i.name === name)?.unit ?? '';
  for (const [time, list] of occ) {
    const one = list.length === 1;
    out.push({
      key: `occ-${time}`,
      time,
      icon: '📏',
      name: one ? list[0].item : '偶爾量測',
      value: list.map((o) => `${one ? '' : `${o.item} `}${o.value}${unit(o.item) ? ` ${unit(o.item)}` : ''}`).join('、'),
      note: list.find((o) => o.note)?.note,
      ref: { app: 'health', kind: 'occ', id: list[0].id },
    });
  }
  return out;
}

export function waterEntries(snap: WaterSnapshot, date: string): TimelineEntry[] {
  return snap.logs
    .filter((l) => l.date === date)
    .map((l) => ({
      key: l.id,
      time: l.time,
      icon: '💧',
      name: `喝水 ${drinkOf(l, snap.drinks)}`,
      value: `${l.ml} ml`,
      note: l.note,
      ref: { app: 'water' as const, kind: 'water' as const, id: l.id },
    }));
}

/** 那天的喝水總量、目標（還沒有目標紀錄的日子用規則算） */
export function waterSummary(snap: WaterSnapshot, date: string): { total: number; goal: number } {
  const total = snap.logs.filter((l) => l.date === date).reduce((s, l) => s + l.ml, 0);
  const goal = snap.days.get(date)?.goal ?? computeGoal(goalWeight(snap.weights, date)?.kg ?? null, snap.settings).goal;
  return { total, goal };
}

export const sortEntries = (list: TimelineEntry[]) => [...list].sort((a, b) => a.time - b.time);

/**
 * 從別的頁面（例：綜合首頁）直接打開某一筆的修改畫面：網址 #edit/種類/id
 * 喝水：#edit/water/id；健康：#edit/bp/id 等
 */
export const editHash = (ref: EntryRef) => `#edit/${ref.kind}/${ref.id}`;

export function parseEditHash(hash: string): { kind: EntryRef['kind']; id: string } | null {
  const m = /^#edit\/(body|bp|glucose|temp|occ|water)\/(.+)$/.exec(hash);
  return m ? { kind: m[1] as EntryRef['kind'], id: decodeURIComponent(m[2]) } : null;
}
