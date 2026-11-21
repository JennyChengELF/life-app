/**
 * 一天的時間軸：把那天記的東西（身體、血壓、血糖、體溫、偶爾量測、喝水、排便）依時間排。
 * 健康 APP 的總覽、綜合首頁共用。
 */
import type { HealthSnapshot } from './health';
import { bodyField, bodyValue, mismatchFields } from './health';
import type { Judge } from './vitals';
import { judgeBp, judgeGlucose, judgeTemp } from './vitals';
import { judgeLab } from './lab';
import { startOfDay } from './time';
import type { BowelSnapshot } from './bowel';
import { bowelSummary, judgeBowel } from './bowel';
import type { WaterSnapshot } from './water';
import { computeGoal, drinkOf, goalWeight } from './water';
import type { MoneySnapshot } from './money';
import { fmtMoney, isRecordOnlyTxn, txnCurrency, txnMyNet, txnTitle } from './money';

/** 點一列要修改的是哪一筆 */
export type EntryRef =
  | { app: 'health'; kind: 'body' | 'bp' | 'glucose' | 'temp'; id: string }
  | { app: 'health'; kind: 'occ'; id: string }
  | { app: 'health'; kind: 'lab'; id: string }
  | { app: 'water'; kind: 'water'; id: string }
  | { app: 'bowel'; kind: 'bowel'; id: string }
  | { app: 'money'; kind: 'money'; id: string };

/** 時間軸的線條圖示名稱（2026-11-19；要是 @life/ui/icon 有的圖示） */
export type TimelineIcon = 'weight' | 'heartPulse' | 'candy' | 'thermometer' | 'ruler' | 'testTube' | 'droplet' | 'toilet' | 'wallet';

export interface TimelineEntry {
  key: string;
  time: number;
  icon: TimelineIcon;
  name: string;
  value: string;
  /** 第二行小字 */
  extra?: string;
  judge?: Judge | null;
  /** 整天的（例：健檢報告只有日期）：不顯示時間、排在最前面 */
  allDay?: boolean;
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
      icon: 'weight',
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
      icon: 'heartPulse',
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
      icon: 'candy',
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
      icon: 'thermometer',
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
      icon: 'ruler',
      name: one ? list[0].item : '偶爾量測',
      value: list.map((o) => `${one ? '' : `${o.item} `}${o.value}${unit(o.item) ? ` ${unit(o.item)}` : ''}`).join('、'),
      note: list.find((o) => o.note)?.note,
      ref: { app: 'health', kind: 'occ', id: list[0].id },
    });
  }
  // 健檢 / 檢驗報告：只有日期
  for (const rep of snap.labReports) {
    if (rep.date !== date) continue;
    const results = snap.labResults.filter((r) => r.reportId === rep.id);
    const judges = results.map((r) => judgeLab(r, snap.labItems.find((i) => i.name === r.item) ?? null));
    const bad = judges.filter((j) => j && j.level !== 'ok').length;
    out.push({
      key: rep.id,
      time: startOfDay(date),
      allDay: true,
      icon: 'testTube',
      name: rep.kind + (rep.place ? ` ${rep.place}` : ''),
      value: `${results.length} 項`,
      judge: bad ? { level: judges.some((j) => j?.level === 'bad') ? 'bad' : 'warn', label: `${bad} 項異常` } : results.length ? { level: 'ok', label: '都正常' } : null,
      note: rep.note,
      ref: { app: 'health', kind: 'lab', id: rep.id },
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
      icon: 'droplet',
      name: `喝水 ${drinkOf(l, snap.drinks)}`,
      value: `${l.ml} ml`,
      note: l.note,
      ref: { app: 'water' as const, kind: 'water' as const, id: l.id },
    }));
}

export function bowelEntries(snap: BowelSnapshot, date: string): TimelineEntry[] {
  return snap.logs
    .filter((l) => l.date === date)
    .map((l) => {
      const extra = l.symptoms.filter((s) => s !== '無特殊狀況').join('、');
      return {
        key: l.id,
        time: l.time,
        icon: 'toilet',
        name: '排便',
        value: bowelSummary(l) || '（沒填細節）',
        extra: extra || undefined,
        judge: judgeBowel(l),
        note: l.note,
        ref: { app: 'bowel' as const, kind: 'bowel' as const, id: l.id },
      };
    });
}

/** 記帳（2026-11-18）：每一筆交易；金額是「我」的收支（支出負、收入正），轉帳、借還款顯示金額 */
export function moneyEntries(snap: MoneySnapshot, date: string): TimelineEntry[] {
  return snap.txns
    .filter((t) => t.date === date)
    .map((t) => {
      const cur = txnCurrency(t, snap.accounts);
      const { expense, income } = txnMyNet(t);
      const net = income - expense;
      const value = expense || income ? `${net < 0 ? '−' : '+'}${fmtMoney(Math.abs(net), cur)}` : fmtMoney(t.amount ?? 0, cur);
      const extra = [
        isRecordOnlyTxn(t) ? '僅記錄' : null,
        t.store,
        t.direction === '轉帳'
          ? t.cardPayments.length
            ? `${t.account} → ${[...new Set(t.cardPayments.map((x) => x.account))].join('、')}`
            : `${t.account} → ${t.toAccount}`
          : (t.account ?? (t.paidBy ? `${t.paidBy} 先付` : null)),
      ]
        .filter(Boolean)
        .join('・');
      return {
        key: t.id,
        time: t.time,
        icon: 'wallet',
        name: txnTitle(t),
        value,
        extra: extra || undefined,
        note: t.note,
        ref: { app: 'money' as const, kind: 'money' as const, id: t.id },
      };
    });
}

/** 那天「我」的支出、收入合計（新台幣） */
export function moneyDayTotals(snap: MoneySnapshot, date: string): { expense: number; income: number } {
  let expense = 0;
  let income = 0;
  for (const t of snap.txns) {
    if (t.date !== date || txnCurrency(t, snap.accounts) !== 'TWD') continue;
    const n = txnMyNet(t);
    expense += n.expense;
    income += n.income;
  }
  return { expense, income };
}

/** 那天的喝水總量、目標（還沒有目標紀錄的日子用規則算） */
export function waterSummary(snap: WaterSnapshot, date: string): { total: number; goal: number } {
  const total = snap.logs.filter((l) => l.date === date).reduce((s, l) => s + l.ml, 0);
  const goal = snap.days.get(date)?.goal ?? computeGoal(goalWeight(snap.weights, date)?.kg ?? null, snap.settings).goal;
  return { total, goal };
}

export const sortEntries = (list: TimelineEntry[]) => [...list].sort((a, b) => Number(!!b.allDay) - Number(!!a.allDay) || a.time - b.time);

/**
 * 從別的頁面（例：綜合首頁）直接打開某一筆的修改畫面：網址 #edit/種類/id
 * 喝水：#edit/water/id；健康：#edit/bp/id 等
 */
export const editHash = (ref: EntryRef) => `#edit/${ref.kind}/${ref.id}`;

export function parseEditHash(hash: string): { kind: EntryRef['kind']; id: string } | null {
  const m = /^#edit\/(body|bp|glucose|temp|occ|lab|water|bowel|money)\/(.+)$/.exec(hash);
  return m ? { kind: m[1] as EntryRef['kind'], id: decodeURIComponent(m[2]) } : null;
}
