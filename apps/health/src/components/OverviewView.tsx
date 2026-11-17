import type { ReactNode } from 'react';
import type { HealthSnapshot, Judge } from '@life/db';
import { addDays, bodyField, bodyValue, judgeBp, judgeGlucose, judgeTemp, mismatchFields, startOfDay, todayKey, toHHmm } from '@life/db';
import type { HealthApi } from '../useHealth';
import type { Nav } from '../App';
import { fmt } from '../format';
import { Badge } from './vital';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
function dateLabel(d: string) {
  const today = todayKey();
  const wd = WEEK[new Date(startOfDay(d)).getDay()];
  const [, m, day] = d.split('-').map(Number);
  const rel = d === today ? '今天' : d === addDays(today, -1) ? '昨天' : '';
  return `${m}/${day}（${wd}）${rel}`;
}

interface Entry {
  key: string;
  time: number;
  icon: string;
  name: string;
  value: ReactNode;
  judge?: Judge | null;
  note?: string | null;
  onClick: () => void;
}

/** 那一天所有的紀錄，依時間排（舊 → 新） */
function entriesOf(snap: HealthSnapshot, date: string, nav: Nav): Entry[] {
  const out: Entry[] = [];
  for (const m of snap.body) {
    if (m.date !== date) continue;
    // 體重以外，顯示設定裡打勾、這筆有填的項目
    const extra = snap.settings.bodyFields
      .filter((k) => k !== 'kg')
      .map((k) => ({ k, v: bodyValue(m, k, snap) }))
      .filter((x) => x.v != null)
      .map(({ k, v }) => {
        const f = bodyField(k);
        return `${f.label} ${fmt(k, v)}${f.unit === '%' ? '%' : f.unit ? ` ${f.unit}` : ''}`;
      });
    out.push({
      key: m.id,
      time: m.time,
      icon: '⚖️',
      name: '體重',
      value: (
        <>
          {m.kg.toFixed(1)} kg{mismatchFields(m, snap).length > 0 && ' ⚠️'}
          {extra.length > 0 && <div className="tl-extra">{extra.join('、')}</div>}
        </>
      ),
      note: m.note,
      onClick: () => nav.edit(m, 'overview'),
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
      onClick: () => nav.vital('bp', { rec: x }, 'overview'),
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
      onClick: () => nav.vital('glucose', { rec: x }, 'overview'),
    });
  }
  for (const x of snap.temps) {
    if (x.date !== date) continue;
    out.push({
      key: x.id,
      time: x.time,
      icon: '🌡️',
      name: x.kind === '基礎' ? '基礎體溫' : `體溫${x.site ? ` ${x.site}` : ''}`,
      value: `${x.celsius.toFixed(x.kind === '基礎' ? 2 : 1)} °C`,
      judge: judgeTemp(x.kind, x.celsius),
      note: x.note,
      onClick: () => nav.vital('temp', { rec: x }, 'overview'),
    });
  }
  // 偶爾量測：同一個時間記的合成一列
  const occ = new Map<number, typeof snap.occ>();
  for (const o of snap.occ) if (o.date === date) occ.set(o.time, [...(occ.get(o.time) ?? []), o]);
  for (const [time, list] of occ) {
    const unit = (name: string) => snap.items.find((i) => i.name === name)?.unit ?? '';
    out.push({
      key: `occ-${time}`,
      time,
      icon: '📏',
      name: list.length === 1 ? list[0].item : '偶爾量測',
      value: list.map((o) => `${list.length === 1 ? '' : `${o.item} `}${o.value}${unit(o.item) ? ` ${unit(o.item)}` : ''}`).join('、'),
      note: list.find((o) => o.note)?.note,
      onClick: () => nav.occ(),
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** 總覽：一天一天看，那天記的所有東西依時間排（2026-11-17 使用者決定） */
export function OverviewView(props: { api: HealthApi; snap: HealthSnapshot; nav: Nav; date: string; setDate: (d: string) => void }) {
  const { api, snap, nav, date, setDate } = props;
  const isToday = date >= todayKey();
  const mismatches = snap.body.filter((m) => mismatchFields(m, snap).length > 0);
  const lastTemp = snap.temps[snap.temps.length - 1];
  const entries = entriesOf(snap, date, nav);

  return (
    <div className="overview">
      <div className="messages">
        {snap.issues.length > 0 && (
          <button className="msg warn" onClick={() => nav.go('issues')}>
            ⚠️ 健康試算表有 {snap.issues.length} 筆資料需要補齊 ›
          </button>
        )}
        {mismatches.length > 0 && (
          <button className="msg warn" onClick={() => nav.edit(mismatches[mismatches.length - 1], 'overview')}>
            ⚠️ 有 {mismatches.length} 筆身體量測的數值對不起來（BMI 或 % 和 kg） ›
          </button>
        )}
      </div>

      {/* 快速記錄：記的是現在，記完回到今天 */}
      <div className="quick" onClickCapture={() => setDate(todayKey())}>
        <button onClick={() => nav.newBody('overview')}>
          <span className="q-icon">⚖️</span>記身體
        </button>
        <button onClick={() => nav.vital('bp', undefined, 'overview')}>
          <span className="q-icon">🩸</span>記血壓
        </button>
        <button onClick={() => nav.vital('glucose', undefined, 'overview')}>
          <span className="q-icon">🍬</span>記血糖
        </button>
        <button onClick={() => nav.vital('temp', { rec: null, tempKind: lastTemp?.kind ?? '一般' }, 'overview')}>
          <span className="q-icon">🌡️</span>記體溫
        </button>
      </div>

      <section className="card">
        <div className="date-nav">
          <button className="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="前一天">
            ‹
          </button>
          <span className="date-label">{dateLabel(date)}</span>
          <button className="icon-btn" onClick={() => setDate(addDays(date, 1))} disabled={isToday} aria-label="後一天">
            ›
          </button>
          {!isToday && (
            <button className="link" onClick={() => setDate(todayKey())}>
              回今天
            </button>
          )}
        </div>
        {entries.length === 0 ? (
          <p className="muted center-text">這天沒有紀錄</p>
        ) : (
          <ul className="timeline">
            {entries.map((e) => (
              <li key={e.key} onClick={e.onClick} title="點一下修改">
                <span className="tl-time">{toHHmm(e.time)}</span>
                <span className="tl-icon">{e.icon}</span>
                <span className="tl-main">
                  <span className="tl-name">{e.name}</span> <span className="tl-value">{e.value}</span>
                  {e.note && <div className="tl-extra">📝 {e.note}</div>}
                </span>
                <Badge judge={e.judge ?? null} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {api.busy && <p className="muted small center-text">更新中⋯⋯</p>}
      <p className="muted small center-text">數值僅供記錄參考，不能取代醫療建議。</p>
    </div>
  );
}
