import { useEffect, useState } from 'react';
import type { BodyMeasurement } from '@life/db';
import { useHealth } from './useHealth';
import { OverviewView } from './components/OverviewView';
import { BodyView } from './components/BodyView';
import { OccView } from './components/OccView';
import { SettingsView } from './components/SettingsView';
import { IssuesView } from './components/IssuesView';

/** 綜合首頁：上線時在上一層路徑；開發時是另一個 port */
const HOME_URL = import.meta.env.DEV ? `http://${location.hostname}:5172/` : "../";

export type Tab = 'overview' | 'body' | 'occ' | 'settings' | 'issues';

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: 'overview', icon: '🩺', label: '總覽' },
  { key: 'body', icon: '⚖️', label: '記錄' },
  { key: 'occ', icon: '📏', label: '偶爾量測' },
  { key: 'settings', icon: '⚙️', label: '設定' },
];

/** 網址 #new（從綜合首頁的「記體重」進來）→ 直接打開輸入畫面 */
const tabFromHash = (): Tab => (location.hash === '#new' ? 'body' : 'overview');

export function App() {
  const api = useHealth();
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  /** 正在修改的身體量測（null = 新增） */
  const [editing, setEditing] = useState<BodyMeasurement | null>(null);
  /** 偶爾量測畫面要先填的項目（例：BMI 不同時按「改身高」） */
  const [focusItem, setFocusItem] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => {
      setEditing(null);
      setTabState(tabFromHash());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const setTab = (t: Tab) => {
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    if (t !== 'body') setEditing(null);
    if (t !== 'occ') setFocusItem(null);
    setTabState(t);
    window.scrollTo(0, 0);
  };

  const nav = {
    edit: (m: BodyMeasurement) => {
      setTab('body');
      setEditing(m);
    },
    newBody: () => {
      setTab('body');
      setEditing(null);
    },
    occ: (item: string | null = null) => {
      setTab('occ');
      setFocusItem(item);
    },
    go: setTab,
  };

  return (
    <div className="app">
      <header className="topbar">
        <a className="icon-btn home-link" href={HOME_URL} title="回首頁">
          🏠
        </a>
        <h1>🩺 健康</h1>
        <nav className="tabs-top">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => (t.key === 'body' ? nav.newBody() : setTab(t.key))}>
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

      {api.mode === 'local' && <div className="mode-banner">本機測試模式：資料只存在這個瀏覽器，還沒接上 Google 試算表</div>}

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
            <p className="muted small">APP 只能存取它自己建立的試算表（「生活APP-健康」等）。</p>
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
            {tab === 'overview' && <OverviewView api={api} snap={api.snap} nav={nav} />}
            {tab === 'body' && (
              <BodyView key={editing?.id ?? 'new'} api={api} snap={api.snap} editing={editing} nav={nav} />
            )}
            {tab === 'occ' && <OccView key={focusItem ?? ''} api={api} snap={api.snap} focusItem={focusItem} />}
            {tab === 'settings' && <SettingsView api={api} snap={api.snap} />}
            {tab === 'issues' && <IssuesView api={api} snap={api.snap} onDone={() => setTab('overview')} />}
          </>
        ) : null}
      </main>

      <nav className="tabs-bottom">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => (t.key === 'body' ? nav.newBody() : setTab(t.key))}>
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

export type Nav = {
  edit: (m: BodyMeasurement) => void;
  newBody: () => void;
  occ: (item?: string | null) => void;
  go: (t: Tab) => void;
};
