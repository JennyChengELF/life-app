import { useState } from 'react';
import { todayKey } from '@life/db';
import { useWater } from './useWater';
import { TodayView } from './components/TodayView';
import { StatsView } from './components/StatsView';
import { SettingsView } from './components/SettingsView';
import { IssuesView } from './components/IssuesView';

export type Tab = 'today' | 'stats' | 'settings' | 'issues';

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: 'today', icon: '💧', label: '今天' },
  { key: 'stats', icon: '📊', label: '統計' },
  { key: 'settings', icon: '⚙️', label: '設定' },
];

export function App() {
  const api = useWater();
  const [tab, setTab] = useState<Tab>('today');
  const [date, setDate] = useState(todayKey());

  return (
    <div className="app">
      <header className="topbar">
        <h1>💧 喝水</h1>
        <nav className="tabs-top">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
              {t.icon} {t.label}
            </button>
          ))}
        </nav>
        {api.status === 'ready' && (
          <button className="icon-btn" onClick={api.refresh} disabled={api.busy} title="重新整理（讀取試算表最新資料）">
            <span className={api.busy ? 'spin' : ''}>⟳</span>
          </button>
        )}
      </header>

      {api.mode === 'local' && (
        <div className="mode-banner">本機測試模式：資料只存在這個瀏覽器，還沒接上 Google 試算表</div>
      )}

      <main>
        {api.status === 'starting' || (api.status === 'loading' && !api.snap) ? (
          <div className="center muted">讀取中⋯⋯</div>
        ) : api.status === 'need-connect' ? (
          <div className="center connect">
            <p>資料存在你的 Google 試算表，需要先連線。</p>
            <button className="primary big" onClick={api.connect}>
              連線 Google
            </button>
            {api.error && <p className="error-text">{api.error}</p>}
            <p className="muted small">第一次會建立「生活APP-喝水」「生活APP-健康」兩個試算表；APP 只能存取它自己建立的檔案。</p>
          </div>
        ) : api.status === 'error' ? (
          <div className="center">
            <p className="error-text">{api.error}</p>
            <button className="primary" onClick={() => location.reload()}>
              重新載入
            </button>
          </div>
        ) : api.snap ? (
          <>
            {tab === 'today' && <TodayView api={api} snap={api.snap} date={date} setDate={setDate} goTo={setTab} />}
            {tab === 'stats' && (
              <StatsView
                snap={api.snap}
                onPickDate={(d) => {
                  setDate(d);
                  setTab('today');
                }}
              />
            )}
            {tab === 'settings' && <SettingsView api={api} snap={api.snap} />}
            {tab === 'issues' && <IssuesView api={api} snap={api.snap} onDone={() => setTab('today')} />}
          </>
        ) : null}
      </main>

      <nav className="tabs-bottom">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            <span className="tab-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      {api.toast && (
        <div className={`toast ${api.toast.kind}`} key={api.toast.id}>
          <span>{api.toast.text}</span>
          {api.toast.undo && (
            <button
              onClick={() => {
                api.toast?.undo?.();
                api.dismissToast();
              }}
            >
              撤銷
            </button>
          )}
          <button className="toast-close" onClick={api.dismissToast} aria-label="關閉">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
