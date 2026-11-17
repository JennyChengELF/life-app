import { useEffect, useState } from 'react';
import { parseEditHash, todayKey } from '@life/db';
import type { BloodGlucose, BloodPressure, BodyMeasurement, Temperature, TempKind } from '@life/db';
import { useHealth } from './useHealth';
import { OverviewView } from './components/OverviewView';
import { BodyTab } from './components/BodyTab';
import { BodyView } from './components/BodyView';
import { BpView } from './components/BpView';
import { GlucoseView } from './components/GlucoseView';
import { TempView } from './components/TempView';
import { MoreView } from './components/MoreView';
import { OccView } from './components/OccView';
import { SettingsView } from './components/SettingsView';
import { IssuesView } from './components/IssuesView';

/** 綜合首頁：上線時在上一層路徑；開發時是另一個 port */
const HOME_URL = import.meta.env.DEV ? `http://${location.hostname}:5172/` : '../';

export type Tab = 'overview' | 'body' | 'bodyForm' | 'bp' | 'glucose' | 'temp' | 'more' | 'occ' | 'settings' | 'issues';
export type VitalTab = 'bp' | 'glucose' | 'temp';
/** 輸入畫面存好 / 取消後回到哪裡；home = 綜合首頁（從首頁點某一筆進來的） */
export type Back = Tab | 'home';
export type RecordKind = 'body' | 'bp' | 'glucose' | 'temp' | 'occ';
type VitalRecord = BloodPressure | BloodGlucose | Temperature;

/** 下方分頁列（2026-11-17 確認）；體溫、偶爾量測、設定放在「更多」 */
const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: 'overview', icon: '🩺', label: '總覽' },
  { key: 'body', icon: '⚖️', label: '身體' },
  { key: 'bp', icon: '🩸', label: '血壓' },
  { key: 'glucose', icon: '🍬', label: '血糖' },
  { key: 'more', icon: '☰', label: '更多' },
];
const UNDER: Partial<Record<Tab, Tab>> = { bodyForm: 'body', temp: 'more', occ: 'more', settings: 'more' };

/** 網址 #new（記體重）、#bp、#glucose、#temp → 直接打開輸入畫面；#edit/種類/id → 讀完資料後打開那一筆（見 pendingEdit） */
function fromHash(): { tab: Tab; form: boolean } {
  const h = location.hash.slice(1);
  if (h === 'new') return { tab: 'bodyForm', form: false };
  if (h === 'bp' || h === 'glucose' || h === 'temp') return { tab: h, form: true };
  return { tab: 'overview', form: false };
}

export interface VitalForm {
  /** null = 新增 */
  rec: VitalRecord | null;
  /** 體溫：新增時預設的種類 */
  tempKind?: TempKind;
}

/** 回綜合首頁（?local 本機測試模式一起帶回去） */
const goHome = () => {
  location.href = HOME_URL + location.search;
};

export function App() {
  const api = useHealth();
  const [tab, setTabState] = useState<Tab>(() => fromHash().tab);
  /** 正在修改的身體量測（null = 新增） */
  const [editing, setEditing] = useState<BodyMeasurement | null>(null);
  /** 血壓、血糖、體溫的輸入畫面（null = 看列表） */
  const [vitalForm, setVitalForm] = useState<VitalForm | null>(() => (fromHash().form ? { rec: null } : null));
  /** 總覽看的日期（去修改再回來時保留） */
  const [overviewDate, setOverviewDate] = useState(todayKey);
  /** 偶爾量測畫面要先填的項目（例：BMI 不同時按「改身高」） */
  const [focusItem, setFocusItem] = useState<string | null>(null);
  /** 輸入畫面存好 / 取消後回到哪裡（從總覽打開的回總覽；沒有就回那一種的列表） */
  const [formBack, setFormBack] = useState<Back | null>(null);
  /** 從綜合首頁點某一筆進來：資料讀好後打開它 */
  const [pendingEdit, setPendingEdit] = useState(() => parseEditHash(location.hash));

  useEffect(() => {
    const onHash = () => {
      const h = fromHash();
      setEditing(null);
      setVitalForm(h.form ? { rec: null } : null);
      setTabState(h.tab);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const setTab = (t: Tab) => {
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    if (t !== 'bodyForm') setEditing(null);
    if (t !== 'occ') setFocusItem(null);
    setVitalForm(null);
    setFormBack(null);
    setTabState(t);
    window.scrollTo(0, 0);
  };

  const nav: Nav = {
    edit: (m, back = null) => {
      setTab('bodyForm');
      setEditing(m);
      setFormBack(back);
    },
    newBody: (back = null) => {
      setTab('bodyForm');
      setFormBack(back);
    },
    closeBody: () => (formBack === 'home' ? goHome() : setTab(formBack ?? 'body')),
    occ: (item = null) => {
      setTab('occ');
      setFocusItem(item);
    },
    vital: (t, form = { rec: null }, back = null) => {
      setTab(t);
      setVitalForm(form);
      setFormBack(back);
    },
    closeForm: () => {
      if (formBack === 'home') return goHome();
      if (formBack) return setTab(formBack);
      setVitalForm(null);
      window.scrollTo(0, 0);
    },
    openRecord: (kind, id, back) => {
      const snap = api.snap;
      const find = <T extends { id: string }>(list: T[]) => list.find((x) => x.id === id) ?? null;
      const rec =
        !snap ? null
        : kind === 'body' ? find(snap.body)
        : kind === 'bp' ? find(snap.bp)
        : kind === 'glucose' ? find(snap.glucose)
        : kind === 'temp' ? find(snap.temps)
        : find(snap.occ);
      if (!rec) {
        api.showToast({ kind: 'error', text: '找不到這一筆（可能已經刪除）' });
        return false;
      }
      if (kind === 'body') nav.edit(rec as BodyMeasurement, back);
      else if (kind === 'occ') nav.occ();
      else nav.vital(kind, { rec: rec as VitalRecord }, back);
      return true;
    },
    go: setTab,
  };

  useEffect(() => {
    if (!pendingEdit || !api.snap) return;
    setPendingEdit(null);
    if (pendingEdit.kind !== 'water') nav.openRecord(pendingEdit.kind, pendingEdit.id, 'home');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEdit, api.snap]);

  const active = UNDER[tab] ?? tab;
  const vitalKey = vitalForm ? (vitalForm.rec?.id ?? `new-${vitalForm.tempKind ?? ''}`) : 'list';

  return (
    <div className="app">
      <header className="topbar">
        <a className="icon-btn home-link" href={HOME_URL} title="回首頁">
          🏠
        </a>
        <h1>🩺 健康</h1>
        <nav className="tabs-top">
          {TABS.map((t) => (
            <button key={t.key} className={active === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
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
            {tab === 'overview' && <OverviewView api={api} snap={api.snap} nav={nav} date={overviewDate} setDate={setOverviewDate} />}
            {tab === 'body' && <BodyTab api={api} snap={api.snap} nav={nav} />}
            {tab === 'bodyForm' && <BodyView key={editing?.id ?? 'new'} api={api} snap={api.snap} editing={editing} nav={nav} />}
            {tab === 'bp' && <BpView key={vitalKey} api={api} snap={api.snap} nav={nav} form={vitalForm} />}
            {tab === 'glucose' && <GlucoseView key={vitalKey} api={api} snap={api.snap} nav={nav} form={vitalForm} />}
            {tab === 'temp' && <TempView key={vitalKey} api={api} snap={api.snap} nav={nav} form={vitalForm} />}
            {tab === 'more' && <MoreView snap={api.snap} nav={nav} />}
            {tab === 'occ' && <OccView key={focusItem ?? ''} api={api} snap={api.snap} focusItem={focusItem} />}
            {tab === 'settings' && <SettingsView api={api} snap={api.snap} />}
            {tab === 'issues' && <IssuesView api={api} snap={api.snap} onDone={() => setTab('overview')} />}
          </>
        ) : null}
      </main>

      <nav className="tabs-bottom">
        {TABS.map((t) => (
          <button key={t.key} className={active === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
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
  /** back：存好 / 取消後回到哪個分頁（預設回身體） */
  edit: (m: BodyMeasurement, back?: Back | null) => void;
  newBody: (back?: Back | null) => void;
  /** 身體量測輸入畫面 → 回去 */
  closeBody: () => void;
  occ: (item?: string | null) => void;
  /** 打開血壓 / 血糖 / 體溫；有 form 就直接進輸入畫面 */
  vital: (t: VitalTab, form?: VitalForm, back?: Back | null) => void;
  /** 打開某一筆的修改畫面；找不到回傳 false */
  openRecord: (kind: RecordKind, id: string, back: Back | null) => boolean;
  /** 輸入畫面 → 回列表 */
  closeForm: () => void;
  go: (t: Tab) => void;
};
