import { useEffect, useState } from 'react';
import type { EntryForm, Txn } from '@life/db';
import { emptyForm, parseEditHash, todayKey } from '@life/db';
import { useMoney } from './useMoney';
import { LedgerView } from './components/LedgerView';
import { EntryEditor } from './components/EntryEditor';
import { StatsView } from './components/StatsView';
import { AccountsView } from './components/AccountsView';
import { SettingsView } from './components/SettingsView';
import { IssuesView } from './components/IssuesView';
import { CategoriesView } from './components/CategoriesView';
import { BudgetsView } from './components/BudgetsView';
import { BudgetsAdmin } from './components/BudgetsAdmin';

/** 綜合首頁：上線時在上一層路徑；開發時是另一個 port */
const HOME_URL = import.meta.env.DEV ? `http://${location.hostname}:5172/` : '../';

export type Tab = 'ledger' | 'stats' | 'budgets' | 'accounts' | 'settings' | 'categories' | 'budgetsAdmin' | 'issues';

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: 'ledger', icon: '📒', label: '記帳' },
  { key: 'stats', icon: '📊', label: '統計' },
  { key: 'budgets', icon: '💼', label: '預算' },
  { key: 'accounts', icon: '🏦', label: '帳戶' },
  { key: 'categories', icon: '🏷️', label: '分類' },
  { key: 'settings', icon: '⚙️', label: '設定' },
];

/** 正在編輯：新的一筆（form）或修改既有的（txn） */
export interface Editing {
  form: EntryForm;
  txn?: Txn;
  /** 「在 APP 裡補完」：存回試算表原本那一列（不另外多一筆） */
  target?: { rowNumber: number; id: string };
}

export function App() {
  const api = useMoney();
  const [tab, setTabState] = useState<Tab>('ledger');
  const [date, setDate] = useState(todayKey);
  const [view, setView] = useState<'day' | 'month'>('day');
  const [editing, setEditing] = useState<Editing | null>(null);
  /** 網址 #new：一打開就記一筆；#edit/money/id：打開那一筆（綜合首頁） */
  const [pending] = useState(() => (location.hash === '#new' ? { id: null } : parseEditHash(location.hash)?.kind === 'money' ? { id: parseEditHash(location.hash)!.id } : null));
  const [pendingDone, setPendingDone] = useState(false);
  /** 從綜合首頁來的：存好或取消後回首頁 */
  const [fromHome, setFromHome] = useState(false);

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
    if (!pending || pendingDone || !api.snap) return;
    setPendingDone(true);
    history.replaceState(null, '', location.pathname + location.search);
    setFromHome(true);
    if (!pending.id) return edit({ form: emptyForm('支出') });
    const t = api.snap.txns.find((x) => x.id === pending.id);
    if (!t) return api.showToast({ kind: 'error', text: '找不到這一筆（可能已經刪除）' });
    setDate(t.date);
    edit({ form: emptyForm(), txn: t });
  }, [pending, pendingDone, api.snap]);

  const closeEditor = () => {
    setEditing(null);
    if (fromHome) location.href = HOME_URL + location.search;
  };

  return (
    <div className="app">
      <header className="topbar">
        <a className="icon-btn home-link" href={HOME_URL + location.search} title="回首頁">
          🏠
        </a>
        <h1>💰 記帳</h1>
        <nav className="tabs-top">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key || (tab === 'budgetsAdmin' && t.key === 'budgets') ? 'active' : ''} onClick={() => setTab(t.key)}>
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
                    onClose={closeEditor}
                  />
                )}
                <LedgerView snap={api.snap} date={date} setDate={setDate} view={view} setView={setView} onEdit={edit} editing={!!editing} />
              </>
            )}
            {tab === 'stats' && <StatsView snap={api.snap} initialMonth={date.slice(0, 7)} />}
            {tab === 'accounts' && <AccountsView api={api} snap={api.snap} onEdit={edit} />}
            {tab === 'budgets' && (
              <BudgetsView api={api} snap={api.snap} onEdit={edit} goAccounts={() => setTab('accounts')} goAdmin={() => setTab('budgetsAdmin')} />
            )}
            {tab === 'budgetsAdmin' && <BudgetsAdmin api={api} snap={api.snap} onBack={() => setTab('budgets')} />}
            {tab === 'settings' && (
              <SettingsView api={api} snap={api.snap} openBudgets={() => setTab('budgetsAdmin')} />
            )}
            {tab === 'categories' && <CategoriesView api={api} snap={api.snap} />}
            {tab === 'issues' && (
              <IssuesView
                api={api}
                snap={api.snap}
                onDone={() => setTab('ledger')}
                onFix={(i) => i.draft && i.id && edit({ form: i.draft, target: { rowNumber: i.rowNumber, id: i.id } })}
              />
            )}
          </>
        ) : null}
      </main>

      <nav className="tabs-bottom">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key || (tab === 'budgetsAdmin' && t.key === 'budgets') ? 'active' : ''} onClick={() => setTab(t.key)}>
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
