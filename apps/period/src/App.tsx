import { useState } from 'react';
import { Icon } from '@life/ui/icon';
import { AppSwitcher } from '@life/ui/app-switcher';
import { AppTabs, type AppTabItem } from '@life/ui/app-tabs';
import { todayKey } from '@life/db';
import { usePeriod } from './usePeriod';
import { TodayView } from './components/TodayView';
import { CalendarView } from './components/CalendarView';
import { StatsView } from './components/StatsView';
import { SettingsView, type PeriodSettingSection } from './components/SettingsView';
import { MoreMenu, type PeriodMoreKey } from './components/MoreMenu';

const HOME_URL = import.meta.env.DEV ? `http://${location.hostname}:5172/` : '../';
type MainTab = 'add' | 'calendar' | 'stats' | 'more';
type Tab = MainTab | 'settings';
const TABS: AppTabItem<MainTab>[] = [
  { key: 'add', icon: 'plus', label: '新增' },
  { key: 'calendar', icon: 'calendar', label: '日曆' },
  { key: 'stats', icon: 'chart', label: '統計' },
  { key: 'more', icon: 'more', label: '更多' },
];
const tabOf = (tab: Tab): MainTab => tab === 'settings' ? 'more' : tab;

function requestedDate() {
  const value = new URLSearchParams(location.search).get('date');
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayKey();
}

export function App() {
  const api = usePeriod();
  const [tab, setTab] = useState<Tab>('calendar');
  const [date, setDate] = useState(requestedDate);
  const [addDirty, setAddDirty] = useState(false);
  const [settingSection, setSettingSection] = useState<PeriodSettingSection>('cycle');

  const changeTab = (next: MainTab) => {
    // （2026-11-22 使用者決定：新增頁有未儲存內容時，離開前先提醒。）
    if (tab === 'add' && addDirty && next !== 'add' && !confirm('這天的紀錄尚未儲存，確定要離開嗎？')) return;
    if (next !== 'add') setAddDirty(false);
    setTab(next);
    window.scrollTo(0, 0);
  };
  const editDate = (value: string) => {
    setDate(value);
    setTab('add');
    window.scrollTo(0, 0);
  };
  const openMore = (key: PeriodMoreKey) => {
    setSettingSection(key);
    setTab('settings');
    window.scrollTo(0, 0);
  };

  return <div className="app period-app">
    <header className="topbar">
      <AppSwitcher current="period" homeUrl={HOME_URL} date={date} confirmLeave={tab === 'add' && addDirty} />
      <h1>生理期</h1>
      <AppTabs items={TABS} current={tabOf(tab)} onChange={changeTab} placement="top" />
      {api.status === 'ready' && <button className="icon-btn" disabled={api.busy} onClick={api.refresh} aria-label="重新整理"><span className={api.busy ? 'spin' : ''}><Icon name="refresh" /></span></button>}
    </header>
    {api.mode === 'local' && <div className="mode-banner">本機測試模式：資料只存在這個瀏覽器，還沒接上 Google 試算表</div>}
    <main>
      {api.status === 'starting' || (api.status === 'loading' && !api.snap) ? <div className="center muted">讀取中⋯⋯</div>
        : api.status === 'need-connect' ? <div className="center connect"><p>資料存在你的 Google 試算表，需要先連線。</p><button className="primary big" onClick={api.connect}>連線 Google</button>{api.error && <p className="error-text">{api.error}</p>}<p className="muted small">會建立「生活APP-生理期」，並在「生活APP-健康」加入共用身體狀況表。</p></div>
        : api.status === 'error' ? <div className="center"><p className="error-text">{api.error}</p><button className="primary" onClick={() => location.reload()}>重新載入</button></div>
        : api.snap && api.conditions ? <>
          {tab === 'add' && <TodayView api={api} snap={api.snap} conditions={api.conditions} date={date} setDate={setDate} goSettings={() => openMore('cycle')} onDirtyChange={setAddDirty} onDone={() => { setAddDirty(false); setTab('calendar'); window.scrollTo(0, 0); }} />}
          {tab === 'calendar' && <CalendarView snap={api.snap} selected={date} setDate={setDate} conditions={api.conditions} editDate={editDate} />}
          {tab === 'stats' && <StatsView api={api} snap={api.snap} openDate={(value) => { setDate(value); setTab('calendar'); }} />}
          {tab === 'more' && <MoreMenu issues={api.snap.issues.length + api.conditions.issues.length} open={openMore} />}
          {tab === 'settings' && <SettingsView api={api} snap={api.snap} conditions={api.conditions} section={settingSection} onBack={() => setTab('more')} />}
        </> : null}
    </main>
    <AppTabs items={TABS} current={tabOf(tab)} onChange={changeTab} placement="bottom" />
    {api.toast && <div className={`toast ${api.toast.kind}`}><span>{api.toast.text}</span><button className="toast-close" onClick={api.dismissToast}>✕</button></div>}
  </div>;
}
