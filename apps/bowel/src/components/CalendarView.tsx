import type { BowelLog, BowelSnapshot, SingleField } from '@life/db';
import { bowelMonth, bowelSummary, diarrhea, judgeBowel, SINGLE_FIELDS, todayKey, toHHmm } from '@life/db';
import { MonthCalendar } from '@life/ui/month-calendar';
import { dateLabel } from '@life/ui/timeline';
import { Icon } from '@life/ui/icon';
import type { BowelApi } from '../useBowel';

const DETAIL_FIELDS: SingleField[] = ['amount', 'color', 'afterFeeling', 'ease', 'urgency', 'duration', 'smellLevel', 'smellType'];
const colorOf = (level: 'ok' | 'warn' | 'bad' | null) => level === 'bad' ? 'var(--danger)' : level === 'warn' ? 'var(--warn)' : level === 'ok' ? 'var(--ok)' : 'var(--muted)';

/** 排便日曆：月曆下方僅顯示所選日期的唯讀內容。 */
export function CalendarView({ api, snap, date, setDate, onAdd, onEdit, onIssues }: {
  api: BowelApi;
  snap: BowelSnapshot;
  date: string;
  setDate: (date: string) => void;
  onAdd: () => void;
  onEdit: (log: BowelLog) => void;
  onIssues: () => void;
}) {
  const logs = snap.logs.filter((log) => log.date === date).sort((a, b) => b.time - a.time);
  const diar = diarrhea(snap.logs, date);
  const dayInfo = (value: string) => {
    const day = bowelMonth(snap.logs, value.slice(0, 7)).find((entry) => entry.date === value);
    if (!day || (!day.count && !day.onlyNotPassed)) return null;
    if (day.onlyNotPassed) return { marks: [{ color: 'var(--muted)', kind: 'ring' as const }], label: '有便意但沒排出' };
    return {
      marks: [{ color: colorOf(day.level), kind: 'badge' as const, text: day.count > 1 ? String(day.count) : '' }],
      label: `排便 ${day.count} 次${day.level ? `，${day.level === 'bad' ? '異常' : day.level === 'warn' ? '注意' : '正常'}` : '，未填型態'}`,
    };
  };
  return (
    <div className="bowel-calendar">
      {snap.issues.length > 0 && <button className="msg warn" onClick={onIssues}>⚠️ 試算表有 {snap.issues.length} 筆排便資料需要補齊 ›</button>}
      {diar && <div className="msg warn">這天排便 {diar.count} 次、偏稀，記得補充水分。</div>}
      <MonthCalendar selected={date} setDate={setDate} dayInfo={dayInfo} maxDate={todayKey()} />
      <h2>{dateLabel(date)}排便紀錄</h2>
      {logs.length === 0 ? <section className="card"><p className="muted center-text">這天沒有紀錄</p></section> : logs.map((log) => <ReadonlyLog key={log.id} log={log} onEdit={() => onEdit(log)} />)}
      <button type="button" className="fab" onClick={onAdd} aria-label={`新增 ${date} 排便紀錄`}><Icon name="plus" size={28} /></button>
      {api.busy && <p className="muted small center-text">更新中⋯</p>}
      <p className="muted small center-text">顏色標示僅供紀錄參考，不能取代醫療建議。</p>
    </div>
  );
}

function ReadonlyLog({ log, onEdit }: { log: BowelLog; onEdit: () => void }) {
  const judge = judgeBowel(log);
  const details = DETAIL_FIELDS.map((field) => ({ label: SINGLE_FIELDS[field].label, value: log[field] })).filter((entry) => entry.value);
  return (
    <section className="card bowel-readonly">
      <div className="readonly-head"><h2>{toHHmm(log.time)}　{bowelSummary(log) || '有便意，但沒排出'}</h2>{judge && <span className={`lv ${judge.level}`}>{judge.label}</span>}</div>
      {details.length > 0 && <dl>{details.map((entry) => <div key={entry.label}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}</dl>}
      {log.symptoms.length > 0 && <p><b>症狀：</b>{log.symptoms.join('、')}</p>}
      {log.note && <p><b>備註：</b>{log.note}</p>}
      {judge && judge.level !== 'ok' && <div className={`attention-box ${judge.level}`}><b>為什麼需要注意</b><ul>{judge.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>{judge.seeDoctor && <p>這類狀況建議就醫檢查。</p>}</div>}
      <button type="button" onClick={onEdit}>編輯</button>
    </section>
  );
}
