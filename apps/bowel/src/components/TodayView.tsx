import { useEffect, useState } from 'react';
import type { BowelLog, BowelSnapshot } from '@life/db';
import { bowelSummary, constipation, diarrhea, elapsedText, emptyInput, judgeBowel, lastPassed, newId, startOfDay, toDateKey, todayKey, toHHmm } from '@life/db';
import { MonthCalendar } from '@life/ui/month-calendar';
import { dateLabel } from '@life/ui/timeline';
import { Icon } from '@life/ui/icon';
import type { BowelApi } from '../useBowel';
import type { Tab } from '../App';
import { LogEditor } from './LogEditor';

/** 在選的日期記錄：今天用現在時間；其他天用那天的現在時刻 */
function timeForDate(date: string) {
  const now = new Date();
  if (date === todayKey()) return now.getTime();
  const base = new Date(startOfDay(date));
  base.setHours(now.getHours(), now.getMinutes(), 0, 0);
  return base.getTime();
}

/** 一鍵開始：馬上存時間並展開；選了型態才算有排出（2026-11-19 確認） */
export async function startLog(api: BowelApi, date: string, setOpenId: (id: string) => void) {
  const id = newId();
  const time = timeForDate(date);
  const temp: BowelLog = { ...emptyInput(false), rowNumber: -1, id, time, date, createdVia: 'bowel' };
  setOpenId(id);
  const ok = await api.run(
    (s) => s.addLog({}, time, id),
    (s) => ({ ...s, logs: [...s.logs, temp] }),
  );
  if (ok) api.showToast({ kind: 'info', text: `已開始記錄 ${toHHmm(time)}` });
}

function fmtWhen(ms: number) {
  const d = toDateKey(ms);
  const today = todayKey();
  if (d === today) return `今天 ${toHHmm(ms)}`;
  const [, m, day] = d.split('-').map(Number);
  return `${m}/${day} ${toHHmm(ms)}`;
}

/** 每分鐘重畫一次「距離上次排便」；回傳畫面當下的時間（剛記的那筆才不會被當成未來） */
function useNow() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 60000);
    return () => window.clearInterval(t);
  }, []);
  return Date.now();
}

export function TodayView(props: {
  api: BowelApi;
  snap: BowelSnapshot;
  date: string;
  setDate: (d: string) => void;
  goTo: (t: Tab) => void;
  /** 展開詳細欄位的那一筆 */
  openId: string | null;
  setOpenId: (id: string | null) => void;
  /** 收起詳細欄位時呼叫（從首頁來的要回首頁） */
  onDone: () => void;
}) {
  const { api, snap, date, setDate, openId, setOpenId } = props;
  const now = useNow();
  const isToday = date === todayKey();
  const logs = snap.logs.filter((l) => l.date === date).sort((a, b) => b.time - a.time);
  const last = lastPassed(snap.logs, now);
  const constip = constipation(snap, now);
  const diar = diarrhea(snap.logs, date);
  const doctor = logs.map((l) => judgeBowel(l)).filter((j) => j?.seeDoctor);
  const calendarInfo = (calendarDate: string) => {
    const dayLogs = snap.logs.filter((log) => log.date === calendarDate);
    if (dayLogs.length === 0) return null;
    const judges = dayLogs.map(judgeBowel).filter((judge): judge is NonNullable<ReturnType<typeof judgeBowel>> => !!judge);
    const level = judges.some((judge) => judge.level === 'bad') ? 'bad' : judges.some((judge) => judge.level === 'warn') ? 'warn' : 'ok';
    const color = level === 'bad' ? 'var(--danger)' : level === 'warn' ? 'var(--warn)' : level === 'ok' ? 'var(--ok)' : 'var(--muted)';
    return { marks: [{ color, kind: 'dot' as const }], label: `${dayLogs.length} 筆排便紀錄` };
  };

  const add = () => startLog(api, date, setOpenId);

  return (
    <div className="today">
      <div className="messages">
        {snap.issues.length > 0 && (
          <button className="msg warn" onClick={() => props.goTo('issues')}>
            ⚠️ 試算表有 {snap.issues.length} 筆排便資料需要補齊 ›
          </button>
        )}
        {constip && <div className="msg warn">已經 {constip.days} 天沒有排便，記得多喝水、多吃蔬菜</div>}
        {diar && <div className="msg warn">{isToday ? '今天' : '這天'}排便 {diar.count} 次、偏稀，記得補充水分</div>}
        {doctor.length > 0 && (
          <div className="msg bad">
            ⚠️ {isToday ? '今天' : '這天'}有{[...new Set(doctor.flatMap((j) => j!.reasons.filter((r) => r === '帶血' || r === '黑色' || r === '灰白色' || r === '紅色')))].join('、')}的紀錄，建議就醫檢查
          </div>
        )}
      </div>

      <MonthCalendar selected={date} setDate={setDate} dayInfo={calendarInfo} maxDate={todayKey()} />

      <section className="card since">
        <div className="since-label">距離上次排便</div>
        <div className="since-value">{last ? elapsedText(now - last.time) : '—'}</div>
        <div className="muted small">{last ? `上次：${fmtWhen(last.time)}` : '還沒有紀錄'}</div>
        <div className="add-row">
          <button className="primary big" onClick={add}>
            <Icon name="plus" size={20} strokeWidth={2.2} /> 記一筆
          </button>
        </div>
        {!isToday && <p className="muted small">在這天補記，時間可以記完再改</p>}
      </section>

      <section className="card">
        <h2>{dateLabel(date)}排便紀錄</h2>
        {logs.length === 0 ? (
          <p className="muted center-text">這天沒有紀錄</p>
        ) : (
          <ul className="log-list">
            {logs.map((l) =>
              openId === l.id ? (
                <li key={l.id}>
                  <LogEditor
                    api={api}
                    log={l}
                    onClose={() => {
                      setOpenId(null);
                      props.onDone();
                    }}
                    onMoved={setDate}
                  />
                </li>
              ) : (
                <LogRow key={l.id} log={l} onOpen={() => setOpenId(l.id)} />
              ),
            )}
          </ul>
        )}
      </section>
      <p className="muted small center-text">顏色標示僅供記錄參考，不能取代醫療建議。</p>
    </div>
  );
}

function LogRow({ log, onOpen }: { log: BowelLog; onOpen: () => void }) {
  const judge = judgeBowel(log);
  const symptoms = log.symptoms.filter((s) => s !== '無特殊狀況');
  return (
    <li className="log-row" onClick={onOpen} title="點一下修改 / 補填">
      <span className="log-time">{toHHmm(log.time)}</span>
      <span className="log-main">
        <span className={log.passed ? '' : 'muted'}>{bowelSummary(log) || '排便（沒填細節，點一下補填）'}</span>
        {(symptoms.length > 0 || log.note) && (
          <span className="log-extra">
            {symptoms.join('、')}
            {log.note && ` 📝 ${log.note}`}
          </span>
        )}
      </span>
      {judge && <span className={`lv ${judge.level}`}>{judge.label}</span>}
    </li>
  );
}
