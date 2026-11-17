import { useState } from 'react';
import type { WaterLog, WaterSnapshot } from '@life/db';
import { addDays, computeGoal, latestWeight, startOfDay, todayKey, toHHmm } from '@life/db';
import type { WaterApi } from '../useWater';
import type { Tab } from '../App';
import { LogEditor } from './LogEditor';
import { ProgressRing } from './ProgressRing';

const QUICK = [150, 250, 500];

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
function dateLabel(d: string) {
  const today = todayKey();
  const wd = WEEK[new Date(startOfDay(d)).getDay()];
  const [, m, day] = d.split('-').map(Number);
  const rel = d === today ? '今天' : d === addDays(today, -1) ? '昨天' : '';
  return `${m}/${day}（${wd}）${rel}`;
}

/** 在選的日期記錄：今天用現在時間；其他天用那天的現在時刻 */
function timeForDate(date: string) {
  const now = new Date();
  if (date === todayKey()) return now.getTime();
  const base = new Date(startOfDay(date));
  base.setHours(now.getHours(), now.getMinutes(), 0, 0);
  return base.getTime();
}

export function TodayView(props: { api: WaterApi; snap: WaterSnapshot; date: string; setDate: (d: string) => void; goTo: (t: Tab) => void }) {
  const { api, snap, date, setDate, goTo } = props;
  const [custom, setCustom] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const isToday = date === todayKey();
  const logs = snap.logs.filter((l) => l.date === date).sort((a, b) => b.time - a.time);
  const total = logs.reduce((s, l) => s + l.ml, 0);
  const day = snap.days.get(date);
  const goal = day?.goal ?? computeGoal(latestWeight(snap.weights)?.kg ?? null, snap.settings).goal;
  const remaining = Math.max(0, goal - total);
  const noWeight = snap.weights.length === 0;

  const add = async (ml: number) => {
    const time = timeForDate(date);
    const tempId = `temp-${Date.now()}`;
    const id = await api.run(
      (s) => s.addLog(ml, time),
      (s) => ({ ...s, logs: [...s.logs, { rowNumber: -1, id: tempId, time, ml, note: null, date, createdVia: 'water' }] }),
    );
    if (id) {
      api.showToast({
        kind: 'info',
        text: `已記錄 +${ml}ml`,
        undo: () =>
          api.run(
            async (s) => {
              const fresh = await s.load();
              const log = fresh.logs.find((l) => l.id === id);
              if (log) await s.deleteLog(log);
            },
            (s) => ({ ...s, logs: s.logs.filter((l) => l.id !== id) }),
          ),
      });
    }
  };

  const addCustom = () => {
    const ml = Number(custom);
    if (!Number.isFinite(ml) || ml <= 0 || ml > 5000) {
      api.showToast({ kind: 'error', text: '請輸入 1–5000 的 ml' });
      return;
    }
    setCustom('');
    add(Math.round(ml));
  };

  const save = (log: WaterLog, patch: { time: number; ml: number }) => {
    setEditing(null);
    api.run((s) => s.updateLog(log, patch));
  };

  const remove = (log: WaterLog) => {
    setEditing(null);
    api.run(
      (s) => s.deleteLog(log),
      (s) => ({ ...s, logs: s.logs.filter((l) => l.id !== log.id) }),
    );
  };

  return (
    <div className="today">
      {/* 首頁上方的提醒訊息（網頁版不推播，只在這裡顯示） */}
      <div className="messages">
        {isToday && (
          <div className={`msg ${remaining === 0 ? 'ok' : 'info'}`}>
            {remaining === 0 ? '🎉 今天已達標！' : `今天還差 ${remaining.toLocaleString()} ml`}
          </div>
        )}
        {snap.waterIssues.length > 0 && (
          <button className="msg warn" onClick={() => goTo('issues')}>
            ⚠️ 試算表有 {snap.waterIssues.length} 筆喝水資料需要補齊 ›
          </button>
        )}
        {snap.weightIssues.length > 0 && (
          <button className="msg warn" onClick={() => goTo('issues')}>
            ⚠️ 健康試算表有 {snap.weightIssues.length} 筆體重資料需要補齊 ›
          </button>
        )}
        {noWeight && (
          <button className="msg info" onClick={() => goTo('settings')}>
            輸入體重可獲得個人化目標（目前用預設 2000ml） ›
          </button>
        )}
      </div>

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

      <div className="today-grid">
        <section className="card">
          <ProgressRing total={total} goal={goal} />
          {day?.locked && <p className="muted small center-text">這天的目標已鎖定（{goal.toLocaleString()} ml）</p>}

          <div className="quick">
            {QUICK.map((ml) => (
              <button key={ml} className="quick-btn" onClick={() => add(ml)}>
                +{ml}
                <small>ml</small>
              </button>
            ))}
          </div>

          {snap.cups.length > 0 && (
            <div className="cups">
              {snap.cups.map((c) => (
                <button key={c.id} className="cup-btn" onClick={() => add(c.ml)}>
                  🥤 {c.name}
                  <small>{c.ml}ml</small>
                </button>
              ))}
            </div>
          )}

          <div className="custom">
            <input
              type="number"
              inputMode="numeric"
              placeholder="其他 ml"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustom()}
            />
            <button className="primary" onClick={addCustom} disabled={!custom}>
              記錄
            </button>
          </div>
          {!isToday && <p className="muted small">在 {dateLabel(date)} 補記，時間可以記完再改</p>}
        </section>

        <section className="card">
          <h2>紀錄（{logs.length} 筆）</h2>
          {logs.length === 0 ? (
            <p className="muted">還沒有紀錄</p>
          ) : (
            <ul className="log-list">
              {logs.map((l) =>
                editing === l.id ? (
                  <li key={l.id}>
                    <LogEditor
                      time={l.time}
                      amount={l.ml}
                      unit="ml"
                      onSave={(time, ml) => save(l, { time, ml })}
                      onCancel={() => setEditing(null)}
                      onDelete={() => remove(l)}
                    />
                  </li>
                ) : (
                  <li key={l.id} className="log-row">
                    <span className="log-time">{toHHmm(l.time)}</span>
                    <span className="log-ml">{l.ml} ml</span>
                    {l.createdVia === 'sheet' && <span className="badge">試算表</span>}
                    <button className="link" onClick={() => setEditing(l.id)} disabled={l.rowNumber < 0}>
                      修改
                    </button>
                  </li>
                ),
              )}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
