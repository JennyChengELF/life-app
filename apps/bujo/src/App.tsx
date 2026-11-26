import { useEffect, useMemo, useState } from 'react';
import {
  bujoDayEntries, bujoMonthlyStats, bujoOccurrences, bujoTaskStatus, latestBujoSchedules,
  parseDateText, toDateKey, toHHmm, type BujoFields, type BujoOccurrence, type BujoSchedule,
} from '@life/db';
import { AppSwitcher } from '@life/ui/app-switcher';
import { AppTabs, type AppTabItem } from '@life/ui/app-tabs';
import { Icon } from '@life/ui/icon';
import { MonthCalendar } from '@life/ui/month-calendar';
import { tagLabel } from '@life/ui/tag-picker';
import { TaskEditor, weekdays } from './TaskEditor';
import { useBujo, type BujoApi } from './useBujo';

type Tab = 'add' | 'calendar' | 'stats' | 'more';
type Editor = { kind: 'details' | 'task' | 'schedule'; id: string };
const tabs: AppTabItem<Tab>[] = [
  { key: 'add', label: '新增', icon: 'plus' },
  { key: 'calendar', label: '日曆', icon: 'calendar' },
  { key: 'stats', label: '統計表', icon: 'chart' },
  { key: 'more', label: '更多', icon: 'more' },
];
const home = import.meta.env.DEV ? `http://${location.hostname}:5172/` : '../';
const statuses = { open: '待完成', upcoming: '尚未開始', completed: '已完成', missed: '未完成' };

function useClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: number;
    const update = () => {
      window.clearTimeout(timer);
      const current = Date.now();
      setNow(current);
      timer = window.setTimeout(update, 60000 - current % 60000);
    };
    update();
    window.addEventListener('focus', update);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', update);
    };
  }, []);
  return now;
}

function Tags({ fields, api }: { fields: BujoFields; api: BujoApi }) {
  if (!fields.tagIds.length) return null;
  return <ul className="shared-tag-chips">{fields.tagIds.map((id) => <li key={id}>{tagLabel(api.snap?.tags ?? [], id)}</li>)}</ul>;
}

function dates(entry: BujoOccurrence) {
  if (entry.scheduleId) return `${entry.startDate} ${toHHmm(entry.availableAt)} · 每週重複`;
  return entry.startDate === entry.dueDate ? entry.startDate : `${entry.startDate} ～ ${entry.dueDate}`;
}

function DayList({ entries, day, now, api, onDetails, onAdd }: {
  entries: BujoOccurrence[];
  day: string;
  now: number;
  api: BujoApi;
  onDetails: (id: string) => void;
  onAdd: () => void;
}) {
  const data = bujoDayEntries(entries, day, now);
  const today = toDateKey(now);
  const sections = [
    { title: day > today ? '預定待辦' : '待完成', rows: data.open, quick: day === today },
    { title: '已完成', rows: data.completed, quick: false },
    { title: '未完成', rows: data.missed, quick: false },
  ].filter(({ rows }) => rows.length);
  return <section className="card">
    <div className="bujo-row"><h2>{day} 的待辦</h2><button className="primary" type="button" disabled={api.busy} onClick={onAdd}>新增待辦</button></div>
    {!sections.length && <p className="muted">這天沒有待辦紀錄。</p>}
    {sections.map(({ title, rows, quick }) => <section key={title} className="bujo-section">
      <h3>{title}</h3>
      <ul className="bujo-list">{rows.map((entry) => <li key={entry.id}>
        <div className="bujo-item">
          <button className="bujo-item-title" type="button" disabled={api.busy} onClick={() => onDetails(entry.id)}>
            <strong>{entry.title}</strong><small>{dates(entry)}</small>
          </button>
          <Tags fields={entry} api={api} />
        </div>
        {quick && <button className="link bujo-complete" type="button" disabled={api.busy}
          aria-label={`完成「${entry.title}」`} onClick={() => {
            if (api.snap) void api.save(() => api.store.setCompletion(entry, toDateKey(Date.now()), api.snap!), '已完成');
          }}>完成</button>}
      </li>)}</ul>
    </section>)}
  </section>;
}

function EntryDetails({ entry, now, api, close, onEdit, onOutcome }: {
  entry: BujoOccurrence;
  now: number;
  api: BujoApi;
  close: () => void;
  onEdit: () => void;
  onOutcome: (date: string) => void;
}) {
  const today = toDateKey(now);
  const [day, setDay] = useState(entry.completedDate ?? today);
  const status = bujoTaskStatus(entry, now);
  const task = api.snap?.tasks.find(({ id }) => id === entry.id);
  const complete = async (value: string | null) => {
    if (!api.snap) return;
    const saved = await api.save(() => api.store.setCompletion(entry, value, api.snap!),
      value ? '已記錄完成日' : '已取消完成');
    if (saved) onOutcome(value ?? entry.historyDate);
  };

  return <section className="card">
    <div className="bujo-row"><h2>{entry.title}</h2><button className="link" type="button" disabled={api.busy} onClick={close}>返回</button></div>
    <p className="muted">{dates(entry)} · {statuses[status]}</p>
    {entry.note && <p className="bujo-note">{entry.note}</p>}
    <Tags fields={entry} api={api} />
    {entry.availableAt <= now && <form className="bujo-entry-form" onSubmit={(e) => { e.preventDefault(); void complete(day); }}>
      <label className="field">實際完成日<input type="date" value={day} required min={entry.startDate} max={today}
        disabled={api.busy} onChange={(e) => setDay(e.target.value)} /></label>
      <button className="primary" type="submit" disabled={api.busy}>{entry.completedDate ? '更新完成日' : status === 'missed' ? '補登完成' : '勾選完成'}</button>
      {entry.completedDate && <button className="link" type="button" disabled={api.busy} onClick={() => void complete(null)}>取消完成</button>}
    </form>}
    {task && <div className="bujo-actions">
      <button className="link" type="button" disabled={api.busy} onClick={onEdit}>修改待辦</button>
      <button className="link danger" type="button" disabled={api.busy} onClick={async () => {
        if (confirm(`要刪除「${entry.title}」嗎？`) && await api.save(() => api.store.deleteTask(task), '已刪除')) close();
      }}>刪除待辦</button>
    </div>}
  </section>;
}

function More({ api, schedules, onEdit }: { api: BujoApi; schedules: BujoSchedule[]; onEdit: (id: string) => void }) {
  return <>
    <section className="card">
      <h2>重複待辦</h2>
      {!schedules.length && <p className="muted">還沒有設定重複待辦。</p>}
      <ul className="bujo-list">{schedules.map((schedule) => <li key={schedule.seriesId}>
        <div className="bujo-item"><strong>{schedule.title}</strong>
          <small>每週{weekdays[schedule.weekday].slice(2)} {schedule.time}{schedule.stopped && ' · 已停用'}</small>
          <Tags fields={schedule} api={api} />
        </div>
        {!schedule.stopped && <div className="bujo-actions">
          <button className="link" type="button" disabled={api.busy} onClick={() => onEdit(schedule.id)}>修改</button>
          <button className="link" type="button" disabled={api.busy} onClick={() => {
            if (confirm(`要停用「${schedule.title}」的後續排程嗎？`)) {
              void api.save(() => api.store.saveSchedule(schedule, schedule.seriesId, true), '已停用後續排程');
            }
          }}>停用</button>
        </div>}
      </li>)}</ul>
    </section>
    {(api.fileUrl || !!api.snap?.issues.length) && <section className="card">
      <h2>資料與試算表</h2>
      {api.fileUrl && <a href={api.fileUrl} target="_blank" rel="noreferrer">開啟「生活APP-子彈筆記」試算表</a>}
      {!!api.snap?.issues.length && <ul>{api.snap.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
    </section>}
  </>;
}

export function App() {
  const api = useBujo();
  const now = useClock();
  const today = toDateKey(now);
  const [tab, setTab] = useState<Tab>('calendar');
  const [date, setDate] = useState(() => parseDateText(new URLSearchParams(location.search).get('date') ?? '') ?? today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [editor, setEditor] = useState<Editor | null>(null);
  const [dirty, setDirty] = useState(false);
  const { snap } = api;
  const entries = useMemo(() => snap ? bujoOccurrences(snap, date > today ? date : today) : [], [snap, date, today]);
  const current = entries.find(({ id }) => id === editor?.id);
  const schedules = latestBujoSchedules(snap?.schedules ?? []);
  const dailyMarks = useMemo(() => {
    const marks = new Map<string, '已完成' | '未完成'>();
    for (const entry of entries) {
      if (entry.completedDate) marks.set(entry.completedDate, '已完成');
      else if (bujoTaskStatus(entry, now) === 'missed' && !marks.has(entry.historyDate)) marks.set(entry.historyDate, '未完成');
    }
    return marks;
  }, [entries, now]);
  const counts = tab === 'stats' && snap ? bujoMonthlyStats(entries, snap.schedules, month, now) : [];
  const close = () => { setEditor(null); setDirty(false); };
  const changeTab = (next: Tab) => {
    if (next === tab || api.busy || (dirty && !confirm('目前有尚未儲存的內容，確定要離開嗎？'))) return;
    close();
    setTab(next);
    window.scrollTo(0, 0);
  };

  return <div className="app bujo-app">
    <header className="topbar">
      <AppSwitcher current="bujo" homeUrl={home} date={date} confirmLeave={dirty} />
      <h1>子彈筆記</h1>
      <AppTabs items={tabs} current={tab} placement="top" onChange={changeTab} />
      {api.status === 'ready' && <button className="icon-btn" type="button" aria-label="重新整理" disabled={api.busy}
        onClick={() => void api.refresh()}><Icon name="refresh" /></button>}
    </header>
    {api.local && <div className="mode-banner">本機測試模式 · 資料存在這個瀏覽器</div>}
    {api.error && <p className="bujo-error" role="alert">{api.error}</p>}
    {api.notice && <p className="bujo-notice" role="status">{api.notice}</p>}
    <main aria-busy={api.busy}>
      {api.status === 'loading' && <p className="muted center">讀取中⋯</p>}
      {api.status === 'connect' && <section className="card center">
        <p>連線後會把資料存到你的「生活APP-子彈筆記」試算表。</p>
        <button className="primary" type="button" disabled={api.busy} onClick={() => void api.connect()}>連線 Google</button>
      </section>}
      {api.status === 'error' && <button className="primary" type="button" disabled={api.busy}
        onClick={() => void api.refresh()}>重新讀取</button>}
      {api.status === 'ready' && snap && <>
        {tab === 'add' && <TaskEditor api={api} date={date} onDirty={() => setDirty(true)}
          onClose={() => changeTab('calendar')} onSaved={(day) => {
            if (day) setDate(day);
            close();
            setTab('calendar');
          }} />}
        {tab === 'calendar' && (current && editor
          ? editor.kind === 'task'
            ? <TaskEditor api={api} date={date} task={snap.tasks.find(({ id }) => id === current.id)}
              onDirty={() => setDirty(true)} onClose={() => {
                if (!dirty || confirm('確定要放棄修改嗎？')) close();
              }} onSaved={(day) => { if (day) setDate(current.completedDate ?? day); close(); }} />
            : <EntryDetails key={current.id} entry={current} now={now} api={api} close={close}
              onEdit={() => setEditor({ kind: 'task', id: current.id })} onOutcome={(day) => { setDate(day); close(); }} />
          : <>
            <MonthCalendar selected={date} setDate={setDate} dayInfo={(day) => {
              const mark = dailyMarks.get(day);
              return mark ? { label: mark, marks: [{ color: mark === '已完成' ? 'var(--ok)' : 'var(--warn)' }] } : null;
            }} />
            <label className="field bujo-jump">跳到日期<input type="date" value={date}
              onChange={(e) => { if (e.target.value) setDate(e.target.value); }} /></label>
            <DayList entries={entries} day={date} now={now} api={api} onAdd={() => changeTab('add')}
              onDetails={(id) => { setEditor({ kind: 'details', id }); window.scrollTo(0, 0); }} />
          </>)}
        {tab === 'stats' && <section className="card">
          <div className="bujo-row"><h2>重複待辦統計</h2>
            <label className="field">月份<input type="month" value={month} max={today.slice(0, 7)}
              onChange={(e) => { if (e.target.value) setMonth(e.target.value); }} /></label>
          </div>
          {counts.length ? <table className="bujo-stats">
            <thead><tr><th scope="col">待辦</th><th scope="col">完成次數</th><th scope="col">漏做次數</th></tr></thead>
            <tbody>{counts.map((row) => <tr key={row.seriesId}><th scope="row">{row.title}</th><td>{row.completed}</td><td>{row.missed}</td></tr>)}</tbody>
          </table> : <p className="muted">這個月沒有已出現的重複待辦。</p>}
        </section>}
        {tab === 'more' && (editor?.kind === 'schedule'
          ? <TaskEditor api={api} date={date} schedule={schedules.find(({ id }) => id === editor.id)}
            onDirty={() => setDirty(true)} onClose={() => {
              if (!dirty || confirm('確定要放棄修改嗎？')) close();
            }} onSaved={close} />
          : <More api={api} schedules={schedules} onEdit={(id) => {
            setEditor({ kind: 'schedule', id }); window.scrollTo(0, 0);
          }} />)}
      </>}
    </main>
    <AppTabs items={tabs} current={tab} placement="bottom" onChange={changeTab} />
  </div>;
}
