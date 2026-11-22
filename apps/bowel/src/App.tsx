import { useEffect, useState } from 'react';
import { Icon } from '@life/ui/icon';
import { AppTabs, type AppTabItem } from '@life/ui/app-tabs';
import { parseEditHash, todayKey } from '@life/db';
import { useBowel } from './useBowel';
import { AddView, startLog } from './components/AddView';
import { CalendarView } from './components/CalendarView';
import { StatsView } from './components/StatsView';
import { SettingsView } from './components/SettingsView';
import { IssuesView } from './components/IssuesView';
import { MoreView, type MoreSection } from './components/MoreView';
import { AppSwitcher } from '@life/ui/app-switcher';

const HOME_URL = import.meta.env.DEV ? `http://${location.hostname}:5172/` : '../';
type MainTab = 'add' | 'calendar' | 'stats' | 'more';
export type Tab = MainTab | 'settings' | 'issues';

/** 2026-11-22 使用者決定：廁所大事使用新增、日曆、統計、更多四個分頁。 */
const TABS: AppTabItem<MainTab>[] = [
  { key: 'add', icon: 'plus', label: '新增' },
  { key: 'calendar', icon: 'calendar', label: '日曆' },
  { key: 'stats', icon: 'chart', label: '統計' },
  { key: 'more', icon: 'more', label: '更多' },
];

const goHome = () => { location.href = HOME_URL + location.search; };
type Pending = { kind: 'new' } | { kind: 'edit'; id: string } | null;
function pendingFromHash(): Pending {
  if (location.hash === '#new') return { kind: 'new' };
  const edit = parseEditHash(location.hash);
  return edit?.kind === 'bowel' ? { kind: 'edit', id: edit.id } : null;
}
function requestedDate() {
  const value = new URLSearchParams(location.search).get('date');
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= todayKey() ? value : todayKey();
}

export function App() {
  const api = useBowel();
  const initialPending = pendingFromHash();
  const [tab, setTabState] = useState<Tab>(initialPending ? 'add' : 'calendar');
  const [date, setDate] = useState(requestedDate);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(initialPending);
  const [fromHome, setFromHome] = useState(false);
  const [moreSection, setMoreSection] = useState<'settings' | 'data'>('settings');

  const setTab = (value: Tab) => {
    if (value !== 'add') setOpenId(null);
    setFromHome(false);
    setTabState(value);
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    if (!pending || !api.snap) return;
    setPending(null);
    history.replaceState(null, '', location.pathname + location.search);
    setFromHome(true);
    setTabState('add');
    if (pending.kind === 'new') {
      const selected = requestedDate();
      setDate(selected);
      startLog(api, selected, setOpenId);
      return;
    }
    const log = api.snap.logs.find((entry) => entry.id === pending.id);
    if (!log) return api.showToast({ kind: 'error', text: '找不到這一筆（可能已經刪除）' });
    setDate(log.date);
    setOpenId(log.id);
  }, [pending, api.snap, api]);

  const openMore = (section: MoreSection) => {
    if (section === 'issues') return setTab('issues');
    setMoreSection(section);
    setTab('settings');
  };
  const active: MainTab = tab === 'settings' || tab === 'issues' ? 'more' : tab;

  return (
    <div className="app">
      <header className="topbar">
        <AppSwitcher current="bowel" homeUrl={HOME_URL} date={date} confirmLeave={tab === 'add' && openId !== null} />
        <h1>廁所大事</h1>
        <AppTabs items={TABS} current={active} onChange={setTab} placement="top" />
        {api.status === 'ready' && <button className="icon-btn" onClick={api.refresh} disabled={api.busy} title="重新整理（讀取試算表最新資料）" aria-label="重新整理"><span className={api.busy ? 'spin' : ''}><Icon name="refresh" /></span></button>}
      </header>
      {api.mode === 'local' && <div className="mode-banner">本機測試模式：資料只存在這個瀏覽器，還沒接上 Google 試算表</div>}
      <main>
        {api.status === 'starting' || (api.status === 'loading' && !api.snap) ? <div className="center muted">讀取中⋯</div>
        : api.status === 'need-connect' ? <div className="center connect"><p>資料存在你的 Google 試算表，需要先連線。</p><button className="primary big" onClick={api.connect}>連線 Google</button>{api.error && <p className="error-text">{api.error}</p>}</div>
        : api.status === 'error' ? <div className="center"><p className="error-text">{api.error}</p><button className="primary" onClick={() => location.reload()}>重新載入</button></div>
        : api.snap ? <>
          {tab === 'add' && <AddView api={api} snap={api.snap} date={date} setDate={setDate} openId={openId} setOpenId={setOpenId} onDone={() => fromHome ? goHome() : setTab('calendar')} />}
          {tab === 'calendar' && <CalendarView api={api} snap={api.snap} date={date} setDate={setDate} onAdd={() => setTab('add')} onEdit={(log) => { setDate(log.date); setOpenId(log.id); setFromHome(false); setTabState('add'); }} onIssues={() => setTab('issues')} />}
          {tab === 'stats' && <StatsView snap={api.snap} />}
          {tab === 'more' && <MoreView issueCount={api.snap.issues.length} open={openMore} />}
          {tab === 'settings' && <SettingsView key={`${api.snap.loadedAt}-${moreSection}`} api={api} snap={api.snap} section={moreSection} onBack={() => setTab('more')} />}
          {tab === 'issues' && <IssuesView api={api} snap={api.snap} onDone={() => setTab('more')} />}
        </> : null}
      </main>
      <AppTabs items={TABS} current={active} onChange={setTab} placement="bottom" />
      {api.toast && <div className={`toast ${api.toast.kind}`} key={api.toast.id}><span>{api.toast.text}</span><button className="toast-close" onClick={api.dismissToast} aria-label="關閉">✕</button></div>}
    </div>
  );
}
