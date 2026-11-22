import { useEffect, useState } from 'react';
import { Icon } from '@life/ui/icon';
import { AppTabs, type AppTabItem } from '@life/ui/app-tabs';
import { parseEditHash, todayKey } from '@life/db';
import { useWater } from './useWater';
import { AddView } from './components/AddView';
import { CalendarView } from './components/CalendarView';
import { StatsView } from './components/StatsView';
import { SettingsView } from './components/SettingsView';
import { AppSwitcher } from '@life/ui/app-switcher';

/** 綜合首頁：上線時在上一層路徑；開發時是另一個 port */
const HOME_URL = import.meta.env.DEV ? `http://${location.hostname}:5172/` : "../";

export type Tab = 'add' | 'calendar' | 'stats' | 'more';

const TABS: AppTabItem<Tab>[] = [
  { key: 'add', icon: 'plus', label: '新增' },
  { key: 'calendar', icon: 'calendar', label: '日曆' },
  { key: 'stats', icon: 'chart', label: '統計' },
  { key: 'more', icon: 'more', label: '更多' },
];

function requestedDate() {
  const value = new URLSearchParams(location.search).get('date');
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= todayKey() ? value : todayKey();
}

export function App() {
  const api = useWater();
  const [tab, setTab] = useState<Tab>(() => location.hash === '#new' ? 'add' : 'calendar');
  const [date, setDate] = useState(requestedDate);
  /** 從綜合首頁點某一筆喝水進來（#edit/water/id）：資料讀好後打開它，改完回首頁 */
  const [pendingEdit, setPendingEdit] = useState(() => parseEditHash(location.hash));
  const [editFromHome, setEditFromHome] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [addDirty, setAddDirty] = useState(false);

  const goTo = (next: Tab) => {
    if (next === tab) return;
    if (tab === 'add' && addDirty && !confirm('目前有尚未儲存的內容，確定要離開新增頁嗎？')) return;
    if (next !== 'add') setEditId(null);
    setTab(next);
  };

  useEffect(() => {
    if (!pendingEdit || !api.snap) return;
    setPendingEdit(null);
    history.replaceState(null, '', location.pathname + location.search);
    const log = api.snap.logs.find((l) => l.id === pendingEdit.id);
    if (!log) return api.showToast({ kind: 'error', text: '找不到這一筆（可能已經刪除）' });
    setTab('add');
    setDate(log.date);
    setEditFromHome(log.id);
    setEditId(log.id);
  }, [pendingEdit, api.snap, api]);

  return (
    <div className="app">
      <header className="topbar">
        <AppSwitcher current="water" homeUrl={HOME_URL} date={date} confirmLeave={(tab === 'add' && addDirty) || tab === 'more'} />
        <h1>喝水</h1>
        <AppTabs items={TABS} current={tab} onChange={goTo} placement="top" />
        {api.status === 'ready' && (
          <button className="icon-btn" onClick={api.refresh} disabled={api.busy} title="重新整理（讀取試算表最新資料）" aria-label="重新整理">
            <span className={api.busy ? 'spin' : ''}>
              <Icon name="refresh" />
            </span>
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
            {tab === 'add' && <AddView api={api} snap={api.snap} date={date} setDate={setDate} editId={editId} onDirtyChange={setAddDirty} onDone={() => {
              setEditId(null);
              setAddDirty(false);
              if (editFromHome) location.href = HOME_URL + location.search;
              else setTab('calendar');
            }} />}
            {tab === 'calendar' && <CalendarView snap={api.snap} date={date} setDate={setDate} onAdd={() => { setEditId(null); setTab('add'); }} onEdit={(id) => { setEditId(id); setTab('add'); }} />}
            {tab === 'stats' && (
              <StatsView
                snap={api.snap}
                onPickDate={(d) => {
                  setDate(d);
                  setTab('calendar');
                }}
              />
            )}
            {tab === 'more' && <SettingsView api={api} snap={api.snap} />}
          </>
        ) : null}
      </main>

      <AppTabs items={TABS} current={tab} onChange={goTo} placement="bottom" />

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
