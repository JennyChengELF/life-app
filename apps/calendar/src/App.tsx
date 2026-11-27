import { useState } from 'react';
import { Icon } from '@life/ui/icon';
import { AppTabs, type AppTabItem } from '@life/ui/app-tabs';
import { MonthCalendar, type MonthCalendarMark } from '@life/ui/month-calendar';
import { WeekDateStrip } from '@life/ui/week-date-strip';
import { TimeField } from '@life/ui/time-field';
import { CalendarReminderList } from '@life/ui/calendar-reminder-list';
import { ReminderFields } from './ReminderFields';
import { PeopleFields, personLabel } from '@life/ui/people-fields';
import { TagPicker, tagLabel } from '@life/ui/tag-picker';
import {
  addDateDays,
  analyzeCalendarLocalTime,
  calendarParentKey,
  canParentCalendarEvent,
  findCalendarParent,
  calendarRecurrenceEndText,
  calendarRecurrenceText,
  calendarReminderLabel,
  calendarReminderTime,
  calendarDurationMinutes,
  convertCalendarInstant,
  currentDeviceTimeZone,
  dateDiffDays,
  dateInRange,
  eventOnDate,
  expandCalendarEvents,
  expandPersonAnniversaries,
  PERSON_ANNIVERSARY_SOURCE,
  formatConvertedCalendarTime,
  isValidTimeZone,
  parseCalendarReminders,
  resolveCalendarLocalTime,
  sortCalendarEvents,
  supportedTimeZones,
  taiwanDayInfo,
  timeZoneLabel,
  todayKey,
  type CalendarEvent,
  type CalendarEventInput,
  type CalendarGroup,
  type CalendarRecurrence,
  type CalendarRecurrenceScope,
  type CalendarSnapshot,
  type TripChildAction,
  type TripAttachAction,
} from '@life/db';
import { useCalendar, type CalendarApi } from './useCalendar';
import { AppSwitcher } from '@life/ui/app-switcher';

const HOME_URL = import.meta.env.DEV ? `http://${location.hostname}:5172/` : '../';
type MainTab = 'add' | 'calendar' | 'more';
type Tab = MainTab | 'agenda' | 'groups' | 'timezones' | 'data' | 'issues';
type AgendaMode = 'upcoming' | 'history' | 'month';
type CalendarView = 'month' | 'week' | 'day';
const CALENDAR_VIEWS = [['month', '月'], ['week', '週'], ['day', '日']] as const;
const TABS: AppTabItem<MainTab>[] = [
  { key: 'add', icon: 'plus', label: '新增' },
  { key: 'calendar', icon: 'calendar', label: '日曆' },
  { key: 'more', icon: 'more', label: '更多' },
];
const tabOf = (tab: Tab): MainTab => tab === 'add' || tab === 'calendar' || tab === 'more' ? tab : 'more';
type Open =
  | { kind: 'detail'; id: string }
  | { kind: 'form'; eventId: string | null; date: string; parentId: string | null }
  | { kind: 'join-trip'; parentId: string }
  | { kind: 'move-child'; eventId: string }
  | { kind: 'recurrence-scope'; event: CalendarEvent; action: 'edit' | 'cancel' | 'restore' | 'delete'; input?: CalendarEventInput }
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
const groupOf = (snap: CalendarSnapshot, e: CalendarEvent) => snap.groups.find((g) => g.id === e.groupId);
const timeText = (e: CalendarEvent) => e.timeType === 'allDay' ? '全天' : e.timeType === 'point' ? e.startTime! : `${e.startTime}～${e.endTime}`;
const rangeText = (e: CalendarEvent) => e.startDate === e.endDate ? dateLabel(e.startDate, true) : `${slashDateLabel(e.startDate)}～${slashDateLabel(e.endDate)}`;
const weekStart = (date: string) => addDateDays(date, -new Date(`${date}T00:00:00Z`).getUTCDay());
const eventInput = (e: CalendarEvent): CalendarEventInput => ({
  title: e.title,
  groupId: e.groupId,
  parentEventId: e.parentEventId,
  timeType: e.timeType,
  startDate: e.startDate,
  startTime: e.startTime,
  startTimeZone: e.startTimeZone,
  startUtcOffset: e.startUtcOffset,
  startDisambiguation: e.startDisambiguation,
  endDate: e.endDate,
  endTime: e.endTime,
  endTimeZone: e.endTimeZone,
  endUtcOffset: e.endUtcOffset,
  endDisambiguation: e.endDisambiguation,
  timeMode: e.timeMode,
  timeZoneInferred: e.timeZoneInferred,
  locationType: e.locationType,
  startPlace: e.startPlace,
  endPlace: e.endPlace,
  url: e.url,
  note: e.note,
  status: e.status,
  recurrence: e.recurrence,
  recurrenceParentId: e.recurrenceParentId,
  recurrenceInstanceKey: e.recurrenceInstanceKey,
  recurrenceExceptions: e.recurrenceExceptions,
  reminders: e.reminders ?? [],
  peopleIds: e.peopleIds ?? [],
  tagIds: e.tagIds ?? [],
  bujoEnabled: e.bujoEnabled ?? false,
});

function requestedDate() {
  const value = new URLSearchParams(location.search).get('date');
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayKey();
}

export function App() {
  const api = useCalendar();
  const initialDate = requestedDate();
  const [tab, setTab] = useState<Tab>(() => location.hash === '#agenda' ? 'agenda' : location.hash === '#groups' ? 'groups' : location.hash === '#new' ? 'add' : 'calendar');
  const [selectedDate, setSelectedDate] = useState(initialDate);
  // （2026-11-25 使用者確認：每次開啟行事曆先顯示月曆。）
  const [calendarView, setCalendarView] = useState<CalendarView>('month');
  const [open, setOpen] = useState<Open | null>(() => {
    if (location.hash === '#new') return { kind: 'form', eventId: null, date: initialDate, parentId: null };
    if (location.hash.startsWith('#event/')) return { kind: 'detail', id: decodeURIComponent(location.hash.slice(7)) };
    return null;
  });

  const goTab = (next: MainTab) => {
    if (tab === 'add' && next === 'add') return;
    if ((open?.kind === 'form' || open?.kind === 'trip-change' || (open?.kind === 'recurrence-scope' && open.action === 'edit')) && !confirm('這筆行程尚未儲存，確定要離開嗎？')) return;
    setTab(next);
    if (next === 'add') setOpen({ kind: 'form', eventId: null, date: selectedDate, parentId: null });
    else setOpen(null);
    window.scrollTo(0, 0);
  };

  const setDate = (date: string) => {
    setSelectedDate(date);
  };

  if (api.status === 'starting' || (api.status === 'loading' && !api.snap)) return <Shell api={api}><div className="center muted">讀取中⋯⋯</div></Shell>;
  if (api.status === 'need-connect') return <Shell api={api}><div className="center connect"><p>行程存在你的 Google 試算表，需要先連線。</p><button className="primary big" onClick={api.connect}>連線 Google</button>{api.error && <p className="error-text">{api.error}</p>}<p className="muted small">APP 只能存取它自己建立的試算表。</p></div></Shell>;
  if (api.status === 'error' || !api.snap) return <Shell api={api}><div className="center"><p className="error-text">{api.error}</p><button className="primary" onClick={() => location.reload()}>重新載入</button></div></Shell>;
  const snap = api.snap;
  const recurrenceStart = snap.recurrenceMasters.map((event) => event.startDate).sort()[0] ?? selectedDate;
  const selectedMonthEnd = addDateDays(`${shiftMonth(selectedDate.slice(0, 7), 1)}-01`, -1);
  const recurrenceEnd = [addDateDays(todayKey(), 370), addDateDays(selectedMonthEnd, 14)].sort().at(-1)!;
  const expandedEvents = [
    ...expandCalendarEvents(snap, recurrenceStart, recurrenceEnd),
    ...expandPersonAnniversaries(snap, addDateDays(selectedDate, -6), addDateDays(selectedDate, 6)),
  ];
  const activeGroups = new Set(snap.groups.filter((g) => !g.hidden).map((g) => g.id));
  const visibleEvents = expandedEvents.filter((e) => activeGroups.has(e.groupId));
  const openedId = open?.kind === 'detail' ? open.id : open?.kind === 'form' ? open.eventId : open?.kind === 'move-child' ? open.eventId : open?.kind === 'join-trip' ? open.parentId : null;
  const anniversaryDate = openedId?.startsWith('anniversary:') ? openedId.slice(-10) : null;
  const openedEvent = openedId ? expandedEvents.find((e) => e.id === openedId)
    ?? findCalendarParent(snap, openedId)
    ?? (anniversaryDate ? expandPersonAnniversaries(snap, anniversaryDate, anniversaryDate).find((e) => e.id === openedId) : undefined)
    ?? null : null;

  const saveEvent = async (input: CalendarEventInput, current: CalendarEvent | null) => {
    if (input.timeType === 'point') input = { ...input, endDate: input.startDate, endTime: null };
    const parent = findCalendarParent(snap, input.parentEventId);
    if (parent && (input.startDate < parent.startDate || input.endDate > parent.endDate)) {
      api.showToast({ kind: 'error', text: `細項日期必須在主行程的 ${parent.startDate}～${parent.endDate} 之內` });
      return false;
    }
    if (current) {
      if (current.isRecurrenceInstance) {
        setOpen({ kind: 'recurrence-scope', event: current, action: 'edit', input });
        return false;
      }
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
    if (id) {
      setSelectedDate(input.startDate);
      setTab('calendar');
      setOpen(parent ? { kind: 'detail', id: parent.id } : null);
    }
    return !!id;
  };

  return (
    <Shell api={api} tab={tab} goTab={goTab} date={selectedDate} confirmLeave={open?.kind === 'form' || open?.kind === 'trip-change' || (open?.kind === 'recurrence-scope' && open.action === 'edit')}>
      <TimeZoneNotice api={api} snap={snap} />
      {tab === 'calendar' && !open && <CalendarReminderList
        snapshot={snap}
        eventHref={(event) => {
          const params = new URLSearchParams(location.search);
          params.set('date', event.startDate);
          return `?${params}#event/${encodeURIComponent(event.id)}`;
        }}
        onOpen={(event) => {
          setSelectedDate(event.startDate);
          setOpen({ kind: 'detail', id: event.id });
        }}
      />}
      {snap.timeZoneRulesUpdated > 0 && <div className="msg warn">有 {snap.timeZoneRulesUpdated} 個未來時間因所在地規則更新，已保留原本鐘面時間並重新計算換算結果。</div>}
      {open?.kind === 'form' ? (
        <>{tab === 'add' && !open.eventId && !open.parentId && <WeekDateStrip selected={open.date} setDate={(value) => {
          if (value !== open.date && !confirm('更換日期會清除目前尚未儲存的表單，確定要更換嗎？')) return;
          setSelectedDate(value);
          setOpen({ ...open, date: value });
        }} />}
        <EventForm key={`${open.eventId ?? 'new'}-${open.date}`} snap={snap} event={openedEvent} initialDate={open.date} parentId={open.parentId} busy={api.busy} onAddPerson={(nickname, fullName) => api.run((store) => store.addPerson(nickname, fullName))} onAddTag={(name) => api.run((store) => store.addTag(name))} hideStartDate={tab === 'add' && !open.eventId && !open.parentId} onCancel={() => {
          if (open.eventId) setOpen({ kind: 'detail', id: open.eventId });
          else { setOpen(open.parentId ? { kind: 'detail', id: open.parentId } : null); setTab('calendar'); }
        }} onSave={saveEvent} /></>
      ) : open?.kind === 'detail' && openedEvent ? (
        <EventDetail api={api} snap={snap} event={openedEvent} onBack={() => setOpen(null)} onEdit={() => setOpen({ kind: 'form', eventId: openedEvent.id, date: openedEvent.startDate, parentId: openedEvent.parentEventId })} onOpen={(id) => setOpen({ kind: 'detail', id })} onAddChild={() => setOpen({ kind: 'form', eventId: null, date: openedEvent.startDate, parentId: calendarParentKey(openedEvent) })} onJoinExisting={() => setOpen({ kind: 'join-trip', parentId: openedEvent.id })} onMoveChild={() => setOpen({ kind: 'move-child', eventId: openedEvent.id })} onRecurrenceAction={(action) => setOpen({ kind: 'recurrence-scope', event: openedEvent, action })} />
      ) : open?.kind === 'join-trip' && openedEvent ? (
        <JoinTripView api={api} snap={snap} parent={openedEvent} onCancel={() => setOpen({ kind: 'detail', id: openedEvent.id })} onDone={() => setOpen({ kind: 'detail', id: openedEvent.id })} />
      ) : open?.kind === 'move-child' && openedEvent ? (
        <MoveChildView api={api} snap={snap} event={openedEvent} onCancel={() => setOpen({ kind: 'detail', id: openedEvent.id })} onDone={() => setOpen({ kind: 'detail', id: openedEvent.id })} />
      ) : open?.kind === 'trip-change' ? (
        <TripChangeView api={api} data={open} onChange={setOpen} onDone={() => setOpen({ kind: 'detail', id: open.event.id })} />
      ) : open?.kind === 'recurrence-scope' ? (
        <RecurrenceScopeView api={api} data={open} onCancel={() => setOpen({ kind: 'detail', id: open.event.id })} onDone={(date) => { setSelectedDate(date); setTab('calendar'); setOpen(null); }} />
      ) : (
        <>
          {tab === 'calendar' && (
            <CalendarDateView
              view={calendarView}
              setView={setCalendarView}
              snap={snap}
              events={visibleEvents}
              selected={selectedDate}
              setDate={setDate}
              openEvent={(id) => setOpen({ kind: 'detail', id })}
            />
          )}
          {tab === 'more' && <MoreView issues={snap.issues.length} open={(next) => { setTab(next); window.scrollTo(0, 0); }} />}
          {tab === 'agenda' && <><MoreBack onClick={() => setTab('more')} /><AgendaView snap={snap} events={visibleEvents} selectedMonth={selectedDate.slice(0, 7)} openEvent={(id) => setOpen({ kind: 'detail', id })} /></>}
          {tab === 'groups' && <><MoreBack onClick={() => setTab('more')} /><GroupsView api={api} snap={snap} /></>}
          {tab === 'timezones' && <><MoreBack onClick={() => setTab('more')} /><TimeZoneSettingsView api={api} snap={snap} /></>}
          {tab === 'data' && <><MoreBack onClick={() => setTab('more')} /><DataView api={api} /></>}
          {tab === 'issues' && <><MoreBack onClick={() => setTab('more')} /><IssuesView snap={snap} /></>}
          {tab === 'calendar' && <button className="fab" onClick={() => goTab('add')} aria-label="新增行程"><Icon name="plus" size={28} /></button>}
        </>
      )}
    </Shell>
  );
}

function Shell({ api, tab, goTab, date, confirmLeave = false, children }: { api: CalendarApi; tab?: Tab; goTab?: (tab: MainTab) => void; date?: string; confirmLeave?: boolean; children: React.ReactNode }) {
  return (
    <div className="app calendar-app">
      <header className="topbar">
        <AppSwitcher current="calendar" homeUrl={HOME_URL} date={date} confirmLeave={confirmLeave} />
        <h1>行事曆</h1>
        {tab && goTab && <AppTabs items={TABS} current={tabOf(tab)} onChange={goTab} placement="top" />}
        {api.status === 'ready' && <button className="icon-btn" onClick={api.refresh} disabled={api.busy} title="重新整理" aria-label="重新整理"><span className={api.busy ? 'spin' : ''}><Icon name="refresh" /></span></button>}
      </header>
      {api.mode === 'local' && <div className="mode-banner">本機測試模式：資料只存在這個瀏覽器，還沒接上 Google 試算表</div>}
      <main>{children}</main>
      {api.toast && <button className={`toast ${api.toast.kind === 'error' ? 'error' : ''}`} onClick={api.dismissToast}>{api.toast.text}</button>}
      {tab && goTab && <AppTabs items={TABS} current={tabOf(tab)} onChange={goTab} placement="bottom" />}
    </div>
  );
}

type DateViewProps = {
  snap: CalendarSnapshot;
  events: CalendarEvent[];
  selected: string;
  setDate: (date: string) => void;
  openEvent: (id: string) => void;
};

function CalendarDateView(props: DateViewProps & { view: CalendarView; setView: (view: CalendarView) => void }) {
  const { view, setView, selected, setDate } = props;
  const span = view === 'week' ? 7 : 1;
  const start = view === 'week' ? weekStart(selected) : selected;
  const end = addDateDays(start, span - 1);
  const heading = view === 'week' ? `${dateLabel(start, true)}～${dateLabel(end, start.slice(0, 4) !== end.slice(0, 4))}` : dateLabel(selected, true);
  const unit = view === 'week' ? '週' : '天';

  return <>
    <div className="calendar-view-choice" role="group" aria-label="日曆檢視">
      {CALENDAR_VIEWS.map(([value, label]) => (
        <button type="button" key={value} aria-label={`${label}檢視`} aria-pressed={view === value} onClick={() => setView(value)}>{label}</button>
      ))}
    </div>
    {view === 'month' ? <MonthView {...props} /> : <>
      <div className="card calendar-period-nav">
        <button type="button" className="icon-btn" aria-label={`上一${unit}`} onClick={() => setDate(addDateDays(selected, -span))}><Icon name="left" /></button>
        <h2>{heading}</h2>
        <button type="button" className="icon-btn" aria-label={`下一${unit}`} onClick={() => setDate(addDateDays(selected, span))}><Icon name="right" /></button>
        <button type="button" className="link calendar-period-today" onClick={() => setDate(todayKey())}>回到今天</button>
      </div>
      {view === 'week' ? (
        <WeekView {...props} start={start} openDay={(date) => { setDate(date); setView('day'); }} />
      ) : <DayView {...props} />}
    </>}
  </>;
}

function dayTimeText(event: CalendarEvent, date: string) {
  if (event.timeType !== 'range' || event.startDate === event.endDate) return timeText(event);
  if (date === event.startDate) return `${event.startTime} 起`;
  if (date === event.endDate) return `至 ${event.endTime}`;
  return '跨日進行中';
}

function WeekView({ snap, events, selected, openEvent, start, openDay }: DateViewProps & { start: string; openDay: (date: string) => void }) {
  const days = Array.from({ length: 7 }, (_, index) => addDateDays(start, index));
  const today = todayKey();
  return <div className="calendar-week">
    {days.map((date) => {
      const rows = sortCalendarEvents(events.filter((event) => eventOnDate(event, date)));
      const holiday = taiwanDayInfo(date).type === 'holiday';
      return <section className="card calendar-week-day" key={date}>
        <h3>
          <button type="button" className={`calendar-week-date ${holiday ? 'holiday' : ''} ${date === selected ? 'selected' : ''}`} onClick={() => openDay(date)} aria-current={date === today ? 'date' : undefined} aria-label={`查看 ${dateLabel(date, true)}的行程`}>
            {dateLabel(date)}
          </button>
        </h3>
        {rows.length ? rows.map((event) => (
          <button type="button" className={`calendar-week-event ${event.status === 'cancelled' ? 'cancelled' : ''}`} key={event.id} onClick={() => openEvent(event.id)} style={{ borderInlineStartColor: groupOf(snap, event)?.color ?? 'var(--accent)' }}>
            <small>{dayTimeText(event, date)}</small>
            <b>{event.title}</b>
          </button>
        )) : <p className="muted small calendar-week-empty">沒有行程</p>}
      </section>;
    })}
  </div>;
}

function DayView({ snap, events, selected, openEvent }: DateViewProps) {
  const rows = sortCalendarEvents(events.filter((event) => eventOnDate(event, selected)));
  const allDay = rows.filter((event) => event.timeType === 'allDay');
  const timed = rows.filter((event) => event.timeType !== 'allDay');
  const renderRow = (event: CalendarEvent) => <EventRow key={event.id} snap={snap} event={event} displayTime={dayTimeText(event, selected)} onClick={() => openEvent(event.id)} />;

  if (!rows.length) return <div className="card center muted">這天沒有行程</div>;
  return <>
    {allDay.length > 0 && <section className="card day-list"><h3>全天行程</h3>{allDay.map(renderRow)}</section>}
    {timed.length > 0 && <section className="card day-list"><h3>時間軸</h3>{timed.map(renderRow)}</section>}
  </>;
}

function MonthView({ snap, events, selected, setDate, openEvent }: DateViewProps) {
  const selectedEvents = sortCalendarEvents(events.filter((e) => eventOnDate(e, selected)));
  const selectedTaiwanDay = taiwanDayInfo(selected);
  const unnamed = events.filter((e) => e.titleMissing).length;
  const ordinary = events.filter((event) => event.systemSource !== PERSON_ANNIVERSARY_SOURCE);
  const anniversaryMonths = new Map<string, CalendarEvent[]>();
  const info = (date: string) => {
    const month = date.slice(0, 7);
    let anniversaries = anniversaryMonths.get(month);
    if (!anniversaries) {
      anniversaries = expandPersonAnniversaries(snap, `${month}-01`, addDateDays(`${shiftMonth(month, 1)}-01`, -1))
        .filter((event) => !groupOf(snap, event)?.hidden);
      anniversaryMonths.set(month, anniversaries);
    }
    const rows = sortCalendarEvents([...ordinary, ...anniversaries].filter((event) => eventOnDate(event, date)));
    const taiwan = taiwanDayInfo(date);
    if (!rows.length) return { tone: taiwan.type, label: taiwan.source === 'official' ? undefined : taiwan.source === 'provisional' ? '台灣辦公日：暫定，官方尚未公布' : '台灣辦公日：依週一至週五推算' };
    const shown = rows.slice(0, rows.length > 2 ? 2 : 3);
    const marks: MonthCalendarMark[] = shown.map((event) => ({
      kind: event.startDate === event.endDate ? 'dot' : 'bar',
      color: groupOf(snap, event)?.color ?? 'var(--accent)',
      label: event.title,
    }));
    if (rows.length > 2) marks.push({ kind: 'text', text: `+${rows.length - 2}`, color: 'var(--muted)', label: `另有 ${rows.length - 2} 筆` });
    return { marks, tone: taiwan.type, label: `${rows.length} 筆行程：${rows.map((event) => event.title).join('、')}${taiwan.source === 'official' ? '' : taiwan.source === 'provisional' ? '；辦公日為暫定' : '；辦公日為推算'}` };
  };
  return (
    <>
      {unnamed > 0 && <div className="msg warn">有 {unnamed} 筆未命名行程，之後可以點開補上標題。</div>}
      <MonthCalendar selected={selected} setDate={setDate} dayInfo={info} />
      <section className="card day-list"><h2>{dateLabel(selected)}</h2>{selectedTaiwanDay.source !== 'official' && <p className="calendar-estimate">{selectedTaiwanDay.source === 'provisional' ? '官方辦公日曆尚未公布，目前按週一至週五暫定。' : '這個年份沒有內建官方資料，目前按週一至週五推算。'}</p>}{selectedEvents.length ? selectedEvents.map((e) => <EventRow key={e.id} snap={snap} event={e} onClick={() => openEvent(e.id)} />) : <p className="muted empty">這天沒有行程</p>}</section>
    </>
  );
}

function MoreBack({ onClick }: { onClick: () => void }) {
  return <button type="button" className="link more-back" onClick={onClick}><Icon name="left" size={18} /> 返回更多</button>;
}

function MoreView({ issues, open }: { issues: number; open: (tab: Exclude<Tab, MainTab>) => void }) {
  const rows: { tab: Exclude<Tab, MainTab>; icon: 'clipboard' | 'settings' | 'book' | 'alert'; label: string; note: string }[] = [
    { tab: 'agenda', icon: 'clipboard', label: '行程表', note: '近期、歷史與指定月份' },
    { tab: 'groups', icon: 'settings', label: '群組設定', note: '名稱、顏色、排序、隱藏與停用' },
    { tab: 'timezones', icon: 'settings', label: '時區設定', note: '主要時區、目前所在地與最近使用' },
    { tab: 'data', icon: 'book', label: '資料與試算表', note: '行事曆資料與 Google 連線' },
  ];
  if (issues) rows.push({ tab: 'issues', icon: 'alert', label: '需要處理的資料', note: `${issues} 列需要修正` });
  return <div className="more-menu"><h2>行事曆功能</h2>{rows.map((row) => <button className="more-menu-item" key={row.tab} onClick={() => open(row.tab)}><Icon name={row.icon} /><span><strong>{row.label}</strong><small>{row.note}</small></span><Icon name="right" size={18} /></button>)}</div>;
}

function TimeZoneNotice({ api, snap }: { api: CalendarApi; snap: CalendarSnapshot }) {
  const detected = currentDeviceTimeZone();
  if (!isValidTimeZone(detected) || detected === snap.currentTimeZone || detected === snap.lastDetectedTimeZone) return null;
  return <div className="msg timezone-notice"><b>偵測到目前所在地的時區不同</b><span>裝置：{timeZoneLabel(detected)}；目前設定：{timeZoneLabel(snap.currentTimeZone)}</span><span className="row"><button className="primary" onClick={() => api.run((store) => store.confirmDetectedTimeZone(detected, true))}>改用裝置時區</button><button onClick={() => api.run((store) => store.confirmDetectedTimeZone(detected, false))}>維持目前設定</button></span></div>;
}

function TimeZoneSelect({ label, value, snap, onChange }: { label: string; value: string; snap: CalendarSnapshot; onChange: (value: string) => void }) {
  const preferred = [...new Set([snap.currentTimeZone, snap.homeTimeZone, ...snap.recentTimeZones])];
  const preferredSet = new Set(preferred);
  const others = supportedTimeZones().filter((zone) => !preferredSet.has(zone));
  return <label className="field">{label}<select value={value} onChange={(event) => onChange(event.target.value)}><optgroup label="常用時區">{preferred.map((zone) => <option key={zone} value={zone}>{timeZoneLabel(zone)}</option>)}</optgroup><optgroup label="其他國家／城市">{others.map((zone) => <option key={zone} value={zone}>{timeZoneLabel(zone)}</option>)}</optgroup></select></label>;
}

function TimeZoneSettingsView({ api, snap }: { api: CalendarApi; snap: CalendarSnapshot }) {
  const [home, setHome] = useState(snap.homeTimeZone);
  const [current, setCurrent] = useState(snap.currentTimeZone);
  const device = currentDeviceTimeZone();
  const save = async () => {
    const ok = await api.run(async (store) => { await store.setHomeTimeZone(home); await store.setCurrentTimeZone(current); return true; });
    if (ok) api.showToast({ kind: 'info', text: '時區設定已儲存；既有行程不會被更改' });
  };
  return <section className="card timezone-settings"><h2>時區設定</h2><p className="muted small">主要時區只會影響新行程與舊資料缺少時區時的推定，不會改動既有行程。</p><TimeZoneSelect label="主要時區" value={home} snap={snap} onChange={setHome} /><TimeZoneSelect label="目前所在地時區" value={current} snap={snap} onChange={setCurrent} />{isValidTimeZone(device) && <button type="button" onClick={() => setCurrent(device)}>使用裝置偵測：{timeZoneLabel(device)}</button>}<div className="form-actions"><button className="primary" disabled={api.busy || (home === snap.homeTimeZone && current === snap.currentTimeZone)} onClick={save}>儲存設定</button></div></section>;
}

function DataView({ api }: { api: CalendarApi }) {
  const url = api.fileUrl();
  return <section className="card"><h2>資料與試算表</h2>{api.mode === 'local' ? <p className="muted">本機測試模式：資料只存在這個瀏覽器。</p> : url ? <a className="btn" href={url} target="_blank" rel="noreferrer">開啟行事曆試算表 ↗</a> : <p className="muted">目前沒有可開啟的試算表。</p>}</section>;
}

function IssuesView({ snap }: { snap: CalendarSnapshot }) {
  return <section className="card"><h2>需要處理的資料</h2>{snap.issues.length ? snap.issues.map((issue) => <div className="issue-row" key={`${issue.table}-${issue.rowNumber}-${issue.text}`}><strong>{issue.table} 第 {issue.rowNumber} 列</strong><p>{issue.text}</p></div>) : <p className="muted">目前沒有需要處理的資料。</p>}</section>;
}

function eventResolvedTime(event: CalendarEvent, end = false) {
  if (event.timeType === 'allDay' || event.timeMode === 'floatingLocal') return null;
  const date = end && event.timeType === 'range' ? event.endDate : event.startDate;
  const time = end && event.timeType === 'range' ? event.endTime! : event.startTime!;
  const zone = end && event.timeType === 'range' ? event.endTimeZone! : event.startTimeZone!;
  const offset = end && event.timeType === 'range' ? event.endUtcOffset : event.startUtcOffset;
  const choice = end && event.timeType === 'range' ? event.endDisambiguation : event.startDisambiguation;
  return resolveCalendarLocalTime(date, time, zone, choice, offset, true);
}

function currentZoneText(snap: CalendarSnapshot, event: CalendarEvent) {
  if (event.timeType === 'allDay' || event.timeMode === 'floatingLocal' || event.startTimeZone === snap.currentTimeZone) return null;
  try {
    const converted = convertCalendarInstant(eventResolvedTime(event)!.epochMilliseconds, snap.currentTimeZone);
    return `目前所在地：${formatConvertedCalendarTime(converted)}`;
  } catch {
    return null;
  }
}

function EventRow({ snap, event, onClick, nested = false, displayTime = timeText(event) }: { snap: CalendarSnapshot; event: CalendarEvent; onClick: () => void; nested?: boolean; displayTime?: string }) {
  const group = groupOf(snap, event);
  const converted = currentZoneText(snap, event);
  return <button className={`event-row ${event.status === 'cancelled' ? 'cancelled' : ''} ${nested ? 'nested' : ''}`} onClick={onClick}><span className="event-color" style={{ background: group?.color ?? '#1f6fd1' }} /><span className="event-time">{displayTime}</span><span className="event-main"><b>{event.title}</b>{event.recurrence && <small className="recurrence-row-label">重複{event.recurrenceOverride ? '・本次已修改' : ''}</small>}{event.startPlace && <small>{event.startPlace}{event.endPlace ? ` → ${event.endPlace}` : ''}</small>}{converted && <small className="converted-time">{converted}</small>}</span><Icon name="right" size={17} /></button>;
}

function AgendaView({ snap, events, selectedMonth, openEvent }: { snap: CalendarSnapshot; events: CalendarEvent[]; selectedMonth: string; openEvent: (id: string) => void }) {
  // （2026-11-20 使用者決定：大量舊行程以近期、年代／年份、指定年月分開瀏覽。）
  const [mode, setMode] = useState<AgendaMode>('upcoming');
  const [showCancelled, setShowCancelled] = useState(false);
  const [month, setMonth] = useState(selectedMonth);
  // （2026-11-20 使用者決定：有細項的主行程在行程表預設收合，避免資料太長。）
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(events.flatMap((event) => event.parentEventId ? [event.parentEventId] : [])));
  const usableEvents = events.filter((e) => e.systemSource !== PERSON_ANNIVERSARY_SOURCE && (showCancelled || e.status !== 'cancelled'));
  const ids = new Set(usableEvents.map(calendarParentKey));
  const roots = sortCalendarEvents(usableEvents.filter((e) => !e.parentEventId || !ids.has(e.parentEventId)));
  const historical = roots.filter((e) => e.endDate < todayKey());
  const currentYear = Number(todayKey().slice(0, 4));
  const anniversaryGroup = snap.groups.find((group) => group.sourceType === PERSON_ANNIVERSARY_SOURCE && !group.hidden && !group.archived);
  const historyYears = new Set(historical.map((event) => Number(event.startDate.slice(0, 4))));
  if (anniversaryGroup) historyYears.add(currentYear);
  const decades = [...new Set([...historyYears].map((year) => Math.floor(year / 10) * 10))].sort((a, b) => b - a);
  const [decade, setDecade] = useState(() => decades[0] ?? Math.floor(new Date().getFullYear() / 10) * 10);
  const years = [...historyYears].filter((value) => value >= decade && value <= decade + 9).sort((a, b) => b - a);
  const [year, setYear] = useState(() => years[0] ?? new Date().getFullYear());
  const toggle = (id: string) => setCollapsed((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const overlaps = (event: CalendarEvent, start: string, end: string) => event.startDate <= end && event.endDate >= start;
  const start = mode === 'history' ? `${year}-01-01` : mode === 'month' ? `${month}-01` : todayKey();
  const end = mode === 'history' ? `${year}-12-31` : mode === 'month' ? addDateDays(`${shiftMonth(month, 1)}-01`, -1) : addDateDays(todayKey(), 92);
  const anniversaries = anniversaryGroup ? expandPersonAnniversaries(snap, start, end) : [];
  const shown = sortCalendarEvents([...roots, ...anniversaries].filter((e) => overlaps(e, start, end) && (mode !== 'history' || e.endDate < todayKey())));
  const monthGroups = shown.reduce((map, event) => {
    const key = event.startDate.slice(0, 7);
    const list = map.get(key) ?? [];
    list.push(event);
    map.set(key, list);
    return map;
  }, new Map<string, CalendarEvent[]>());
  const chooseDecade = (value: number) => {
    setDecade(value);
    const first = [...historyYears].filter((year) => year >= value && year <= value + 9).sort((a, b) => b - a)[0];
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
    {monthGroups.size ? [...monthGroups.entries()].map(([monthKey, list]) => <div className="agenda-month-group" key={monthKey}><h3 className="agenda-month-title">{monthTitle(monthKey)}</h3>{list.map((event) => <AgendaItem key={event.id} snap={snap} events={usableEvents} event={event} collapsed={collapsed.has(calendarParentKey(event))} toggle={() => toggle(calendarParentKey(event))} openEvent={openEvent} />)}</div>) : <div className="card center muted">這個範圍沒有行程</div>}
  </section>;
}

function AgendaItem({ snap, events, event, collapsed, toggle, openEvent }: { snap: CalendarSnapshot; events: CalendarEvent[]; event: CalendarEvent; collapsed: boolean; toggle: () => void; openEvent: (id: string) => void }) {
  const children = sortCalendarEvents(events.filter((child) => child.parentEventId === calendarParentKey(event)));
  if (!children.length) return <section className="card agenda-item"><div className="agenda-date">{rangeText(event)}</div><EventRow snap={snap} event={event} onClick={() => openEvent(event.id)} /></section>;
  const groups = children.reduce((map, child) => {
    const list = map.get(child.startDate) ?? [];
    list.push(child);
    map.set(child.startDate, list);
    return map;
  }, new Map<string, CalendarEvent[]>());
  return <section className="card trip-card"><button className="trip-head" onClick={toggle} aria-expanded={!collapsed}><span className="event-color" style={{ background: groupOf(snap, event)?.color ?? '#1f6fd1' }} /><span><b>{event.title}</b><small>{rangeText(event)}・{dateDiffDays(event.startDate, event.endDate) + 1} 天</small></span><Icon name={collapsed ? 'right' : 'left'} className={collapsed ? '' : 'chevron-down'} size={18} /></button>{!collapsed && <div className="trip-days">{[...groups.entries()].map(([date, list]) => <div className="trip-day" key={date}><h3>第 {dateDiffDays(event.startDate, date) + 1} 天・{dateLabel(date)}</h3>{list.map((child) => <EventRow key={child.id} snap={snap} event={child} nested onClick={() => openEvent(child.id)} />)}</div>)}</div>}<button className="trip-open" onClick={() => openEvent(event.id)}>查看主行程</button></section>;
}

function localTimeAnalysis(date: string, time: string | null, zone: string | null) {
  if (!time || !zone || !date || !isValidTimeZone(zone)) return null;
  try { return analyzeCalendarLocalTime(date, time, zone); } catch { return null; }
}

const WEEK_OPTIONS = ['日', '一', '二', '三', '四', '五', '六'];
function initialRecurrence(frequency: CalendarRecurrence['frequency'], date: string): CalendarRecurrence {
  const [, , day] = date.split('-').map(Number);
  const weekDay = new Date(`${date}T00:00:00Z`).getUTCDay();
  const base = { frequency, interval: 1, end: 'never' as const };
  if (frequency === 'weekly') return { ...base, weekDays: [weekDay] };
  if (frequency === 'monthlyDate') return { ...base, monthDay: day };
  if (frequency === 'monthlyWeekday') return { ...base, weekOrdinal: Math.min(5, Math.ceil(day / 7)) as 1 | 2 | 3 | 4 | 5, weekDay };
  if (frequency === 'custom') return { ...base, interval: 2, customUnit: 'day' };
  return base;
}

function RecurrenceFields({ form, setForm, locked }: { form: CalendarEventInput; setForm: React.Dispatch<React.SetStateAction<CalendarEventInput>>; locked: boolean }) {
  const rule = form.recurrence ?? null;
  const setRule = (patch: Partial<CalendarRecurrence>) => setForm((current) => ({ ...current, recurrence: current.recurrence ? { ...current.recurrence, ...patch } : null }));
  const choose = (value: string) => setForm((current) => ({ ...current, parentEventId: value ? null : current.parentEventId, recurrence: value ? initialRecurrence(value as CalendarRecurrence['frequency'], current.startDate) : null }));
  return <div className="recurrence-fields"><label className="field">重複<select value={rule?.frequency ?? ''} disabled={locked} onChange={(event) => choose(event.target.value)}><option value="">不重複</option><option value="daily">每天</option><option value="workday">每個台灣工作日</option><option value="weekly">每週指定星期</option><option value="monthlyDate">每月指定日期</option><option value="monthlyWeekday">每月第幾個星期</option><option value="monthlyLastDay">每月最後一天</option><option value="yearly">每年</option><option value="custom">自訂間隔</option></select>{locked && <small className="field-help">主行程／細項不能同時使用重複規則。</small>}</label>{rule && <>{rule.frequency === 'weekly' && <fieldset className="weekday-choice"><legend>每週哪幾天</legend>{WEEK_OPTIONS.map((label, day) => { const active = rule.weekDays?.includes(day) ?? false; return <button type="button" className={active ? 'active' : ''} key={day} onClick={() => { const days = active ? rule.weekDays!.filter((item) => item !== day) : [...(rule.weekDays ?? []), day].sort(); if (days.length) setRule({ weekDays: days }); }}>{label}</button>; })}</fieldset>}{rule.frequency === 'monthlyDate' && <label className="field">每月日期<input type="number" min="1" max="31" value={rule.monthDay ?? 1} onChange={(event) => setRule({ monthDay: Number(event.target.value) })} /><small className="field-help">沒有這一天的月份會跳過。</small></label>}{rule.frequency === 'monthlyWeekday' && <div className="form-grid"><label className="field">第幾個<select value={rule.weekOrdinal ?? 1} onChange={(event) => setRule({ weekOrdinal: Number(event.target.value) as CalendarRecurrence['weekOrdinal'] })}><option value="1">第一個</option><option value="2">第二個</option><option value="3">第三個</option><option value="4">第四個</option><option value="5">第五個</option><option value="-1">最後一個</option></select></label><label className="field">星期<select value={rule.weekDay ?? 1} onChange={(event) => setRule({ weekDay: Number(event.target.value) })}>{WEEK_OPTIONS.map((label, day) => <option key={day} value={day}>星期{label}</option>)}</select></label></div>}{rule.frequency === 'custom' && <div className="form-grid"><label className="field">每隔<input type="number" min="1" max="999" value={rule.interval} onChange={(event) => setRule({ interval: Number(event.target.value) })} /></label><label className="field">單位<select value={rule.customUnit ?? 'day'} onChange={(event) => setRule({ customUnit: event.target.value as CalendarRecurrence['customUnit'] })}><option value="day">天</option><option value="week">週</option><option value="month">個月</option><option value="year">年</option></select></label></div>}<label className="field">結束方式<select value={rule.end} onChange={(event) => { const end = event.target.value as CalendarRecurrence['end']; setRule(end === 'date' ? { end, until: form.startDate, count: undefined } : end === 'count' ? { end, count: 10, until: undefined } : { end, until: undefined, count: undefined }); }}><option value="never">不設定結束日期</option><option value="date">到指定日期</option><option value="count">指定次數</option></select></label>{rule.end === 'date' && <label className="field">重複到<input type="date" min={form.startDate} value={rule.until ?? form.startDate} onChange={(event) => setRule({ until: event.target.value })} /></label>}{rule.end === 'count' && <label className="field">總共幾次<input type="number" min="1" max="10000" value={rule.count ?? 10} onChange={(event) => setRule({ count: Number(event.target.value) })} /></label>}<p className="recurrence-summary">{calendarRecurrenceText(rule)}・{calendarRecurrenceEndText(rule)}</p></>}</div>;
}

function EventForm({ snap, event, initialDate, parentId, busy, hideStartDate = false, onCancel, onSave, onAddPerson, onAddTag }: {
  snap: CalendarSnapshot;
  event: CalendarEvent | null;
  initialDate: string;
  parentId: string | null;
  busy: boolean;
  hideStartDate?: boolean;
  onCancel: () => void;
  onSave: (input: CalendarEventInput, event: CalendarEvent | null) => Promise<boolean>;
  onAddPerson: (nickname: string, fullName: string) => Promise<string | undefined>;
  onAddTag: (name: string) => Promise<string | undefined>;
}) {
  const initialParent = findCalendarParent(snap, parentId);
  const [form, setForm] = useState<CalendarEventInput>(() => event ? eventInput(event) : {
    title: '', groupId: initialParent?.groupId ?? snap.defaultGroupId, parentEventId: parentId, timeType: 'point', startDate: initialDate, startTime: '09:00', startTimeZone: snap.currentTimeZone, startUtcOffset: null, startDisambiguation: 'earlier', endDate: initialDate, endTime: null, endTimeZone: snap.currentTimeZone, endUtcOffset: null, endDisambiguation: 'earlier', timeMode: 'fixedZone', timeZoneInferred: false, locationType: null, startPlace: null, endPlace: null, url: null, note: null, status: 'scheduled', recurrence: null, recurrenceParentId: null, recurrenceInstanceKey: null, recurrenceExceptions: [],
  });
  const [more, setMore] = useState(!!event || !!form.startPlace || !!form.url || !!form.note || !!form.recurrence);
  const [parentError, setParentError] = useState<string | null>(null);
  const [timeError, setTimeError] = useState<string | null>(null);
  // （2026-11-20 使用者決定：主行程內新增時固定；月曆新增時可選，儲存前必須完整落在主行程日期內。）
  const parentLocked = !!event || !!parentId;
  const selectedParent = findCalendarParent(snap, form.parentEventId);
  const effectiveEndDate = form.timeType === 'point' ? form.startDate : form.endDate;
  const startAnalysis = form.timeType !== 'allDay' && form.timeMode === 'fixedZone' ? localTimeAnalysis(form.startDate, form.startTime, form.startTimeZone) : null;
  const endAnalysis = form.timeType === 'range' && form.timeMode === 'fixedZone' ? localTimeAnalysis(form.endDate, form.endTime, form.endTimeZone) : null;
  const parents = snap.events.filter((candidate) => {
    if (!canParentCalendarEvent(candidate) || candidate.id === event?.id || candidate.status !== 'scheduled') return false;
    if (candidate.id === form.parentEventId) return true;
    return dateInRange(form.startDate, candidate.startDate, candidate.endDate) || dateInRange(effectiveEndDate, candidate.startDate, candidate.endDate);
  });
  const set = <K extends keyof CalendarEventInput>(key: K, value: CalendarEventInput[K]) => setForm((current) => ({ ...current, [key]: value }));
  const setStartDate = (value: string) => setForm((current) => ({ ...current, startDate: value, endDate: current.timeType === 'point' ? value : current.endDate }));
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const dates = form.timeType === 'point' ? { endDate: form.startDate, endTime: null } : {};
    const input = {
      ...form, ...dates,
      peopleIds: form.peopleIds ?? selectedParent?.peopleIds ?? [],
      tagIds: form.tagIds ?? selectedParent?.tagIds ?? [],
    };
    if (startAnalysis?.kind === 'nonexistent' || endAnalysis?.kind === 'nonexistent') {
      setTimeError('選擇的當地時間因日光節約調整而不存在，請先使用下方建議時間或自行修改。');
      return;
    }
    const parent = findCalendarParent(snap, input.parentEventId);
    if (parent && (input.startDate < parent.startDate || input.endDate > parent.endDate)) {
      setParentError(`細項日期必須在主行程的 ${parent.startDate}～${parent.endDate} 之內`);
      return;
    }
    try {
      for (const rule of parseCalendarReminders(input.reminders)) {
        calendarReminderTime(input, rule, snap.homeTimeZone, snap.currentTimeZone);
      }
    } catch (error) {
      setTimeError(error instanceof Error ? `提醒：${error.message}` : '請檢查提醒設定');
      return;
    }
    setParentError(null);
    setTimeError(null);
    await onSave(input, event);
  };
  return <form className="card event-form" onSubmit={submit}>
    <div className="form-head"><button type="button" className="icon-btn" onClick={onCancel} aria-label="返回"><Icon name="left" /></button><h2>{event ? '編輯行程' : initialParent ? `新增「${initialParent.title}」細項` : '新增行程'}</h2></div>
    {parentLocked && selectedParent && <label className="field">所屬主行程<span className="parent-fixed">{selectedParent.title}<small>{rangeText(selectedParent)}</small></span></label>}
    {!parentLocked && <label className="field">所屬主行程<select value={form.parentEventId ?? ''} onChange={(e) => { setForm((current) => ({ ...current, parentEventId: e.target.value || null, recurrence: e.target.value ? null : current.recurrence })); setParentError(null); }}><option value="">不屬於主行程</option>{parents.map((parent) => <option key={parent.id} value={calendarParentKey(parent)}>{parent.title}（{parent.startDate}～{parent.endDate}）</option>)}</select><small className="field-help">只列出包含開始或結束日期的主行程</small></label>}
    {parentError && <p className="form-error">{parentError}</p>}
    <label className="field">標題<input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="可以先留空，會顯示未命名行程" /></label>
    <div className="type-choice">{([['range', '時段'], ['point', '時間點'], ['allDay', '全天']] as const).map(([value, label]) => <button type="button" key={value} className={form.timeType === value ? 'active' : ''} onClick={() => setForm((current) => ({ ...current, timeType: value, startTime: value === 'allDay' ? null : current.startTime ?? '09:00', endDate: value === 'point' ? current.startDate : current.endDate, endTime: value === 'range' ? current.endTime ?? '10:00' : null }))}>{label}</button>)}</div>
    {/* （2026-11-25 使用者決定：開始與結束各自成組，窄畫面將同組日期與時間上下排列。） */}
    <div className="event-date-time">
      <div className={`event-date-row ${form.timeType !== 'allDay' ? 'with-time' : ''}`}>
        {hideStartDate ? (
          <div className="field">
            開始日期
            <div className="selected-start-date">{slashDateLabel(form.startDate)}</div>
          </div>
        ) : (
          <label className="field">
            開始日期
            <input type="date" value={form.startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </label>
        )}
        {form.timeType !== 'allDay' && (
          <TimeField label="開始時間" value={form.startTime ?? ''} onChange={(value) => { set('startTime', value); set('startUtcOffset', null); }} />
        )}
      </div>
      {form.timeType !== 'point' && (
        <div className={`event-date-row ${form.timeType === 'range' ? 'with-time' : ''}`}>
          <label className="field">
            結束日期
            <input type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} required />
          </label>
          {form.timeType === 'range' && (
            <TimeField label="結束時間" value={form.endTime ?? ''} onChange={(value) => { set('endTime', value); set('endUtcOffset', null); }} />
          )}
        </div>
      )}
    </div>
    {form.timeType !== 'allDay' && <div className="timezone-form"><div className="type-choice time-mode-choice"><button type="button" className={form.timeMode === 'fixedZone' ? 'active' : ''} onClick={() => set('timeMode', 'fixedZone')}>固定所在地時間</button><button type="button" className={form.timeMode === 'floatingLocal' ? 'active' : ''} onClick={() => set('timeMode', 'floatingLocal')}>跟隨目前時間</button></div>{form.timeMode === 'floatingLocal' ? <p className="field-help">例如每天 09:00，不論人在台灣或日本都顯示當地 09:00；不做時區換算。</p> : <><TimeZoneSelect label={form.locationType === 'route' ? '出發時區' : '行程時區'} value={form.startTimeZone ?? snap.currentTimeZone} snap={snap} onChange={(zone) => setForm((current) => ({ ...current, startTimeZone: zone, endTimeZone: current.locationType === 'route' && current.timeType === 'range' ? current.endTimeZone : zone, startUtcOffset: null, endUtcOffset: current.locationType === 'route' && current.timeType === 'range' ? current.endUtcOffset : null, timeZoneInferred: false }))} />{form.locationType === 'route' && form.timeType === 'range' && <TimeZoneSelect label="抵達時區" value={form.endTimeZone ?? form.startTimeZone ?? snap.currentTimeZone} snap={snap} onChange={(zone) => setForm((current) => ({ ...current, endTimeZone: zone, endUtcOffset: null }))} />}{startAnalysis?.kind === 'ambiguous' && <label className="field dst-choice">開始時間出現兩次<select value={form.startDisambiguation ?? 'earlier'} onChange={(e) => set('startDisambiguation', e.target.value as 'earlier' | 'later')}><option value="earlier">第一次（UTC{startAnalysis.earlier.offset}）</option><option value="later">第二次（UTC{startAnalysis.later.offset}）</option></select></label>}{endAnalysis?.kind === 'ambiguous' && <label className="field dst-choice">結束時間出現兩次<select value={form.endDisambiguation ?? 'earlier'} onChange={(e) => set('endDisambiguation', e.target.value as 'earlier' | 'later')}><option value="earlier">第一次（UTC{endAnalysis.earlier.offset}）</option><option value="later">第二次（UTC{endAnalysis.later.offset}）</option></select></label>}{startAnalysis?.kind === 'nonexistent' && <div className="dst-warning"><p>這個開始時間在當地不存在。</p><button type="button" onClick={() => setForm((current) => ({ ...current, startDate: startAnalysis.later.date, startTime: startAnalysis.later.time, startUtcOffset: null }))}>改成 {startAnalysis.later.date} {startAnalysis.later.time}</button></div>}{endAnalysis?.kind === 'nonexistent' && <div className="dst-warning"><p>這個結束時間在當地不存在。</p><button type="button" onClick={() => setForm((current) => ({ ...current, endDate: endAnalysis.later.date, endTime: endAnalysis.later.time, endUtcOffset: null }))}>改成 {endAnalysis.later.date} {endAnalysis.later.time}</button></div>}</>}</div>}
    {timeError && <p className="form-error">{timeError}</p>}
    <label className="field">行事曆群組<select value={form.groupId} onChange={(e) => set('groupId', e.target.value)}>{snap.groups.filter((group) => !group.archived && group.kind === 'user').map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
    <button type="button" className="more-toggle" onClick={() => setMore(!more)}>{more ? '收起更多設定' : '更多設定'}</button>
    {more && <div className="more-fields"><RecurrenceFields form={form} setForm={setForm} locked={!!form.parentEventId} /><label className="field">地點類型<select value={form.locationType ?? ''} onChange={(e) => setForm((current) => ({ ...current, locationType: (e.target.value || null) as CalendarEventInput['locationType'], endTimeZone: e.target.value === 'route' ? current.endTimeZone ?? current.startTimeZone : current.startTimeZone, endUtcOffset: null }))}><option value="">不填</option><option value="place">一般地點</option><option value="route">起點與終點</option><option value="online">線上</option></select></label>{form.locationType && form.locationType !== 'online' && <label className="field">{form.locationType === 'route' ? '起點' : '地點'}<input value={form.startPlace ?? ''} onChange={(e) => set('startPlace', e.target.value || null)} /></label>}{form.locationType === 'route' && <label className="field">終點<input value={form.endPlace ?? ''} onChange={(e) => set('endPlace', e.target.value || null)} /></label>}{form.locationType === 'online' && <label className="field">網址<input type="url" value={form.url ?? ''} onChange={(e) => set('url', e.target.value || null)} placeholder="https://" /></label>}<label className="field">備註<textarea value={form.note ?? ''} onChange={(e) => set('note', e.target.value || null)} rows={4} /></label></div>}
    <PeopleFields
      people={snap.people}
      selected={form.peopleIds ?? selectedParent?.peopleIds ?? []}
      onChange={(ids) => set('peopleIds', ids)}
      onAdd={onAddPerson}
      busy={busy}
    />
    <TagPicker tags={snap.sharedTags} selected={form.tagIds ?? selectedParent?.tagIds ?? []} busy={busy} onChange={(ids) => set('tagIds', ids)} onAdd={onAddTag} />
    <ReminderFields rules={form.reminders ?? []} allDay={form.timeType === 'allDay'} startDate={form.startDate} startTime={form.startTime} onChange={(rules) => set('reminders', rules)} />
    <label className="calendar-bujo-option"><input type="checkbox" checked={form.bujoEnabled ?? false}
      onChange={(e) => set('bujoEnabled', e.target.checked)} /> 同時加入子彈筆記待辦</label>
    <div className="form-actions"><button type="button" onClick={onCancel}>取消</button><button className="primary" disabled={busy}>儲存</button></div>
  </form>;
}

function EventReminderDetails({ event }: { event: CalendarEvent }) {
  if (!event.reminders?.length) return null;
  return <div className="timezone-detail">
    <b>提醒</b>
    {event.reminders.map((rule, index) => <p key={index}>{calendarReminderLabel(rule, event.startDate)}</p>)}
  </div>;
}

function EventPeople({ event, snap }: { event: CalendarEvent; snap: CalendarSnapshot }) {
  if (!event.peopleIds?.length) return null;
  return <div className="note-block">
    <b>相關人物</b>
    <ul className="selected-people">
      {event.peopleIds.map((id) => <li key={id}>{personLabel(snap.people.find((person) => person.id === id))}</li>)}
    </ul>
  </div>;
}

function EventTags({ event, snap }: { event: CalendarEvent; snap: CalendarSnapshot }) {
  if (!event.tagIds?.length) return null;
  return <div className="note-block">
    <b>共用標籤</b>
    <ul className="shared-tag-chips">{event.tagIds.map((id) => <li key={id}>{tagLabel(snap.sharedTags, id)}</li>)}</ul>
  </div>;
}

function EventTimeZoneDetails({ snap, event }: { snap: CalendarSnapshot; event: CalendarEvent }) {
  if (event.timeType === 'allDay') return null;
  if (event.timeMode === 'floatingLocal') return <div className="timezone-detail"><b>時間方式：</b>跟隨目前所在地時間（不換算時區）</div>;
  try {
    const start = eventResolvedTime(event)!;
    const end = event.timeType === 'range' ? eventResolvedTime(event, true)! : null;
    const currentStart = event.startTimeZone !== snap.currentTimeZone ? convertCalendarInstant(start.epochMilliseconds, snap.currentTimeZone) : null;
    const currentEnd = end && event.endTimeZone !== snap.currentTimeZone ? convertCalendarInstant(end.epochMilliseconds, snap.currentTimeZone) : null;
    const duration = end ? calendarDurationMinutes(start.epochMilliseconds, end.epochMilliseconds) : null;
    const durationText = duration == null ? null : `${Math.floor(duration / 60)} 小時 ${Math.abs(duration % 60)} 分`;
    return <div className="timezone-detail"><p><b>{event.locationType === 'route' ? '出發時區' : '行程時區'}：</b>{timeZoneLabel(event.startTimeZone!, start.epochMilliseconds)}{event.timeZoneInferred && '（由主要時區推定）'}</p>{event.locationType === 'route' && end && <p><b>抵達時區：</b>{timeZoneLabel(event.endTimeZone!, end.epochMilliseconds)}</p>}{durationText && <p><b>實際經過時間：</b>{durationText}</p>}{currentStart && <p><b>開始換算目前所在地：</b>{formatConvertedCalendarTime(currentStart)}</p>}{currentEnd && <p><b>結束換算目前所在地：</b>{formatConvertedCalendarTime(currentEnd)}</p>}</div>;
  } catch {
    return <p className="form-error">這筆行程的時區資料需要修正。</p>;
  }
}

function EventDetail({ api, snap, event, onBack, onEdit, onOpen, onAddChild, onJoinExisting, onMoveChild, onRecurrenceAction }: { api: CalendarApi; snap: CalendarSnapshot; event: CalendarEvent; onBack: () => void; onEdit: () => void; onOpen: (id: string) => void; onAddChild: () => void; onJoinExisting: () => void; onMoveChild: () => void; onRecurrenceAction: (action: 'cancel' | 'restore' | 'delete') => void }) {
  const [cancel, setCancel] = useState(false);
  const children = sortCalendarEvents(snap.events.filter((e) => e.parentEventId === calendarParentKey(event)));
  const childDays = children.reduce((map, child) => {
    const list = map.get(child.startDate) ?? [];
    list.push(child);
    map.set(child.startDate, list);
    return map;
  }, new Map<string, CalendarEvent[]>());
  const parent = findCalendarParent(snap, event.parentEventId);
  const canHaveChildren = canParentCalendarEvent(event);
  const remove = async () => {
    if (event.recurrence) return onRecurrenceAction('delete');
    if (!window.confirm(`確定刪除「${event.title}」？`)) return;
    const ok = await api.run((s) => s.deleteEvent(event).then(() => true));
    if (ok) onBack();
  };
  return <section className={`card detail ${event.status === 'cancelled' ? 'cancelled' : ''}`}><div className="detail-head"><button className="icon-btn" onClick={onBack} aria-label="返回"><Icon name="left" /></button>{!event.systemSource && <button onClick={onEdit}><Icon name="pencil" size={17} /> 編輯</button>}</div>{event.status === 'cancelled' && <div className="cancel-badge">已取消</div>}<h2>{event.title}</h2><p className="detail-time">{rangeText(event)}・{timeText(event)}</p><EventTimeZoneDetails snap={snap} event={event} /><EventReminderDetails event={event} /><EventPeople event={event} snap={snap} /><EventTags event={event} snap={snap} /><p className="muted small">{groupOf(snap, event)?.name}{event.systemSource && '・系統資料'}</p>{event.recurrence && <div className="recurrence-detail"><b>{calendarRecurrenceText(event.recurrence)}</b><span>{calendarRecurrenceEndText(event.recurrence)}</span>{event.recurrenceOverride && <span>這一次有個別修改</span>}</div>}{parent && <button className="parent-link" onClick={() => onOpen(parent.id)}>主行程：{parent.title}<Icon name="right" size={16} /></button>}{event.startPlace && <p><b>{event.locationType === 'route' ? '路線' : '地點'}：</b>{event.startPlace}{event.endPlace ? ` → ${event.endPlace}` : ''}</p>}{event.url && <p><b>網址：</b><a href={event.url} target="_blank" rel="noreferrer">{event.url}</a></p>}{event.note && <div className="note-block"><b>備註</b><p>{event.note}</p></div>}{(canHaveChildren || children.length > 0) && <div className="itinerary"><div className="section-head"><h3>行程安排</h3>{event.status !== 'cancelled' && <span className="itinerary-buttons"><button className="link" onClick={onAddChild}><Icon name="plus" size={16} /> 新增細項</button><button className="link" onClick={onJoinExisting}>加入既有行程</button></span>}</div>{children.length ? <div className="itinerary-days">{[...childDays.entries()].map(([date, list]) => <div className="itinerary-day" key={date}><h4>第 {dateDiffDays(event.startDate, date) + 1} 天・{dateLabel(date)}</h4>{list.map((child) => <EventRow key={child.id} snap={snap} event={child} nested onClick={() => onOpen(child.id)} />)}</div>)}</div> : <p className="muted small">還沒有細項，可以新增或加入既有行程。</p>}</div>}{!event.systemSource && <div className="detail-actions">{event.status === 'cancelled' ? <button onClick={() => event.recurrence ? onRecurrenceAction('restore') : api.run((s) => s.restoreEvent(event)).then(() => undefined)}>恢復行程</button> : <button className="danger" onClick={() => event.recurrence ? onRecurrenceAction('cancel') : setCancel(true)}>取消行程</button>}{event.parentEventId && <><button onClick={onMoveChild}>移到其他主行程</button><button onClick={() => api.run((s) => s.detachEvent(event))}>移出主行程</button></>}<button className="danger" disabled={children.length > 0} onClick={remove}>刪除</button></div>}{children.length > 0 && <p className="muted small">主行程仍有細項時不能刪除，請先將細項移出。</p>}{cancel && <div className="choice-panel"><b>要取消哪個範圍？</b>{children.length ? <><button className="danger" onClick={() => api.run((s) => s.cancelEvent(event, true)).then(() => setCancel(false))}>取消整趟（包含所有細項）</button><button onClick={() => api.run((s) => s.cancelEvent(event, false)).then(() => setCancel(false))}>只取消主行程，細項移出</button></> : <button className="danger" onClick={() => api.run((s) => s.cancelEvent(event, false)).then(() => setCancel(false))}>確認取消</button>}<button onClick={() => setCancel(false)}>返回</button></div>}</section>;
}

function RecurrenceScopeView({ api, data, onCancel, onDone }: { api: CalendarApi; data: Extract<Open, { kind: 'recurrence-scope' }>; onCancel: () => void; onDone: (date: string) => void }) {
  const labels = data.action === 'edit' ? { title: '要修改哪些行程？', verb: '修改' } : data.action === 'cancel' ? { title: '要取消哪些行程？', verb: '取消' } : data.action === 'restore' ? { title: '要恢復哪些行程？', verb: '恢復' } : { title: '要刪除哪些行程？', verb: '刪除' };
  const apply = async (scope: CalendarRecurrenceScope) => {
    const ok = await api.run(async (store) => {
      if (data.action === 'edit') await store.updateRecurringEvent(data.event, data.input!, scope);
      else if (data.action === 'delete') await store.deleteRecurringEvent(data.event, scope);
      else await store.setRecurringEventStatus(data.event, data.action === 'cancel' ? 'cancelled' : 'scheduled', scope);
      return true;
    });
    if (ok) onDone(data.input?.startDate ?? data.event.startDate);
  };
  return <section className="card recurrence-scope"><div className="form-head"><button className="icon-btn" onClick={onCancel} aria-label="返回"><Icon name="left" /></button><div><h2>{labels.title}</h2><p className="muted small">{data.event.title}・{slashDateLabel(data.event.startDate)}</p></div></div><p>預設只處理目前選到的這一次。</p><div className="scope-options"><button className="primary" disabled={api.busy} onClick={() => apply('single')}>只{labels.verb}這一次</button><button disabled={api.busy} onClick={() => apply('future')}>{labels.verb}這一次和之後</button><button disabled={api.busy} onClick={() => apply('all')}>{labels.verb}全部重複行程</button></div>{data.action === 'delete' && <p className="muted small">刪除後仍保留資料，不提供永久刪除。</p>}</section>;
}

function JoinTripView({ api, snap, parent, onCancel, onDone }: { api: CalendarApi; snap: CalendarSnapshot; parent: CalendarEvent; onCancel: () => void; onDone: () => void }) {
  const [query, setQuery] = useState('');
  const [showOtherDates, setShowOtherDates] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const [selected, setSelected] = useState<Record<string, { startDate: string; endDate: string }>>({});
  const childParents = new Set(snap.events.filter((item) => item.parentEventId).map((item) => item.parentEventId));
  const overlaps = (item: CalendarEvent) => item.startDate <= parent.endDate && item.endDate >= parent.startDate;
  const candidates = sortCalendarEvents(snap.events.filter((item) => !item.recurrence && !item.isRecurrenceInstance && !item.parentEventId && item.id !== parent.id && !item.systemSource && !childParents.has(item.id) && (showCancelled || item.status !== 'cancelled') && (showOtherDates || overlaps(item)) && (!query.trim() || item.title.includes(query.trim()))));
  const grouped = candidates.reduce((map, item) => { const list = map.get(item.startDate) ?? []; list.push(item); map.set(item.startDate, list); return map; }, new Map<string, CalendarEvent[]>());
  const toggle = (item: CalendarEvent) => setSelected((old) => { const next = { ...old }; if (next[item.id]) delete next[item.id]; else next[item.id] = { startDate: item.startDate, endDate: item.endDate }; return next; });
  const setDateValue = (id: string, key: 'startDate' | 'endDate', value: string) => setSelected((old) => ({ ...old, [id]: { ...old[id], [key]: value } }));
  const save = async () => {
    const actions: TripAttachAction[] = Object.entries(selected).map(([id, dates]) => ({ event: snap.events.find((item) => item.id === id)!, ...dates }));
    const ok = await api.run((store) => store.attachEventsToTrip(parent, actions).then(() => true));
    if (ok) onDone();
  };
  return <section className="card chooser"><div className="form-head"><button className="icon-btn" onClick={onCancel} aria-label="返回"><Icon name="left" /></button><div><h2>加入既有行程</h2><p className="muted small">{parent.title}・{parent.startDate}～{parent.endDate}</p></div></div><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋行程標題" aria-label="搜尋行程標題" /><div className="chooser-options"><label><input type="checkbox" checked={showOtherDates} onChange={(e) => setShowOtherDates(e.target.checked)} /> 顯示其他日期</label><label><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> 顯示已取消</label></div>{grouped.size ? [...grouped.entries()].map(([date, list]) => <div className="chooser-day" key={date}><h3>{dateLabel(date, true)}</h3>{list.map((item) => { const dates = selected[item.id]; const outside = dates && (dates.startDate < parent.startDate || (item.timeType === 'point' ? dates.startDate : dates.endDate) > parent.endDate); return <div className={`chooser-item ${item.status === 'cancelled' ? 'cancelled' : ''}`} key={item.id}><label><input type="checkbox" checked={!!dates} onChange={() => toggle(item)} /><span><b>{item.title}</b><small>{rangeText(item)}・{timeText(item)}{item.status === 'cancelled' ? '・已取消' : ''}</small></span></label>{dates && outside && <div className="join-date-fix"><p>日期超出主行程，請先調整才能加入。</p><div className="row"><input type="date" value={dates.startDate} onChange={(e) => setDateValue(item.id, 'startDate', e.target.value)} /><span>～</span>{item.timeType === 'point' ? <span>{dates.startDate}</span> : <input type="date" value={dates.endDate} onChange={(e) => setDateValue(item.id, 'endDate', e.target.value)} />}</div></div>}</div>; })}</div>) : <p className="muted center">沒有符合的既有行程</p>}<div className="form-actions"><button onClick={onCancel}>取消</button><button className="primary" disabled={!Object.keys(selected).length || api.busy} onClick={save}>加入 {Object.keys(selected).length} 筆</button></div></section>;
}

function MoveChildView({ api, snap, event, onCancel, onDone }: { api: CalendarApi; snap: CalendarSnapshot; event: CalendarEvent; onCancel: () => void; onDone: () => void }) {
  const [parentId, setParentId] = useState('');
  const parents = expandCalendarEvents(snap, event.startDate, event.endDate).filter((item) => canParentCalendarEvent(item) && item.id !== event.id && calendarParentKey(item) !== event.parentEventId && item.status === 'scheduled' && event.startDate >= item.startDate && event.endDate <= item.endDate);
  const save = async () => { const ok = await api.run((store) => store.moveEventToTrip(event, parentId).then(() => true)); if (ok) onDone(); };
  return <section className="card chooser"><div className="form-head"><button className="icon-btn" onClick={onCancel} aria-label="返回"><Icon name="left" /></button><h2>移到其他主行程</h2></div><p><b>{event.title}</b></p><p className="muted small">只列出完整包含細項日期（{event.startDate}～{event.endDate}）的主行程；移動後不會改變日期或其他內容。</p><label className="field">新的主行程<select value={parentId} onChange={(e) => setParentId(e.target.value)}><option value="">請選擇</option>{parents.map((item) => <option key={item.id} value={calendarParentKey(item)}>{item.title}（{item.startDate}～{item.endDate}）</option>)}</select></label>{!parents.length && <p className="form-error">目前沒有日期符合的其他主行程。</p>}<div className="form-actions"><button onClick={onCancel}>取消</button><button className="primary" disabled={!parentId || api.busy} onClick={save}>確認移動</button></div></section>;
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
  const save = async () => { const ok = await api.run((s) => s.updateGroup(group, group.kind === 'system' ? { color } : { name, color }).then(() => true)); if (ok) setEdit(false); };
  return <div className={`group-row ${group.archived ? 'archived' : ''}`}>{edit ? <><input type="color" value={color} onChange={(e) => setColor(e.target.value)} />{group.kind === 'user' && <input value={name} onChange={(e) => setName(e.target.value)} />}<button className="primary" onClick={save}>儲存</button><button onClick={() => setEdit(false)}>取消</button></> : <><span className="group-dot" style={{ background: group.color }} /><span className="group-name"><b>{group.name}</b>{group.kind === 'system' && <small>系統</small>}{snap.defaultGroupId === group.id && <small>預設</small>}{group.archived && <small>已停用</small>}</span>{!group.archived && <><label className="switch"><input type="checkbox" checked={!group.hidden} onChange={() => api.run((s) => s.updateGroup(group, { hidden: !group.hidden }))} />顯示</label><button className="icon-small" disabled={first} onClick={() => move(group, -1)} aria-label="往前">↑</button><button className="icon-small" disabled={last} onClick={() => move(group, 1)} aria-label="往後">↓</button>{group.kind === 'user' && <button onClick={() => api.run((s) => s.setDefaultGroup(group.id))} disabled={snap.defaultGroupId === group.id}>設為預設</button>}<button onClick={() => setEdit(true)}>{group.kind === 'system' ? '改顏色' : '編輯'}</button>{group.kind === 'user' && <button className="danger" onClick={() => api.run((s) => s.updateGroup(group, { archived: true, hidden: true }))}>停用</button>}</>}{group.archived && <button onClick={() => api.run((s) => s.updateGroup(group, { archived: false, hidden: false }))}>恢復</button>}</>}</div>;
}
