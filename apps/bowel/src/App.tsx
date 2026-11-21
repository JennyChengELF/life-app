import { useEffect, useState } from 'react';
import { Icon, type IconName } from '@life/ui/icon';
import { parseEditHash, todayKey } from '@life/db';
import { useBowel } from './useBowel';
import { startLog, TodayView } from './components/TodayView';
import { StatsView } from './components/StatsView';
import { SettingsView } from './components/SettingsView';
import { IssuesView } from './components/IssuesView';

/** 綜合首頁：上線時在上一層路徑；開發時是另一個 port */
const HOME_URL = import.meta.env.DEV ? `http://${location.hostname}:5172/` : '../';

export type Tab = 'today' | 'stats' | 'settings' | 'issues';

const TABS: { key: Tab; icon: IconName; label: string }[] = [
  { key: 'today', icon: 'clipboard', label: '紀錄' },
  { key: 'stats', icon: 'calendar', label: '統計' },
  { key: 'settings', icon: 'settings', label: '設定' },
];

/** 回綜合首頁（?local 本機測試模式一起帶回去） */
const goHome = () => {
  location.href = HOME_URL + location.search;
};

/** 網址 #new：一打開就記一筆（綜合首頁的一鍵記錄）；#edit/bowel/id：打開那一筆 */
type Pending = { kind: 'new' } | { kind: 'edit'; id: string } | null;
function pendingFromHash(): Pending {
  if (location.hash === '#new') return { kind: 'new' };
  const e = parseEditHash(location.hash);
  return e?.kind === 'bowel' ? { kind: 'edit', id: e.id } : null;
}

function requestedDate() {
  const value = new URLSearchParams(location.search).get('date');
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= todayKey() ? value : todayKey();
}

export function App() {
  const api = useBowel();
  const [tab, setTabState] = useState<Tab>('today');
  const [date, setDate] = useState(requestedDate);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(pendingFromHash);
  /** 從綜合首頁來的：填完回首頁 */
  const [fromHome, setFromHome] = useState(false);

  const setTab = (t: Tab) => {
    setOpenId(null);
    setTabState(t);
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    if (!pending || !api.snap) return;
    setPending(null);
    history.replaceState(null, '', location.pathname + location.search);
    setFromHome(true);
    if (pending.kind === 'new') {
      const selected = requestedDate();
      setDate(selected);
      startLog(api, selected, setOpenId);
      return;
    }
    const log = api.snap.logs.find((l) => l.id === pending.id);
    if (!log) return api.showToast({ kind: 'error', text: '找不到這一筆（可能已經刪除）' });
    setDate(log.date);
    setOpenId(log.id);
  }, [pending, api.snap, api]);

  return (
    <div className="app">
      <header className="topbar">
        <a className="icon-btn home-link" href={HOME_URL + location.search} title="回首頁" aria-label="回首頁">
          <Icon name="home" />
        </a>
        <h1>廁所大事</h1>
        <nav className="tabs-top">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
              <Icon name={t.icon} size={20} /> {t.label}
            </button>
          ))}
        </nav>
        {api.status === 'ready' && (
          <button className="icon-btn" onClick={api.refresh} disabled={api.busy} title="重新整理（讀取試算表最新資料）" aria-label="重新整理">
            <span className={api.busy ? 'spin' : ''}>
              <Icon name="refresh" />
            </span>
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
            <p className="muted small">APP 只能存取它自己建立的試算表（「生活APP-廁所大事」等）。</p>
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
            {tab === 'today' && (
              <TodayView
                api={api}
                snap={api.snap}
                date={date}
                setDate={setDate}
                goTo={setTab}
                openId={openId}
                setOpenId={setOpenId}
                onDone={() => fromHome && goHome()}
              />
            )}
            {tab === 'stats' && (
              <StatsView
                snap={api.snap}
                openDay={(d) => {
                  setDate(d);
                  setTab('today');
                }}
              />
            )}
            {tab === 'settings' && <SettingsView key={api.snap.loadedAt} api={api} snap={api.snap} />}
            {tab === 'issues' && <IssuesView api={api} snap={api.snap} onDone={() => setTab('today')} />}
          </>
        ) : null}
      </main>

      <nav className="tabs-bottom">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            <span className="tab-icon">
              <Icon name={t.icon} />
            </span>
            {t.label}
          </button>
        ))}
      </nav>

      {api.toast && (
        <div className={`toast ${api.toast.kind}`} key={api.toast.id}>
          <span>{api.toast.text}</span>
          <button className="toast-close" onClick={api.dismissToast} aria-label="關閉">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
