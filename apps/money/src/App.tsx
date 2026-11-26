import { useEffect, useState } from 'react';
import type { EntryForm, Txn } from '@life/db';
import { canCopyTxn, copyTxnForm, emptyForm, parseEditHash, startOfDay, stocktakeStatus, todayKey, txnMissingCategory } from '@life/db';
import { useMoney } from './useMoney';
import { EntryEditor } from './components/EntryEditor';
import { StatsView } from './components/StatsView';
import { AccountsView } from './components/AccountsView';
import { SettingsView, type MoneySettingSection } from './components/SettingsView';
import { IssuesView } from './components/IssuesView';
import { CategoriesView } from './components/CategoriesView';
import { BudgetsView } from './components/BudgetsView';
import { BudgetsAdmin } from './components/BudgetsAdmin';
import { AccountDetail } from './components/AccountDetail';
import { ReconcileView } from './components/ReconcileView';
import { StocktakeView } from './components/Stocktake';
import { Icon } from '@life/ui/icon';
import { AppSwitcher } from '@life/ui/app-switcher';
import { AppTabs, type AppTabItem } from '@life/ui/app-tabs';
import { AddMenu } from './components/AddMenu';
import { CalendarView } from './components/CalendarView';
import { MoreMenu, type MoreKey } from './components/MoreMenu';

/** 綜合首頁：上線時在上一層路徑；開發時是另一個 port */
const HOME_URL = import.meta.env.DEV ? `http://${location.hostname}:5172/` : '../';

type MainTab = 'add' | 'calendar' | 'stats' | 'more';
export type Tab = MainTab | 'budgets' | 'accounts' | 'settings' | 'categories' | 'budgetsAdmin' | 'issues';

const TABS: AppTabItem<MainTab>[] = [
  { key: 'add', icon: 'plus', label: '新增' },
  { key: 'calendar', icon: 'calendar', label: '日曆' },
  { key: 'stats', icon: 'chart', label: '統計' },
  { key: 'more', icon: 'more', label: '更多' },
];

/** 分頁按鈕亮哪一個（子頁面算在它的分頁底下） */
const tabOf = (t: Tab): MainTab => t === 'add' || t === 'calendar' || t === 'stats' || t === 'more' ? t : 'more';

function requestedDate() {
  const value = new URLSearchParams(location.search).get('date');
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= todayKey() ? value : todayKey();
}

function timeForDate(date: string) {
  const now = new Date();
  const selected = new Date(startOfDay(date));
  return selected.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
}

/** 正在編輯：新的一筆（form）或修改既有的（txn） */
export interface Editing {
  form: EntryForm;
  txn?: Txn;
  /** 從「複製一筆」開的新草稿：不自動帶出原交易的手續費等附屬交易。 */
  copied?: boolean;
  /** 「在 APP 裡補完」：存回試算表原本那一列（不另外多一筆） */
  target?: { rowNumber: number; id: string };
  /** 存好或取消後回到哪一頁（例：從對帳頁補登 → 回對帳頁） */
  back?: { tab: Tab };
}

/** 帳戶頁裡的哪一頁：帳戶明細、對帳、月底盤點（2026-11-18 第 3 輪） */
export type AccPage = { view: 'detail'; account: string } | { view: 'reconcile'; account: string; closeDate: string } | { view: 'stocktake' } | null;

export function App() {
  const api = useMoney();
  const [tab, setTabState] = useState<Tab>('calendar');
  const [date, setDate] = useState(requestedDate);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [settingSection, setSettingSection] = useState<MoneySettingSection>('settings');
  const [accPage, setAccPageState] = useState<AccPage>(null);
  const setAccPage = (p: AccPage) => {
    setAccPageState(p);
    window.scrollTo(0, 0);
  };
  /** 網址 #new：一打開就記一筆；#edit/money/id：打開那一筆（綜合首頁） */
  const [pending] = useState(() =>
    location.hash === '#new' ? { id: null } : location.hash === '#stocktake' ? { id: null, stocktake: true } : parseEditHash(location.hash)?.kind === 'money' ? { id: parseEditHash(location.hash)!.id } : null,
  );
  const [pendingDone, setPendingDone] = useState(false);
  /** 從綜合首頁來的：存好或取消後回首頁 */
  const [fromHome, setFromHome] = useState(false);

  const setTab = (t: Tab) => {
    setFromHome(false);
    setTabState(t);
    if (t === 'accounts') setAccPageState(null);
    window.scrollTo(0, 0);
  };
  /** 2026-11-22 使用者決定：新增表單尚未儲存時，切換分頁前要先提醒。 */
  const changeMainTab = (t: MainTab) => {
    if (editing && t !== 'add' && !window.confirm('這筆資料還沒儲存，確定要離開嗎？')) return;
    if (editing && t !== 'add') setEditing(null);
    setTab(t);
  };
  const edit = (e: Editing) => {
    setEditing(e);
    setTabState('add');
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    if (!pending || pendingDone || !api.snap) return;
    setPendingDone(true);
    history.replaceState(null, '', location.pathname + location.search);
    // 首頁的「月底盤點」提醒 → 直接打開盤點頁
    if ('stocktake' in pending) {
      setTabState('accounts');
      return setAccPage({ view: 'stocktake' });
    }
    setFromHome(true);
    if (!pending.id) return edit({ form: emptyForm('支出', startOfDay(requestedDate())) });
    const t = api.snap.txns.find((x) => x.id === pending.id);
    if (!t) return api.showToast({ kind: 'error', text: '找不到這一筆（可能已經刪除）' });
    setDate(t.date);
    edit({ form: emptyForm(), txn: t });
  }, [pending, pendingDone, api.snap]);

  const closeEditor = () => {
    const back = editing?.back;
    setEditing(null);
    if (back) {
      setTabState(back.tab);
      window.scrollTo(0, 0);
    } else if (fromHome) location.href = HOME_URL + location.search;
    else setTabState('calendar');
  };

  const openMore = (key: MoreKey) => {
    if (key === 'budgets' || key === 'accounts' || key === 'categories' || key === 'issues') return setTab(key);
    setSettingSection(key);
    setTab('settings');
  };

  return (
    <div className="app">
      <header className="topbar">
        <AppSwitcher current="money" homeUrl={HOME_URL} date={date} confirmLeave={editing !== null || tab === 'settings' || tab === 'budgetsAdmin'} />
        <h1>記帳</h1>
        <AppTabs items={TABS} current={tabOf(tab)} onChange={changeMainTab} placement="top" />
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
            {tab === 'calendar' && stocktakeStatus(api.snap, todayKey())?.pending.length ? (
              <div className="messages">
                <button className="msg warn" onClick={() => (setTabState('accounts'), setAccPage({ view: 'stocktake' }))}>
                  🧮 月底盤點：還有 {stocktakeStatus(api.snap, todayKey())!.pending.length} 個帳戶沒盤點，點這裡
                </button>
              </div>
            ) : null}
            {/* 2026-11-19：整批補齊、試算表輸入時可以先不選分類 → 提醒回來補，點一下打開最早的那一筆 */}
            {tab === 'calendar' && api.snap.txns.some(txnMissingCategory) && (
              <div className="messages">
                <button className="msg warn" onClick={() => edit({ form: emptyForm(), txn: api.snap!.txns.filter(txnMissingCategory).sort((a, b) => a.time - b.time)[0] })}>
                  ⚠️ 有 {api.snap.txns.filter(txnMissingCategory).length} 筆還沒選分類，點這裡補
                </button>
              </div>
            )}
            {api.snap.issues.length > 0 && tab !== 'issues' && (
              <div className="messages">
                <button className="msg warn" onClick={() => setTab('issues')}>
                  ⚠️ 試算表有 {api.snap.issues.length} 筆資料需要補齊，點這裡看
                </button>
              </div>
            )}
            {tab === 'add' && (editing ? <><button type="button" className="link more-back" onClick={() => {
              if (window.confirm('這筆資料還沒儲存，確定要更換記帳項目嗎？')) setEditing(null);
            }}><Icon name="left" size={18} /> 更換項目</button><EntryEditor
              key={editing.txn?.id ?? `new-${editing.form.mode}-${editing.form.person ?? ''}`}
              api={api}
              snap={api.snap}
              editing={editing}
              onClose={closeEditor}
              onSavedDate={setDate}
              onEdit={(entry) => { if (entry.txn) setDate(entry.txn.date); edit(entry); }}
              hideModeSwitch
              onCopy={editing.txn && canCopyTxn(editing.txn) ? () => {
                edit({ form: copyTxnForm(editing.txn!, timeForDate(date)), copied: true });
                api.showToast({ kind: 'info', text: '已複製成新交易，確認或修改後再儲存' });
              } : undefined}
            /></> : <AddMenu date={date} setDate={setDate} open={(mode) => edit({ form: emptyForm(mode, startOfDay(date)) })} />)}
            {tab === 'calendar' && <CalendarView snap={api.snap} date={date} setDate={setDate} onEdit={(value) => edit(value)} onAdd={() => setTab('add')} />}
            {tab === 'stats' && <StatsView snap={api.snap} initialMonth={date.slice(0, 7)} />}
            {tab === 'accounts' && <AccountsTab api={api} snap={api.snap} page={accPage} setPage={setAccPage} onEdit={edit} onBack={() => setTab('more')} />}
            {tab === 'budgets' && (
              <><MoreBack onClick={() => setTab('more')} /><BudgetsView api={api} snap={api.snap} onEdit={edit} goAccounts={() => setTab('accounts')} goAdmin={() => setTab('budgetsAdmin')} /></>
            )}
            {tab === 'budgetsAdmin' && <BudgetsAdmin api={api} snap={api.snap} onBack={() => setTab('budgets')} />}
            {tab === 'settings' && <SettingsView api={api} snap={api.snap} section={settingSection} onBack={() => setTab('more')} />}
            {tab === 'categories' && <><MoreBack onClick={() => setTab('more')} /><CategoriesView api={api} snap={api.snap} /></>}
            {tab === 'more' && <MoreMenu issues={api.snap.issues.length} open={openMore} />}
            {tab === 'issues' && (
              <IssuesView
                api={api}
                snap={api.snap}
                onDone={() => setTab('more')}
                onFix={(i) => i.draft && i.id && edit({ form: i.draft, target: { rowNumber: i.rowNumber, id: i.id } })}
              />
            )}
          </>
        ) : null}
      </main>

      <AppTabs items={TABS} current={tabOf(tab)} onChange={changeMainTab} placement="bottom" />

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

function MoreBack({ onClick }: { onClick: () => void }) {
  return <button type="button" className="link more-back" onClick={onClick}><Icon name="left" size={18} /> 返回更多</button>;
}

/** 帳戶分頁：總覽 / 帳戶明細 / 對帳 / 月底盤點 */
function AccountsTab({
  api,
  snap,
  page,
  setPage,
  onEdit,
  onBack,
}: {
  api: ReturnType<typeof useMoney>;
  snap: NonNullable<ReturnType<typeof useMoney>['snap']>;
  page: AccPage;
  setPage: (p: AccPage) => void;
  onEdit: (e: Editing) => void;
  onBack: () => void;
}) {
  const acc = page && page.view !== 'stocktake' ? snap.accounts.find((a) => a.name === page.account) : null;
  if (page?.view === 'stocktake') return <StocktakeView api={api} snap={snap} onBack={() => setPage(null)} onOpen={(name) => setPage({ view: 'detail', account: name })} />;
  if (page?.view === 'reconcile' && acc) {
    return (
      <ReconcileView
        api={api}
        snap={snap}
        acc={acc}
        closeDate={page.closeDate}
        setCloseDate={(d) => setPage({ ...page, closeDate: d })}
        onBack={() => setPage({ view: 'detail', account: acc.name })}
        onEdit={onEdit}
      />
    );
  }
  if (page?.view === 'detail' && acc) {
    return (
      <AccountDetail
        api={api}
        snap={snap}
        acc={acc}
        onBack={() => setPage(null)}
        onEdit={onEdit}
        openReconcile={(closeDate) => setPage({ view: 'reconcile', account: acc.name, closeDate })}
      />
    );
  }
  return <><MoreBack onClick={onBack} /><AccountsView api={api} snap={snap} onEdit={onEdit} onOpen={(name) => setPage({ view: 'detail', account: name })} onStocktake={() => setPage({ view: 'stocktake' })} /></>;
}
