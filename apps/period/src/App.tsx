import { useState } from 'react';
import { Icon, type IconName } from '@life/ui/icon';
import { todayKey } from '@life/db';
import { usePeriod } from './usePeriod';
import { TodayView } from './components/TodayView';
import { CalendarView } from './components/CalendarView';
import { StatsView } from './components/StatsView';
import { SettingsView } from './components/SettingsView';

const HOME_URL = import.meta.env.DEV ? `http://${location.hostname}:5172/` : '../';
export type Tab = 'today' | 'calendar' | 'stats' | 'settings';
const TABS: { key: Tab; icon: IconName; label: string }[] = [
  { key: 'today', icon: 'clipboard', label: '今天' },
  { key: 'calendar', icon: 'calendar', label: '月曆' },
  { key: 'stats', icon: 'chart', label: '統計' },
  { key: 'settings', icon: 'settings', label: '設定' },
];

function requestedDate() {
  const value = new URLSearchParams(location.search).get('date');
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayKey();
}

export function App() {
  const api = usePeriod();
  const [tab, setTab] = useState<Tab>('today');
  const [date, setDate] = useState(requestedDate);
  const [editRequest, setEditRequest] = useState<number | null>(null);
  const openDate = (d: string) => {
    setEditRequest(null);
    setDate(d);
    setTab('today');
    window.scrollTo(0, 0);
  };
  const editDate = (d: string) => {
    // （2026-11-22 使用者決定：月曆先看唯讀內容，只有按編輯才切到今天並直接開啟編輯。）
    setDate(d);
    setEditRequest(Date.now());
    setTab('today');
    window.scrollTo(0, 0);
  };
  return (
    <div className="app period-app">
      <header className="topbar">
        <a className="icon-btn home-link" href={HOME_URL + location.search} title="回首頁" aria-label="回首頁"><Icon name="home" /></a>
        <h1>生理期</h1>
        <nav className="tabs-top">
          {TABS.map((t) => <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}><Icon name={t.icon} size={20} /> {t.label}</button>)}
        </nav>
        {api.status === 'ready' && <button className="icon-btn" disabled={api.busy} onClick={api.refresh} aria-label="重新整理"><span className={api.busy ? 'spin' : ''}><Icon name="refresh" /></span></button>}
      </header>
      {api.mode === 'local' && <div className="mode-banner">本機測試模式：資料只存在這個瀏覽器，還沒接上 Google 試算表</div>}
      <main>
        {api.status === 'starting' || (api.status === 'loading' && !api.snap) ? <div className="center muted">讀取中⋯⋯</div>
          : api.status === 'need-connect' ? <div className="center connect"><p>資料存在你的 Google 試算表，需要先連線。</p><button className="primary big" onClick={api.connect}>連線 Google</button>{api.error && <p className="error-text">{api.error}</p>}<p className="muted small">會建立「生活APP-生理期」，並在「生活APP-健康」加入共用身體狀況表。</p></div>
          : api.status === 'error' ? <div className="center"><p className="error-text">{api.error}</p><button className="primary" onClick={() => location.reload()}>重新載入</button></div>
          : api.snap && api.conditions ? <>
              {tab === 'today' && <TodayView api={api} snap={api.snap} conditions={api.conditions} date={date} setDate={setDate} goSettings={() => setTab('settings')} editRequest={editRequest} onEditRequestHandled={() => setEditRequest(null)} />}
              {tab === 'calendar' && <CalendarView snap={api.snap} conditions={api.conditions} editDate={editDate} />}
              {tab === 'stats' && <StatsView api={api} snap={api.snap} openDate={openDate} />}
              {tab === 'settings' && <SettingsView api={api} snap={api.snap} conditions={api.conditions} />}
            </> : null}
      </main>
      <nav className="tabs-bottom">
        {TABS.map((t) => <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}><span className="tab-icon"><Icon name={t.icon} /></span>{t.label}</button>)}
      </nav>
      {api.toast && <div className={`toast ${api.toast.kind}`}><span>{api.toast.text}</span><button className="toast-close" onClick={api.dismissToast}>✕</button></div>}
    </div>
  );
}
