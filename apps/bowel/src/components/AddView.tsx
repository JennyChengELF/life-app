import { useEffect, useState } from 'react';
import type { BowelLog, BowelSnapshot } from '@life/db';
import { constipation, elapsedText, emptyInput, lastPassed, newId, startOfDay, toDateKey, todayKey, toHHmm } from '@life/db';
import { WeekDateStrip } from '@life/ui/week-date-strip';
import { Icon } from '@life/ui/icon';
import type { BowelApi } from '../useBowel';
import { LogEditor } from './LogEditor';

/** 在選的日期紀錄：今天用現在時間，其他日期使用當天的相同時刻。 */
function timeForDate(date: string) {
  const now = new Date();
  if (date === todayKey()) return now.getTime();
  const value = new Date(startOfDay(date));
  value.setHours(now.getHours(), now.getMinutes(), 0, 0);
  return value.getTime();
}

/** 2026-11-22 使用者決定：按「記一筆」後才建立紀錄並展開表單。 */
export async function startLog(api: BowelApi, date: string, setOpenId: (id: string) => void) {
  const id = newId();
  const time = timeForDate(date);
  const temp: BowelLog = { ...emptyInput(false), rowNumber: -1, id, time, date, createdVia: 'bowel' };
  setOpenId(id);
  const ok = await api.run(
    (store) => store.addLog({}, time, id),
    (snap) => ({ ...snap, logs: [...snap.logs, temp] }),
  );
  if (ok) api.showToast({ kind: 'info', text: `已開始記錄 ${toHHmm(time)}` });
}

function useNow() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 60000);
    return () => window.clearInterval(timer);
  }, []);
  return Date.now();
}

function when(ms: number) {
  const date = toDateKey(ms);
  if (date === todayKey()) return `今天 ${toHHmm(ms)}`;
  const [, month, day] = date.split('-').map(Number);
  return `${month}/${day} ${toHHmm(ms)}`;
}

export function AddView({ api, snap, date, setDate, openId, setOpenId, onDone }: {
  api: BowelApi;
  snap: BowelSnapshot;
  date: string;
  setDate: (date: string) => void;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  onDone: () => void;
}) {
  const now = useNow();
  const open = openId ? snap.logs.find((log) => log.id === openId) ?? null : null;
  const last = lastPassed(snap.logs.filter((log) => log.id !== openId), now);
  const constip = constipation(snap, now);
  return (
    <div className="bowel-add">
      {!open && <WeekDateStrip selected={date} setDate={setDate} maxDate={todayKey()} />}
      {!open && constip && <div className="msg warn">已經 {constip.days} 天沒有排便，記得多喝水、多吃蔬菜。</div>}
      {!open && (
        <section className="card since">
          <div className="since-label">距離上次排便</div>
          <div className="since-value">{last ? elapsedText(now - last.time) : '—'}</div>
          <div className="muted small">{last ? `上次：${when(last.time)}` : '還沒有紀錄'}</div>
          <div className="add-row"><button className="primary big" onClick={() => startLog(api, date, (id) => setOpenId(id))}><Icon name="plus" size={20} /> 記一筆</button></div>
          {date !== todayKey() && <p className="muted small">在這天補記，時間可以在表單裡調整。</p>}
        </section>
      )}
      {open && (
        <section className="card">
          <LogEditor
            api={api}
            log={open}
            onClose={() => {
              setOpenId(null);
              onDone();
            }}
            onMoved={setDate}
          />
        </section>
      )}
    </div>
  );
}
