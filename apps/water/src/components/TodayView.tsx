import { useEffect, useState } from 'react';
import { Icon } from '@life/ui/icon';
import type { WaterLog, WaterSnapshot } from '@life/db';
import { addDays, computeGoal, drinkOf, goalWeight, startOfDay, todayKey, toHHmm } from '@life/db';
import type { WaterApi } from '../useWater';
import { drinkColor, totalsByDrink } from '../drinkColors';
import type { Tab } from '../App';
import { LogEditor } from './LogEditor';
import { ProgressRing } from './ProgressRing';

const QUICK = [150, 250, 500];
/** 選這個飲品時顯示備註欄 */
const OTHER = '其他';

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

export function TodayView(props: {
  api: WaterApi;
  snap: WaterSnapshot;
  date: string;
  setDate: (d: string) => void;
  goTo: (t: Tab) => void;
  /** 一打開就修改這一筆（從綜合首頁點進來） */
  editId?: string | null;
  /** 有的話：改完 / 取消後呼叫（回首頁） */
  onEditDone?: () => void;
}) {
  const { api, snap, date, setDate, goTo } = props;
  const [custom, setCustom] = useState('');
  const [editing, setEditing] = useState<string | null>(props.editId ?? null);
  useEffect(() => {
    if (props.editId) setEditing(props.editId);
  }, [props.editId]);
  // null = 預設飲品（清單第一個，開水）；記完一筆就回到預設
  const [picked, setPicked] = useState<string | null>(null);
  const defaultDrink = snap.drinks[0]?.name ?? '開水';
  const drink = picked && snap.drinks.some((d) => d.name === picked) ? picked : defaultDrink;
  // 選「其他」時可以加備註（沒填就不存）
  const [note, setNote] = useState('');
  const showNote = drink === OTHER;

  const isToday = date === todayKey();
  const logs = snap.logs.filter((l) => l.date === date).sort((a, b) => b.time - a.time);
  const total = logs.reduce((s, l) => s + l.ml, 0);
  const day = snap.days.get(date);
  const goal = day?.goal ?? computeGoal(goalWeight(snap.weights, date)?.kg ?? null, snap.settings).goal;
  const remaining = Math.max(0, goal - total);
  const noWeight = snap.weights.length === 0;
  /** 只有今天量的體重：目標明天才會用 */
  const onlyTodayWeight = !noWeight && isToday && goalWeight(snap.weights, date) == null;
  const byDrink = totalsByDrink(
    logs.map((l) => ({ drink: drinkOf(l, snap.drinks), ml: l.ml })),
    snap.drinks,
  );

  const add = async (ml: number) => {
    const time = timeForDate(date);
    const tempId = `temp-${Date.now()}`;
    const d = drink;
    const n = showNote ? note.trim() || null : null;
    setPicked(null);
    setNote('');
    const id = await api.run(
      (s) => s.addLog(ml, time, d, n),
      (s) => ({ ...s, logs: [...s.logs, { rowNumber: -1, id: tempId, time, ml, drink: d, note: n, date, createdVia: 'water' }] }),
    );
    if (id) {
      api.showToast({
        kind: 'info',
        text: `已記錄 ${d}${n ? `（${n}）` : ''} +${ml}ml`,
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

  const save = async (log: WaterLog, patch: { time: number; ml: number; drink: string; note: string | null }) => {
    setEditing(null);
    await api.run((s) => s.updateLog(log, patch));
    props.onEditDone?.();
  };

  const remove = async (log: WaterLog) => {
    setEditing(null);
    await api.run(
      (s) => s.deleteLog(log),
      (s) => ({ ...s, logs: s.logs.filter((l) => l.id !== log.id) }),
    );
    props.onEditDone?.();
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
        {onlyTodayWeight && <div className="msg info">今天量的體重明天開始用來算目標（今天先用預設 2000ml）</div>}
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
          {byDrink.length > 0 && (
            <p className="by-drink">
              {byDrink.map((b) => (
                <span key={b.drink}>
                  <i className="dot" style={{ background: drinkColor(b.drink, snap.drinks) }} />
                  {b.drink} {b.ml.toLocaleString()}
                </span>
              ))}
            </p>
          )}
          {day?.locked && <p className="muted small center-text">這天的目標已鎖定（{goal.toLocaleString()} ml）</p>}

          <div className="drink-pick" role="radiogroup" aria-label="喝什麼">
            {snap.drinks.map((d) => (
              <button
                key={d.id}
                role="radio"
                aria-checked={drink === d.name}
                className={drink === d.name ? 'active' : ''}
                style={drink === d.name ? { background: drinkColor(d.name, snap.drinks), borderColor: 'transparent' } : undefined}
                onClick={() => setPicked(d.name)}
              >
                {d.name}
              </button>
            ))}
          </div>

          {showNote && (
            <input
              className="note-input"
              type="text"
              placeholder="備註（可不填，例：咖啡、湯）"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={100}
            />
          )}

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
                  <Icon name="cup" size={20} /> {c.name}
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
                      drink={drinkOf(l, snap.drinks)}
                      drinks={snap.drinks.map((d) => d.name)}
                      note={l.note}
                      noteFor={OTHER}
                      onSave={(time, ml, dr, n) => save(l, { time, ml, drink: dr ?? drinkOf(l, snap.drinks), note: n ?? null })}
                      onCancel={() => {
                        setEditing(null);
                        props.onEditDone?.();
                      }}
                      onDelete={() => remove(l)}
                    />
                  </li>
                ) : (
                  <li key={l.id} className="log-row">
                    <span className="log-time">{toHHmm(l.time)}</span>
                    <span className="drink-tag">
                      <i className="dot" style={{ background: drinkColor(drinkOf(l, snap.drinks), snap.drinks) }} />
                      {drinkOf(l, snap.drinks)}
                    </span>
                    {l.note && <span className="log-note">{l.note}</span>}
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
