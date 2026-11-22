import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '@life/ui/icon';
import { AppTabs, type AppTabItem } from '@life/ui/app-tabs';
import { parseEditHash, startOfDay, todayKey } from '@life/db';
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
import { SettingsView, type HealthSettingSection } from './components/SettingsView';
import { IssuesView } from './components/IssuesView';
import { LabView } from './components/LabView';
import { AppSwitcher } from '@life/ui/app-switcher';
import { AddView } from './components/AddView';
import { StatsMenu } from './components/StatsMenu';

/** 綜合首頁：上線時在上一層路徑；開發時是另一個 port */
const HOME_URL = import.meta.env.DEV ? `http://${location.hostname}:5172/` : '../';

export type MainTab = 'add' | 'calendar' | 'stats' | 'more';
export type Tab = MainTab | 'body' | 'bodyForm' | 'bp' | 'glucose' | 'temp' | 'lab' | 'occ' | 'occStats' | 'settings' | 'issues';
export type VitalTab = 'bp' | 'glucose' | 'temp';
/** 輸入畫面存好 / 取消後回到哪裡；home = 綜合首頁（從首頁點某一筆進來的） */
export type Back = Tab | 'home';
export type RecordKind = 'body' | 'bp' | 'glucose' | 'temp' | 'occ' | 'lab';
type VitalRecord = BloodPressure | BloodGlucose | Temperature;

/** 2026-11-22 使用者決定：健康使用新增、日曆、統計、更多四個共用分頁。 */
const TABS: AppTabItem<MainTab>[] = [
  { key: 'add', icon: 'plus', label: '新增' },
  { key: 'calendar', icon: 'calendar', label: '日曆' },
  { key: 'stats', icon: 'chart', label: '統計' },
  { key: 'more', icon: 'more', label: '更多' },
];

function requestedDate() {
  const value = new URLSearchParams(location.search).get('date');
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= todayKey() ? value : todayKey();
}

function timeForDate(date: string) {
  const now = Date.now();
  return date === todayKey() ? now : startOfDay(date) + (now - startOfDay(todayKey()));
}

/** 網址 #new（記體重）、#bp、#glucose、#temp → 直接打開輸入畫面；#edit/種類/id → 讀完資料後打開那一筆（見 pendingEdit） */
function fromHash(): { tab: Tab; form: boolean } {
  const h = location.hash.slice(1);
  if (h === 'new') return { tab: 'bodyForm', form: false };
  if (h === 'bp' || h === 'glucose' || h === 'temp') return { tab: h, form: true };
  return { tab: 'calendar', form: false };
}

/** 健檢頁：看某一份報告 / 新增或修改報告；null = 列表 */
export type LabOpen = { mode: 'detail'; id: string } | { mode: 'form'; id: string | null; date?: string } | { mode: 'items' } | { mode: 'stats' } | null;

export interface VitalForm {
  /** null = 新增 */
  rec: VitalRecord | null;
  /** 從月曆新增時，預設使用所選日期。 */
  initialTime?: number;
  /** 體溫：新增時預設的種類 */
  tempKind?: TempKind;
}

/** 回綜合首頁（?local 本機測試模式一起帶回去） */
const goHome = () => {
  location.href = HOME_URL + location.search;
};

export function App() {
  const api = useHealth();
  const initialDate = requestedDate();
  const [tab, setTabState] = useState<Tab>(() => fromHash().tab);
  /** 正在修改的身體量測（null = 新增） */
  const [editing, setEditing] = useState<BodyMeasurement | null>(null);
  const [newBodyTime, setNewBodyTime] = useState<number | null>(() => fromHash().tab === 'bodyForm' ? timeForDate(initialDate) : null);
  /** 血壓、血糖、體溫的輸入畫面（null = 看列表） */
  const [vitalForm, setVitalForm] = useState<VitalForm | null>(() => (fromHash().form ? { rec: null, initialTime: timeForDate(initialDate) } : null));
  /** 總覽看的日期（去修改再回來時保留） */
  const [overviewDate, setOverviewDate] = useState(initialDate);
  /** 身體尺寸畫面要先填的項目（例：BMI 不同時按「改身高」） */
  const [focusItem, setFocusItem] = useState<string | null>(null);
  const [occInitialTime, setOccInitialTime] = useState<number | null>(null);
  /** 輸入畫面存好 / 取消後回到哪裡（從總覽打開的回總覽；沒有就回那一種的列表） */
  const [formBack, setFormBack] = useState<Back | null>(null);
  const [labOpen, setLabOpen] = useState<LabOpen>(null);
  const [settingSection, setSettingSection] = useState<HealthSettingSection>('body');
  /** 從綜合首頁點某一筆進來：資料讀好後打開它 */
  const [pendingEdit, setPendingEdit] = useState(() => parseEditHash(location.hash));

  useEffect(() => {
    const onHash = () => {
      const h = fromHash();
      setEditing(null);
      const selected = requestedDate();
      setNewBodyTime(h.tab === 'bodyForm' ? timeForDate(selected) : null);
      setVitalForm(h.form ? { rec: null, initialTime: timeForDate(selected) } : null);
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
    setLabOpen(null);
    setFormBack(null);
    setTabState(t);
    window.scrollTo(0, 0);
  };

  const nav: Nav = {
    edit: (m, back = null) => {
      setTab('bodyForm');
      setEditing(m);
      setNewBodyTime(null);
      setFormBack(back);
    },
    newBody: (back = null, initialTime = Date.now()) => {
      setTab('bodyForm');
      setEditing(null);
      setNewBodyTime(initialTime);
      setFormBack(back);
    },
    closeBody: () => (formBack === 'home' ? goHome() : setTab(formBack ?? 'body')),
    occ: (item = null, initialTime, back = null) => {
      setTab('occ');
      setFocusItem(item);
      setOccInitialTime(initialTime ?? null);
      setFormBack(back);
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
        : kind === 'lab' ? find(snap.labReports)
        : find(snap.occ);
      if (!rec) {
        api.showToast({ kind: 'error', text: '找不到這一筆（可能已經刪除）' });
        return false;
      }
      if (kind === 'body') nav.edit(rec as BodyMeasurement, back);
      else if (kind === 'occ') nav.occ();
      else if (kind === 'lab') nav.lab({ mode: 'detail', id }, back);
      else nav.vital(kind, { rec: rec as VitalRecord }, back);
      return true;
    },
    lab: (open, back = null) => {
      setTab('lab');
      setLabOpen(open);
      setFormBack(back);
    },
    /** 健檢：報告 / 輸入畫面 → 回去（從別處打開的回原處） */
    closeLab: (to = null) => {
      if (to && formBack === 'calendar') return setTab('calendar');
      if (to) return setLabOpen(to);
      if (formBack === 'home') return goHome();
      if (formBack) return setTab(formBack);
      setLabOpen(null);
      window.scrollTo(0, 0);
    },
    go: setTab,
  };

  useEffect(() => {
    if (!pendingEdit || !api.snap) return;
    setPendingEdit(null);
    if (pendingEdit.kind !== 'water' && pendingEdit.kind !== 'bowel' && pendingEdit.kind !== 'money') nav.openRecord(pendingEdit.kind, pendingEdit.id, 'home');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEdit, api.snap]);

  const active: MainTab =
    tab === 'bodyForm' || tab === 'occ' || vitalForm !== null || labOpen?.mode === 'form' ? 'add'
    : tab === 'lab' && formBack === 'more' ? 'more'
    : tab === 'body' || tab === 'bp' || tab === 'glucose' || tab === 'temp' || tab === 'lab' || tab === 'occStats' ? 'stats'
    : tab === 'settings' || tab === 'issues' ? 'more'
    : tab;
  const vitalKey = vitalForm ? (vitalForm.rec?.id ?? `new-${vitalForm.tempKind ?? ''}`) : 'list';
  const changeAddKind = () => {
    if (confirm('目前輸入的內容不會儲存，確定要更換項目嗎？')) setTab('add');
  };

  return (
    <div className="app">
      <header className="topbar">
        <AppSwitcher
          current="health"
          homeUrl={HOME_URL}
          date={overviewDate}
          confirmLeave={tab === 'bodyForm' || vitalForm !== null || labOpen?.mode === 'form' || tab === 'occ' || tab === 'settings'}
        />
        <h1>健康</h1>
        <AppTabs items={TABS} current={active} onChange={setTab} placement="top" />
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
            {tab === 'add' && <AddView snap={api.snap} nav={nav} date={overviewDate} setDate={setOverviewDate} />}
            {tab === 'calendar' && <OverviewView api={api} snap={api.snap} nav={nav} date={overviewDate} setDate={setOverviewDate} />}
            {tab === 'stats' && <StatsMenu nav={nav} />}
            {tab === 'body' && <StatsSubpage onBack={() => setTab('stats')}><BodyTab api={api} snap={api.snap} /></StatsSubpage>}
            {tab === 'bodyForm' && <>{!editing && <button type="button" className="link more-back" onClick={changeAddKind}>更換項目</button>}<BodyView key={editing?.id ?? `new-${newBodyTime ?? ''}`} api={api} snap={api.snap} editing={editing} initialTime={newBodyTime ?? undefined} nav={nav} /></>}
            {tab === 'bp' && <>{vitalForm && !vitalForm.rec && <button type="button" className="link more-back" onClick={changeAddKind}>更換項目</button>}{vitalForm ? <BpView key={vitalKey} api={api} snap={api.snap} nav={nav} form={vitalForm} /> : <StatsSubpage onBack={() => setTab('stats')}><BpView key={vitalKey} api={api} snap={api.snap} nav={nav} form={vitalForm} /></StatsSubpage>}</>}
            {tab === 'glucose' && <>{vitalForm && !vitalForm.rec && <button type="button" className="link more-back" onClick={changeAddKind}>更換項目</button>}{vitalForm ? <GlucoseView key={vitalKey} api={api} snap={api.snap} nav={nav} form={vitalForm} /> : <StatsSubpage onBack={() => setTab('stats')}><GlucoseView key={vitalKey} api={api} snap={api.snap} nav={nav} form={vitalForm} /></StatsSubpage>}</>}
            {tab === 'temp' && <>{vitalForm && !vitalForm.rec && <button type="button" className="link more-back" onClick={changeAddKind}>更換項目</button>}{vitalForm ? <TempView key={vitalKey} api={api} snap={api.snap} nav={nav} form={vitalForm} /> : <StatsSubpage onBack={() => setTab('stats')}><TempView key={vitalKey} api={api} snap={api.snap} nav={nav} form={vitalForm} /></StatsSubpage>}</>}
            {tab === 'lab' && <>{labOpen?.mode === 'form' && !labOpen.id && <button type="button" className="link more-back" onClick={changeAddKind}>更換項目</button>}<LabView key={labOpen ? `${labOpen.mode}-${'id' in labOpen ? labOpen.id ?? '' : ''}` : 'list'} api={api} snap={api.snap} nav={nav} open={labOpen} /></>}
            {tab === 'more' && <MoreView snap={api.snap} nav={nav} onSettings={(section) => { setSettingSection(section); setTab('settings'); }} />}
            {tab === 'occ' && <><button type="button" className="link more-back" onClick={changeAddKind}>更換項目</button><OccView key={`${focusItem ?? ''}-${occInitialTime ?? ''}`} api={api} snap={api.snap} focusItem={focusItem} initialTime={occInitialTime ?? undefined} onDone={nav.closeForm} /></>}
            {tab === 'occStats' && <StatsSubpage onBack={() => setTab('stats')}><OccView api={api} snap={api.snap} focusItem={null} mode="stats" /></StatsSubpage>}
            {tab === 'settings' && <SettingsView api={api} snap={api.snap} section={settingSection} onBack={() => setTab('more')} />}
            {tab === 'issues' && <IssuesView api={api} snap={api.snap} nav={nav} onDone={() => setTab('more')} />}
          </>
        ) : null}
      </main>

      <AppTabs items={TABS} current={active} onChange={setTab} placement="bottom" />

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

function StatsSubpage({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return <div><button type="button" className="link more-back" onClick={onBack}><Icon name="left" size={18} /> 返回健康統計</button>{children}</div>;
}

export type Nav = {
  /** back：存好 / 取消後回到哪個分頁（預設回身體） */
  edit: (m: BodyMeasurement, back?: Back | null) => void;
  newBody: (back?: Back | null, initialTime?: number) => void;
  /** 身體量測輸入畫面 → 回去 */
  closeBody: () => void;
  occ: (item?: string | null, initialTime?: number, back?: Back | null) => void;
  /** 打開血壓 / 血糖 / 體溫；有 form 就直接進輸入畫面 */
  vital: (t: VitalTab, form?: VitalForm, back?: Back | null) => void;
  /** 健檢頁：打開報告 / 輸入畫面 */
  lab: (open: LabOpen, back?: Back | null) => void;
  /** 健檢頁回去；to = 改成打開另一個畫面（例：存好後看報告） */
  closeLab: (to?: LabOpen) => void;
  /** 打開某一筆的修改畫面；找不到回傳 false */
  openRecord: (kind: RecordKind, id: string, back: Back | null) => boolean;
  /** 輸入畫面 → 回列表 */
  closeForm: () => void;
  go: (t: Tab) => void;
};
