import { useState, type CSSProperties } from 'react';
import { Icon, type IconName } from '@life/ui/icon';
import {
  addDateDays,
  dateDiffDays,
  dateInRange,
  eventOnDate,
  sortCalendarEvents,
  todayKey,
  type CalendarEvent,
  type CalendarEventInput,
  type CalendarGroup,
  type CalendarSnapshot,
  type TripChildAction,
} from '@life/db';
import { useCalendar, type CalendarApi } from './useCalendar';
import { AppSwitcher } from '@life/ui/app-switcher';

const HOME_URL = import.meta.env.DEV ? `http://${location.hostname}:5172/` : '../';
type Tab = 'month' | 'agenda' | 'groups';
type AgendaMode = 'upcoming' | 'history' | 'month';
const TABS: { key: Tab; icon: IconName; label: string }[] = [
  { key: 'month', icon: 'calendar', label: '月曆' },
  { key: 'agenda', icon: 'clipboard', label: '行程表' },
  { key: 'groups', icon: 'settings', label: '群組' },
];
type Open =
  | { kind: 'detail'; id: string }
  | { kind: 'form'; eventId: string | null; date: string; parentId: string | null }
  | { kind: 'trip-change'; event: CalendarEvent; input: CalendarEventInput; step: 'scope' | 'children'; choices: Record<string, ChildChoice> };
type ChildChoice = { action: 'move' | 'detach' | 'cancel'; startDate: string; endDate: string };

const pad = (n: number) => String(n).padStart(2, '0');
const monthTitle = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${y} 年 ${m} 月`;
};
const dateLabel = (date: string, withYear = false) => {
  const [y, m, d] = date.split('-').map(Number);
  const w = ['日', '一', '二', '三', '四', '五', '六'][new Date(y, m - 1, d).getDay()];
  return `${withYear ? `${y} 年 ` : ''}${m} 月 ${d} 日（${w}）`;
};
const slashDateLabel = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const w = ['日', '一', '二', '三', '四', '五', '六'][new Date(y, m - 1, d).getDay()];
  return `${y}/${pad(m)}/${pad(d)}（${w}）`;
};
const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const monthDays = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = addDateDays(`${y}-${pad(m)}-01`, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => addDateDays(start, i));
};
const groupOf = (snap: CalendarSnapshot, e: CalendarEvent) => snap.groups.find((g) => g.id === e.groupId);
const timeText = (e: CalendarEvent) => e.timeType === 'allDay' ? '全天' : e.timeType === 'point' ? e.startTime! : `${e.startTime}～${e.endTime}`;
const rangeText = (e: CalendarEvent) => e.startDate === e.endDate ? dateLabel(e.startDate, true) : `${slashDateLabel(e.startDate)}～${slashDateLabel(e.endDate)}`;
const eventInput = (e: CalendarEvent): CalendarEventInput => ({
  title: e.title,
  groupId: e.groupId,
  parentEventId: e.parentEventId,
  timeType: e.timeType,
  startDate: e.startDate,
  startTime: e.startTime,
  startTimeZone: e.startTimeZone,
  endDate: e.endDate,
  endTime: e.endTime,
  endTimeZone: e.endTimeZone,
  timeMode: e.timeMode,
  locationType: e.locationType,
  startPlace: e.startPlace,
  endPlace: e.endPlace,
  url: e.url,
  note: e.note,
  status: e.status,
});

function requestedDate() {
  const value = new URLSearchParams(location.search).get('date');
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayKey();
}

export function App() {
  const api = useCalendar();
  const initialDate = requestedDate();
  const [tab, setTab] = useState<Tab>(() => location.hash === '#agenda' ? 'agenda' : location.hash === '#groups' ? 'groups' : 'month');
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [month, setMonth] = useState(() => initialDate.slice(0, 7));
  const [open, setOpen] = useState<Open | null>(() => {
    if (location.hash === '#new') return { kind: 'form', eventId: null, date: initialDate, parentId: null };
    if (location.hash.startsWith('#event/')) return { kind: 'detail', id: decodeURIComponent(location.hash.slice(7)) };
    return null;
  });

  const goTab = (next: Tab) => {
    setTab(next);
    setOpen(null);
    window.scrollTo(0, 0);
  };

  const setDate = (date: string) => {
    setSelectedDate(date);
    setMonth(date.slice(0, 7));
  };

  if (api.status === 'starting' || (api.status === 'loading' && !api.snap)) return <Shell api={api}><div className="center muted">讀取中⋯⋯</div></Shell>;
  if (api.status === 'need-connect') return <Shell api={api}><div className="center connect"><p>行程存在你的 Google 試算表，需要先連線。</p><button className="primary big" onClick={api.connect}>連線 Google</button>{api.error && <p className="error-text">{api.error}</p>}<p className="muted small">APP 只能存取它自己建立的試算表。</p></div></Shell>;
  if (api.status === 'error' || !api.snap) return <Shell api={api}><div className="center"><p className="error-text">{api.error}</p><button className="primary" onClick={() => location.reload()}>重新載入</button></div></Shell>;
  const snap = api.snap;
  const activeGroups = new Set(snap.groups.filter((g) => !g.hidden).map((g) => g.id));
  const visibleEvents = snap.events.filter((e) => activeGroups.has(e.groupId));
  const openedId = open?.kind === 'detail' ? open.id : open?.kind === 'form' ? open.eventId : null;
  const openedEvent = openedId ? snap.events.find((e) => e.id === openedId) ?? null : null;

  const saveEvent = async (input: CalendarEventInput, current: CalendarEvent | null) => {
    if (input.timeType === 'point') input = { ...input, endDate: input.startDate, endTime: null };
    const parent = input.parentEventId ? snap.events.find((e) => e.id === input.parentEventId) : null;
    if (parent && (input.startDate < parent.startDate || input.endDate > parent.endDate)) {
      api.showToast({ kind: 'error', text: `細項日期必須在主行程的 ${parent.startDate}～${parent.endDate} 之內` });
      return false;
    }
    if (current) {
      const children = snap.events.filter((e) => e.parentEventId === current.id);
      if (children.length && (current.startDate !== input.startDate || current.endDate !== input.endDate)) {
        const delta = dateDiffDays(current.startDate, input.startDate);
        const choices = Object.fromEntries(children.map((e) => [e.id, { action: 'move', startDate: addDateDays(e.startDate, delta), endDate: addDateDays(e.endDate, delta) } satisfies ChildChoice]));
        setOpen({ kind: 'trip-change', event: current, input, step: 'scope', choices });
        return false;
      }
      const ok = await api.run((s) => s.updateEvent(current, input).then(() => current.id));
      if (ok) setOpen({ kind: 'detail', id: current.id });
      return !!ok;
    }
    const id = await api.run((s) => s.addEvent(input));
    if (id) setOpen({ kind: 'detail', id });
    return !!id;
  };

  return (
    <Shell api={api} tab={tab} goTab={goTab} date={selectedDate} confirmLeave={open?.kind === 'form' || open?.kind === 'trip-change'}>
      {open?.kind === 'form' ? (
        <EventForm snap={snap} event={openedEvent} initialDate={open.date} parentId={open.parentId} busy={api.busy} onCancel={() => setOpen(open.eventId ? { kind: 'detail', id: open.eventId } : null)} onSave={saveEvent} />
      ) : open?.kind === 'detail' && openedEvent ? (
        <EventDetail api={api} snap={snap} event={openedEvent} onBack={() => setOpen(null)} onEdit={() => setOpen({ kind: 'form', eventId: openedEvent.id, date: openedEvent.startDate, parentId: openedEvent.parentEventId })} onOpen={(id) => setOpen({ kind: 'detail', id })} onAddChild={() => setOpen({ kind: 'form', eventId: null, date: openedEvent.startDate, parentId: openedEvent.id })} />
      ) : open?.kind === 'trip-change' ? (
        <TripChangeView api={api} data={open} onChange={setOpen} onDone={() => setOpen({ kind: 'detail', id: open.event.id })} />
      ) : (
        <>
          {tab === 'month' && <MonthView snap={snap} events={visibleEvents} month={month} selected={selectedDate} setMonth={setMonth} setDate={setDate} openEvent={(id) => setOpen({ kind: 'detail', id })} />}
          {tab === 'agenda' && <AgendaView snap={snap} events={visibleEvents} selectedMonth={month} openEvent={(id) => setOpen({ kind: 'detail', id })} />}
          {tab === 'groups' && <GroupsView api={api} snap={snap} />}
          {tab !== 'groups' && <button className="fab" onClick={() => setOpen({ kind: 'form', eventId: null, date: selectedDate, parentId: null })} aria-label="新增行程"><Icon name="plus" size={28} /></button>}
        </>
      )}
      {api.toast && <button className={`toast ${api.toast.kind}`} onClick={api.dismissToast}>{api.toast.text}</button>}
    </Shell>
  );
}

function Shell({ api, tab, goTab, date, confirmLeave = false, children }: { api: CalendarApi; tab?: Tab; goTab?: (t: Tab) => void; date?: string; confirmLeave?: boolean; children: React.ReactNode }) {
  return (
    <div className="app calendar-app">
      <header className="topbar">
        <AppSwitcher current="calendar" homeUrl={HOME_URL} date={date} confirmLeave={confirmLeave} />
        <h1>行事曆</h1>
        {tab && goTab && <nav className="tabs-top">{TABS.map((t) => <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => goTab(t.key)}><Icon name={t.icon} size={20} /> {t.label}</button>)}</nav>}
        {api.status === 'ready' && <button className="icon-btn" onClick={api.refresh} disabled={api.busy} title="重新整理" aria-label="重新整理"><span className={api.busy ? 'spin' : ''}><Icon name="refresh" /></span></button>}
      </header>
      {api.mode === 'local' && <div className="mode-banner">本機測試模式：資料只存在這個瀏覽器，還沒接上 Google 試算表</div>}
      <main>{children}</main>
      {api.toast && <button className={`toast ${api.toast.kind === 'error' ? 'error' : ''}`} onClick={api.dismissToast}>{api.toast.text}</button>}
      {tab && goTab && <nav className="tabs-bottom">{TABS.map((t) => <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => goTab(t.key)}><span className="tab-icon"><Icon name={t.icon} /></span>{t.label}</button>)}</nav>}
    </div>
  );
}

function MonthView({ snap, events, month, selected, setMonth, setDate, openEvent }: { snap: CalendarSnapshot; events: CalendarEvent[]; month: string; selected: string; setMonth: (m: string) => void; setDate: (d: string) => void; openEvent: (id: string) => void }) {
  const days = monthDays(month);
  const selectedEvents = sortCalendarEvents(events.filter((e) => eventOnDate(e, selected)));
  const goMonth = (delta: number) => {
    const next = shiftMonth(month, delta);
    setMonth(next);
    setDate(`${next}-01`);
  };
  const today = todayKey();
  const unnamed = events.filter((e) => e.titleMissing).length;
  return (
    <>
      {unnamed > 0 && <div className="msg warn">有 {unnamed} 筆未命名行程，之後可以點開補上標題。</div>}
      <section className="card month-card">
        <div className="month-nav"><button className="icon-btn" onClick={() => goMonth(-1)} aria-label="上個月"><Icon name="left" /></button><button className="month-title" onClick={() => setDate(today)}>{monthTitle(month)}<small>回到今天</small></button><button className="icon-btn" onClick={() => goMonth(1)} aria-label="下個月"><Icon name="right" /></button></div>
        <div className="month-grid">{['日', '一', '二', '三', '四', '五', '六'].map((w) => <div className="weekday" key={w}>{w}</div>)}{days.map((date) => {
          const dayEvents = events.filter((e) => eventOnDate(e, date));
          const inMonth = date.startsWith(month);
          return <button key={date} className={`month-day ${selected === date ? 'selected' : ''} ${today === date ? 'today' : ''} ${inMonth ? '' : 'outside'}`} onClick={() => setDate(date)}><span>{Number(date.slice(8))}</span><span className="day-marks">{dayEvents.slice(0, 2).map((e) => { const g = groupOf(snap, e); return <i key={e.id} style={{ '--event-color': g?.color ?? '#1f6fd1' } as CSSProperties} title={e.title}>{e.startDate !== e.endDate ? '━' : '•'}</i>; })}{dayEvents.length > 2 && <em>+{dayEvents.length - 2}</em>}</span></button>;
        })}</div>
      </section>
      <section className="card day-list"><h2>{dateLabel(selected)}</h2>{selectedEvents.length ? selectedEvents.map((e) => <EventRow key={e.id} snap={snap} event={e} onClick={() => openEvent(e.id)} />) : <p className="muted empty">這天沒有行程</p>}</section>
    </>
  );
}

function EventRow({ snap, event, onClick, nested = false }: { snap: CalendarSnapshot; event: CalendarEvent; onClick: () => void; nested?: boolean }) {
  const group = groupOf(snap, event);
  return <button className={`event-row ${event.status === 'cancelled' ? 'cancelled' : ''} ${nested ? 'nested' : ''}`} onClick={onClick}><span className="event-color" style={{ background: group?.color ?? '#1f6fd1' }} /><span className="event-time">{timeText(event)}</span><span className="event-main"><b>{event.title}</b>{event.startPlace && <small>{event.startPlace}{event.endPlace ? ` → ${event.endPlace}` : ''}</small>}</span><Icon name="right" size={17} /></button>;
}

function AgendaView({ snap, events, selectedMonth, openEvent }: { snap: CalendarSnapshot; events: CalendarEvent[]; selectedMonth: string; openEvent: (id: string) => void }) {
  // （2026-11-20 使用者決定：大量舊行程以近期、年代／年份、指定年月分開瀏覽。）
  const [mode, setMode] = useState<AgendaMode>('upcoming');
  const [showCancelled, setShowCancelled] = useState(false);
  const [month, setMonth] = useState(selectedMonth);
  // （2026-11-20 使用者決定：有細項的主行程在行程表預設收合，避免資料太長。）
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(events.flatMap((event) => event.parentEventId ? [event.parentEventId] : [])));
  const usableEvents = events.filter((e) => showCancelled || e.status !== 'cancelled');
  const ids = new Set(usableEvents.map((e) => e.id));
  const roots = sortCalendarEvents(usableEvents.filter((e) => !e.parentEventId || !ids.has(e.parentEventId)));
  const historical = roots.filter((e) => e.endDate < todayKey());
  const decades = [...new Set(historical.map((e) => Math.floor(Number(e.startDate.slice(0, 4)) / 10) * 10))].sort((a, b) => b - a);
  const [decade, setDecade] = useState(() => decades[0] ?? Math.floor(new Date().getFullYear() / 10) * 10);
  const years = [...new Set(historical.filter((e) => Number(e.startDate.slice(0, 4)) >= decade && Number(e.startDate.slice(0, 4)) <= decade + 9).map((e) => Number(e.startDate.slice(0, 4))))].sort((a, b) => b - a);
  const [year, setYear] = useState(() => years[0] ?? new Date().getFullYear());
  const toggle = (id: string) => setCollapsed((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const overlaps = (event: CalendarEvent, start: string, end: string) => event.startDate <= end && event.endDate >= start;
  let shown = roots.filter((e) => overlaps(e, todayKey(), addDateDays(todayKey(), 92)));
  if (mode === 'history') shown = roots.filter((e) => overlaps(e, `${year}-01-01`, `${year}-12-31`) && e.endDate < todayKey());
  if (mode === 'month') {
    const start = `${month}-01`;
    const end = addDateDays(`${shiftMonth(month, 1)}-01`, -1);
    shown = roots.filter((e) => overlaps(e, start, end));
  }
  const monthGroups = shown.reduce((map, event) => {
    const key = event.startDate.slice(0, 7);
    const list = map.get(key) ?? [];
    list.push(event);
    map.set(key, list);
    return map;
  }, new Map<string, CalendarEvent[]>());
  const chooseDecade = (value: number) => {
    setDecade(value);
    const first = [...new Set(historical.filter((e) => Number(e.startDate.slice(0, 4)) >= value && Number(e.startDate.slice(0, 4)) <= value + 9).map((e) => Number(e.startDate.slice(0, 4))))].sort((a, b) => b - a)[0];
    if (first) setYear(first);
  };
  return <section className="agenda">
    <div className="view-head"><div><h2>行程表</h2><p className="muted small">只顯示行程，不包含待辦</p></div></div>
    <div className="agenda-controls card">
      <div className="agenda-modes">{([['upcoming', '近期'], ['history', '歷史'], ['month', '指定年月']] as const).map(([value, label]) => <button key={value} className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>{label}</button>)}</div>
      {mode === 'upcoming' && <p className="muted small">顯示今天起三個月內的行程</p>}
      {mode === 'month' && <label className="month-picker">查看月份<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>}
      {mode === 'history' && <div className="history-picker"><div className="history-options">{decades.map((d) => <button key={d} className={decade === d ? 'active' : ''} onClick={() => chooseDecade(d)}>{d}～{d + 9}</button>)}</div><div className="history-options">{years.map((y) => <button key={y} className={year === y ? 'active' : ''} onClick={() => setYear(y)}>{y} 年</button>)}</div></div>}
      <label className="show-cancelled"><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />顯示已取消行程</label>
    </div>
    {monthGroups.size ? [...monthGroups.entries()].map(([monthKey, list]) => <div className="agenda-month-group" key={monthKey}><h3 className="agenda-month-title">{monthTitle(monthKey)}</h3>{list.map((event) => <AgendaItem key={event.id} snap={snap} events={usableEvents} event={event} collapsed={collapsed.has(event.id)} toggle={() => toggle(event.id)} openEvent={openEvent} />)}</div>) : <div className="card center muted">這個範圍沒有行程</div>}
  </section>;
}

function AgendaItem({ snap, events, event, collapsed, toggle, openEvent }: { snap: CalendarSnapshot; events: CalendarEvent[]; event: CalendarEvent; collapsed: boolean; toggle: () => void; openEvent: (id: string) => void }) {
  const children = sortCalendarEvents(events.filter((child) => child.parentEventId === event.id));
  if (!children.length) return <section className="card agenda-item"><div className="agenda-date">{rangeText(event)}</div><EventRow snap={snap} event={event} onClick={() => openEvent(event.id)} /></section>;
  const groups = children.reduce((map, child) => {
    const list = map.get(child.startDate) ?? [];
    list.push(child);
    map.set(child.startDate, list);
    return map;
  }, new Map<string, CalendarEvent[]>());
  return <section className="card trip-card"><button className="trip-head" onClick={toggle} aria-expanded={!collapsed}><span className="event-color" style={{ background: groupOf(snap, event)?.color ?? '#1f6fd1' }} /><span><b>{event.title}</b><small>{rangeText(event)}・{dateDiffDays(event.startDate, event.endDate) + 1} 天</small></span><Icon name={collapsed ? 'right' : 'left'} className={collapsed ? '' : 'chevron-down'} size={18} /></button>{!collapsed && <div className="trip-days">{[...groups.entries()].map(([date, list]) => <div className="trip-day" key={date}><h3>第 {dateDiffDays(event.startDate, date) + 1} 天・{dateLabel(date)}</h3>{list.map((child) => <EventRow key={child.id} snap={snap} event={child} nested onClick={() => openEvent(child.id)} />)}</div>)}</div>}<button className="trip-open" onClick={() => openEvent(event.id)}>查看主行程</button></section>;
}

function EventForm({ snap, event, initialDate, parentId, busy, onCancel, onSave }: { snap: CalendarSnapshot; event: CalendarEvent | null; initialDate: string; parentId: string | null; busy: boolean; onCancel: () => void; onSave: (input: CalendarEventInput, event: CalendarEvent | null) => Promise<boolean> }) {
  const initialParent = parentId ? snap.events.find((e) => e.id === parentId) : null;
  const [form, setForm] = useState<CalendarEventInput>(() => event ? eventInput(event) : {
    title: '', groupId: initialParent?.groupId ?? snap.defaultGroupId, parentEventId: parentId, timeType: 'point', startDate: initialDate, startTime: '09:00', startTimeZone: 'Asia/Taipei', endDate: initialDate, endTime: null, endTimeZone: 'Asia/Taipei', timeMode: 'fixedZone', locationType: null, startPlace: null, endPlace: null, url: null, note: null, status: 'scheduled',
  });
  const [more, setMore] = useState(!!event || !!form.startPlace || !!form.url || !!form.note);
  const [parentError, setParentError] = useState<string | null>(null);
  // （2026-11-20 使用者決定：主行程內新增時固定；月曆新增時可選，儲存前必須完整落在主行程日期內。）
  const parentLocked = !!event || !!parentId;
  const selectedParent = form.parentEventId ? snap.events.find((e) => e.id === form.parentEventId) ?? null : null;
  const effectiveEndDate = form.timeType === 'point' ? form.startDate : form.endDate;
  const parents = snap.events.filter((candidate) => {
    if (candidate.parentEventId || candidate.id === event?.id || candidate.endDate <= candidate.startDate || candidate.status !== 'scheduled') return false;
    if (candidate.id === form.parentEventId) return true;
    return dateInRange(form.startDate, candidate.startDate, candidate.endDate) || dateInRange(effectiveEndDate, candidate.startDate, candidate.endDate);
  });
  const set = <K extends keyof CalendarEventInput>(key: K, value: CalendarEventInput[K]) => setForm((current) => ({ ...current, [key]: value }));
  const setStartDate = (value: string) => setForm((current) => ({ ...current, startDate: value, endDate: current.timeType === 'point' ? value : current.endDate }));
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const input = form.timeType === 'point' ? { ...form, endDate: form.startDate, endTime: null } : form;
    const parent = input.parentEventId ? snap.events.find((item) => item.id === input.parentEventId) : null;
    if (parent && (input.startDate < parent.startDate || input.endDate > parent.endDate)) {
      setParentError(`細項日期必須在主行程的 ${parent.startDate}～${parent.endDate} 之內`);
      return;
    }
    setParentError(null);
    await onSave(input, event);
  };
  return <form className="card event-form" onSubmit={submit}>
    <div className="form-head"><button type="button" className="icon-btn" onClick={onCancel} aria-label="返回"><Icon name="left" /></button><h2>{event ? '編輯行程' : initialParent ? `新增「${initialParent.title}」細項` : '新增行程'}</h2></div>
    {parentLocked && selectedParent && <label className="field">所屬主行程<span className="parent-fixed">{selectedParent.title}<small>{rangeText(selectedParent)}</small></span></label>}
    {!parentLocked && <label className="field">所屬主行程<select value={form.parentEventId ?? ''} onChange={(e) => { set('parentEventId', e.target.value || null); setParentError(null); }}><option value="">不屬於主行程</option>{parents.map((parent) => <option key={parent.id} value={parent.id}>{parent.title}（{parent.startDate}～{parent.endDate}）</option>)}</select><small className="field-help">只列出包含開始或結束日期的主行程</small></label>}
    {parentError && <p className="form-error">{parentError}</p>}
    <label className="field">標題<input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="可以先留空，會顯示未命名行程" /></label>
    <div className="type-choice">{([['range', '時段'], ['point', '時間點'], ['allDay', '全天']] as const).map(([value, label]) => <button type="button" key={value} className={form.timeType === value ? 'active' : ''} onClick={() => setForm((current) => ({ ...current, timeType: value, startTime: value === 'allDay' ? null : current.startTime ?? '09:00', endDate: value === 'point' ? current.startDate : current.endDate, endTime: value === 'range' ? current.endTime ?? '10:00' : null }))}>{label}</button>)}</div>
    <div className="form-grid"><label className="field">開始日期<input type="date" value={form.startDate} onChange={(e) => setStartDate(e.target.value)} required /></label>{form.timeType !== 'allDay' && <label className="field">開始時間<input type="time" value={form.startTime ?? ''} onChange={(e) => set('startTime', e.target.value)} required /></label>}{form.timeType !== 'point' && <label className="field">結束日期<input type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} required /></label>}{form.timeType === 'range' && <label className="field">結束時間<input type="time" value={form.endTime ?? ''} onChange={(e) => set('endTime', e.target.value)} required /></label>}</div>
    <label className="field">行事曆群組<select value={form.groupId} onChange={(e) => set('groupId', e.target.value)}>{snap.groups.filter((group) => !group.archived).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
    <button type="button" className="more-toggle" onClick={() => setMore(!more)}>{more ? '收起更多設定' : '更多設定'}</button>
    {more && <div className="more-fields"><label className="field">地點類型<select value={form.locationType ?? ''} onChange={(e) => set('locationType', (e.target.value || null) as CalendarEventInput['locationType'])}><option value="">不填</option><option value="place">一般地點</option><option value="route">起點與終點</option><option value="online">線上</option></select></label>{form.locationType && form.locationType !== 'online' && <label className="field">{form.locationType === 'route' ? '起點' : '地點'}<input value={form.startPlace ?? ''} onChange={(e) => set('startPlace', e.target.value || null)} /></label>}{form.locationType === 'route' && <label className="field">終點<input value={form.endPlace ?? ''} onChange={(e) => set('endPlace', e.target.value || null)} /></label>}{form.locationType === 'online' && <label className="field">網址<input type="url" value={form.url ?? ''} onChange={(e) => set('url', e.target.value || null)} placeholder="https://" /></label>}<label className="field">備註<textarea value={form.note ?? ''} onChange={(e) => set('note', e.target.value || null)} rows={4} /></label><p className="muted small">完整時區、重複、提醒、人物與標籤會在第二輪加入；資料欄位已先保留。</p></div>}
    <div className="form-actions"><button type="button" onClick={onCancel}>取消</button><button className="primary" disabled={busy}>儲存</button></div>
  </form>;
}

function EventDetail({ api, snap, event, onBack, onEdit, onOpen, onAddChild }: { api: CalendarApi; snap: CalendarSnapshot; event: CalendarEvent; onBack: () => void; onEdit: () => void; onOpen: (id: string) => void; onAddChild: () => void }) {
  const [cancel, setCancel] = useState(false);
  const children = sortCalendarEvents(snap.events.filter((e) => e.parentEventId === event.id));
  const childDays = children.reduce((map, child) => {
    const list = map.get(child.startDate) ?? [];
    list.push(child);
    map.set(child.startDate, list);
    return map;
  }, new Map<string, CalendarEvent[]>());
  const parent = event.parentEventId ? snap.events.find((e) => e.id === event.parentEventId) : null;
  const canHaveChildren = !event.parentEventId && event.endDate > event.startDate;
  const remove = async () => {
    if (!window.confirm(`確定刪除「${event.title}」？`)) return;
    const ok = await api.run((s) => s.deleteEvent(event).then(() => true));
    if (ok) onBack();
  };
  return <section className={`card detail ${event.status === 'cancelled' ? 'cancelled' : ''}`}><div className="detail-head"><button className="icon-btn" onClick={onBack} aria-label="返回"><Icon name="left" /></button><button onClick={onEdit}><Icon name="pencil" size={17} /> 編輯</button></div>{event.status === 'cancelled' && <div className="cancel-badge">已取消</div>}<h2>{event.title}</h2><p className="detail-time">{rangeText(event)}・{timeText(event)}</p><p className="muted small">{groupOf(snap, event)?.name}</p>{parent && <button className="parent-link" onClick={() => onOpen(parent.id)}>主行程：{parent.title}<Icon name="right" size={16} /></button>}{event.startPlace && <p><b>{event.locationType === 'route' ? '路線' : '地點'}：</b>{event.startPlace}{event.endPlace ? ` → ${event.endPlace}` : ''}</p>}{event.url && <p><b>網址：</b><a href={event.url} target="_blank" rel="noreferrer">{event.url}</a></p>}{event.note && <div className="note-block"><b>備註</b><p>{event.note}</p></div>}{(canHaveChildren || children.length > 0) && <div className="itinerary"><div className="section-head"><h3>行程安排</h3>{event.status !== 'cancelled' && <button className="link" onClick={onAddChild}><Icon name="plus" size={16} /> 新增細項</button>}</div>{children.length ? <div className="itinerary-days">{[...childDays.entries()].map(([date, list]) => <div className="itinerary-day" key={date}><h4>第 {dateDiffDays(event.startDate, date) + 1} 天・{dateLabel(date)}</h4>{list.map((child) => <EventRow key={child.id} snap={snap} event={child} nested onClick={() => onOpen(child.id)} />)}</div>)}</div> : <p className="muted small">還沒有細項，可以加入交通、餐廳或景點。</p>}</div>}<div className="detail-actions">{event.status === 'cancelled' ? <button onClick={() => api.run((s) => s.restoreEvent(event)).then(() => undefined)}>恢復行程</button> : <button className="danger" onClick={() => setCancel(true)}>取消行程</button>}{event.parentEventId && <button onClick={() => api.run((s) => s.detachEvent(event))}>移出主行程</button>}<button className="danger" disabled={children.length > 0} onClick={remove}>刪除</button></div>{children.length > 0 && <p className="muted small">主行程仍有細項時不能刪除，請先將細項移出。</p>}{cancel && <div className="choice-panel"><b>要取消哪個範圍？</b>{children.length ? <><button className="danger" onClick={() => api.run((s) => s.cancelEvent(event, true)).then(() => setCancel(false))}>取消整趟（包含所有細項）</button><button onClick={() => api.run((s) => s.cancelEvent(event, false)).then(() => setCancel(false))}>只取消主行程，細項移出</button></> : <button className="danger" onClick={() => api.run((s) => s.cancelEvent(event, false)).then(() => setCancel(false))}>確認取消</button>}<button onClick={() => setCancel(false)}>返回</button></div>}</section>;
}

function TripChangeView({ api, data, onChange, onDone }: { api: CalendarApi; data: Extract<Open, { kind: 'trip-change' }>; onChange: (o: Open) => void; onDone: () => void }) {
  const children = api.snap!.events.filter((e) => e.parentEventId === data.event.id);
  const outside = children.filter((e) => !dateInRange(data.choices[e.id].startDate, data.input.startDate, data.input.endDate) || !dateInRange(data.choices[e.id].endDate, data.input.startDate, data.input.endDate));
  const finish = async (mode: 'together' | 'onlyParent') => {
    if (mode === 'onlyParent' && outside.length) return onChange({ ...data, step: 'children' });
    const ok = await api.run((s) => s.updateTrip(data.event, data.input, mode).then(() => true));
    if (ok) onDone();
  };
  const saveChildren = async () => {
    const actions: TripChildAction[] = outside.map((e) => ({ event: e, ...data.choices[e.id] }));
    const ok = await api.run((s) => s.updateTripSelective(data.event, data.input, actions).then(() => true));
    if (ok) onDone();
  };
  if (data.step === 'scope') return <section className="card impact"><h2>主行程日期已變更</h2><p>共有 {children.length} 筆細項會受到影響。新日期：{data.input.startDate}～{data.input.endDate}</p><button className="primary" onClick={() => finish('together')}>整趟一起改期（預設）</button><button onClick={() => finish('onlyParent')}>只修改主行程</button><button onClick={() => onChange({ kind: 'form', eventId: data.event.id, date: data.event.startDate, parentId: data.event.parentEventId })}>返回編輯</button></section>;
  return <section className="card impact"><h2>處理超出新期間的細項</h2><p className="muted small">每一筆都要選擇移入、解除關聯或取消。</p>{outside.map((e) => { const c = data.choices[e.id]; return <div className="impact-row" key={e.id}><b>{e.title}</b><select value={c.action} onChange={(x) => onChange({ ...data, choices: { ...data.choices, [e.id]: { ...c, action: x.target.value as ChildChoice['action'] } } })}><option value="move">移入新日期</option><option value="detach">解除關聯</option><option value="cancel">取消細項</option></select>{c.action === 'move' && <div className="row"><input type="date" value={c.startDate} onChange={(x) => onChange({ ...data, choices: { ...data.choices, [e.id]: { ...c, startDate: x.target.value } } })} /><span>～</span><input type="date" value={c.endDate} onChange={(x) => onChange({ ...data, choices: { ...data.choices, [e.id]: { ...c, endDate: x.target.value } } })} /></div>}</div>; })}<div className="form-actions"><button onClick={() => onChange({ ...data, step: 'scope' })}>上一步</button><button className="primary" onClick={saveChildren}>確認修改</button></div></section>;
}

function GroupsView({ api, snap }: { api: CalendarApi; snap: CalendarSnapshot }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#1f6fd1');
  const add = async () => { const id = await api.run((s) => s.addGroup(name, color)); if (id) { setName(''); setAdding(false); } };
  const move = async (group: CalendarGroup, delta: number) => {
    const list = snap.groups.filter((g) => !g.archived);
    const i = list.findIndex((g) => g.id === group.id);
    const other = list[i + delta];
    if (!other) return;
    await api.run(async (s) => { await s.updateGroup(group, { sort: other.sort }); await s.updateGroup(other, { sort: group.sort }); });
  };
  return <section><div className="view-head"><div><h2>行事曆群組</h2><p className="muted small">第一輪不提供永久刪除；停用後仍保留舊行程。</p></div><button onClick={() => setAdding(!adding)}><Icon name="plus" size={17} /> 新增</button></div>{adding && <div className="card add-group"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="群組顏色" /><input value={name} onChange={(e) => setName(e.target.value)} placeholder="群組名稱" /><button className="primary" onClick={add} disabled={!name.trim() || api.busy}>儲存</button></div>}<div className="card group-list">{snap.groups.map((g, i) => <GroupRow key={g.id} api={api} snap={snap} group={g} first={i === 0} last={i === snap.groups.length - 1} move={move} />)}</div></section>;
}

function GroupRow({ api, snap, group, first, last, move }: { api: CalendarApi; snap: CalendarSnapshot; group: CalendarGroup; first: boolean; last: boolean; move: (g: CalendarGroup, d: number) => void }) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(group.name);
  const [color, setColor] = useState(group.color);
  const save = async () => { const ok = await api.run((s) => s.updateGroup(group, { name, color }).then(() => true)); if (ok) setEdit(false); };
  return <div className={`group-row ${group.archived ? 'archived' : ''}`}>{edit ? <><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /><input value={name} onChange={(e) => setName(e.target.value)} /><button className="primary" onClick={save}>儲存</button><button onClick={() => setEdit(false)}>取消</button></> : <><span className="group-dot" style={{ background: group.color }} /><span className="group-name"><b>{group.name}</b>{snap.defaultGroupId === group.id && <small>預設</small>}{group.archived && <small>已停用</small>}</span>{!group.archived && <><label className="switch"><input type="checkbox" checked={!group.hidden} onChange={() => api.run((s) => s.updateGroup(group, { hidden: !group.hidden }))} />顯示</label><button className="icon-small" disabled={first} onClick={() => move(group, -1)} aria-label="往前">↑</button><button className="icon-small" disabled={last} onClick={() => move(group, 1)} aria-label="往後">↓</button><button onClick={() => api.run((s) => s.setDefaultGroup(group.id))} disabled={snap.defaultGroupId === group.id}>設為預設</button><button onClick={() => setEdit(true)}>編輯</button><button className="danger" onClick={() => api.run((s) => s.updateGroup(group, { archived: true, hidden: true }))}>停用</button></>}{group.archived && <button onClick={() => api.run((s) => s.updateGroup(group, { archived: false, hidden: false }))}>恢復</button>}</>}</div>;
}
