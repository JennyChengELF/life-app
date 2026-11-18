import { useEffect, useState } from 'react';
import type { EntryForm, Txn } from '@life/db';
import { emptyForm, todayKey } from '@life/db';
import { useMoney } from './useMoney';
import { LedgerView } from './components/LedgerView';
import { EntryEditor } from './components/EntryEditor';
import { StatsView } from './components/StatsView';
import { AccountsView } from './components/AccountsView';
import { SettingsView } from './components/SettingsView';
import { IssuesView } from './components/IssuesView';
import { CategoriesView } from './components/CategoriesView';

/** 綜合首頁：上線時在上一層路徑；開發時是另一個 port */
const HOME_URL = import.meta.env.DEV ? `http://${location.hostname}:5172/` : '../';

export type Tab = 'ledger' | 'stats' | 'accounts' | 'settings' | 'categories' | 'issues';

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: 'ledger', icon: '📒', label: '記帳' },
  { key: 'stats', icon: '📊', label: '統計' },
  { key: 'accounts', icon: '🏦', label: '帳戶' },
  { key: 'settings', icon: '⚙️', label: '設定' },
];

/** 正在編輯：新的一筆（form）或修改既有的（txn） */
export interface Editing {
  form: EntryForm;
  txn?: Txn;
}

export function App() {
  const api = useMoney();
  const [tab, setTabState] = useState<Tab>('ledger');
  const [month, setMonth] = useState(() => todayKey().slice(0, 7));
  const [editing, setEditing] = useState<Editing | null>(null);
  /** 網址 #new：一打開就記一筆（綜合首頁的按鈕） */
  const [pendingNew, setPendingNew] = useState(location.hash === '#new');

  const setTab = (t: Tab) => {
    setTabState(t);
    window.scrollTo(0, 0);
  };
  const edit = (e: Editing) => {
    setEditing(e);
    setTabState('ledger');
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    if (!pendingNew || !api.snap) return;
    setPendingNew(false);
    history.replaceState(null, '', location.pathname + location.search);
    edit({ form: emptyForm('支出') });
  }, [pendingNew, api.snap]);

  return (
    <div className="app">
      <header className="topbar">
        <a className="icon-btn home-link" href={HOME_URL + location.search} title="回首頁">
          🏠
        </a>
        <h1>💰 記帳</h1>
        <nav className="tabs-top">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key || (tab === 'categories' && t.key === 'settings') ? 'active' : ''} onClick={() => setTab(t.key)}>
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
            <p className="muted small">APP 只能存取它自己建立的試算表（「生活APP-記帳」等）。</p>
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
            {api.snap.issues.length > 0 && tab !== 'issues' && (
              <div className="messages">
                <button className="msg warn" onClick={() => setTab('issues')}>
                  ⚠️ 試算表有 {api.snap.issues.length} 筆資料需要補齊，點這裡看
                </button>
              </div>
            )}
            {tab === 'ledger' && (
              <>
                {editing && (
                  <EntryEditor
                    key={editing.txn?.id ?? `new-${editing.form.mode}-${editing.form.person ?? ''}`}
                    api={api}
                    snap={api.snap}
                    editing={editing}
                    onClose={() => setEditing(null)}
                  />
                )}
                <LedgerView snap={api.snap} month={month} setMonth={setMonth} onEdit={edit} editing={!!editing} />
              </>
            )}
            {tab === 'stats' && <StatsView snap={api.snap} month={month} setMonth={setMonth} />}
            {tab === 'accounts' && <AccountsView snap={api.snap} onEdit={edit} goSettings={() => setTab('settings')} />}
            {tab === 'settings' && <SettingsView api={api} snap={api.snap} openCategories={() => setTab('categories')} />}
            {tab === 'categories' && <CategoriesView api={api} snap={api.snap} onBack={() => setTab('settings')} />}
            {tab === 'issues' && <IssuesView api={api} snap={api.snap} onDone={() => setTab('ledger')} />}
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
          <button className="toast-close" onClick={api.dismissToast} aria-label="關閉">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
