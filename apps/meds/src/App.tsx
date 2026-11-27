import { useState } from 'react';
import { canPickMed, parseDateText, toDateKey, toHHmm, todayKey, type MedLog, type MedSnapshot } from '@life/db';
import { AppSwitcher } from '@life/ui/app-switcher';
import { AppTabs, type AppTabItem } from '@life/ui/app-tabs';
import { Icon, type IconName } from '@life/ui/icon';
import { MonthCalendar } from '@life/ui/month-calendar';
import { EntryEditor } from './EntryEditor';
import { Inventory } from './Inventory';
import { useMeds } from './useMeds';

type Tab = 'add' | 'calendar' | 'more';
type MoreSection = 'inventory' | 'combos' | 'data';
type Editor = { type: 'log' | 'combo' | 'item'; id: string };
const tabs: AppTabItem<Tab>[] = [
  { key: 'add', label: '新增', icon: 'plus' },
  { key: 'calendar', label: '日曆', icon: 'calendar' },
  { key: 'more', label: '更多', icon: 'more' },
];
const moreOptions: { key: MoreSection; label: string; icon: IconName }[] = [
  { key: 'inventory', label: '藥品與庫存', icon: 'pill' },
  { key: 'combos', label: '常用組合', icon: 'settings' },
  { key: 'data', label: '資料與試算表', icon: 'clipboard' },
];
const home = import.meta.env.DEV ? `http://${location.hostname}:5172/` : '../';

function LogList({ snap, date, open }: { snap: MedSnapshot; date: string; open: (id: string) => void }) {
  const entries = snap.logs.filter((log) => log.date === date);
  const pending = snap.logs.filter((log) => log.stockEffect === 'pending' && log.date !== date);
  const rows = (logs: MedLog[]) => <ul className="med-list">{logs.map((log) => {
    const item = snap.items.find(({ id }) => id === log.itemId);
    const batch = snap.batches.find(({ id }) => id === log.batchId);
    const actualDate = toDateKey(log.time);
    return <li key={log.id}><button type="button" className="med-list-button" onClick={() => open(log.id)}>
      <span><strong>{item?.name ?? '未辨識品項'}</strong>
        <small>{log.date !== date && `歸屬 ${log.date} · `}
          {actualDate !== log.date ? actualDate + ' ' : ''}{toHHmm(log.time)}
          {batch && ` · 批次 ${batch.receivedDate}`}
          {log.stockEffect === 'pending' && <span className="med-warn-text"> · 待補批次</span>}
          {log.skipStock && ' · 只補紀錄'}</small></span>
      <span>{log.quantity} {item?.unit}</span><Icon name="pencil" size={16} />
    </button></li>;
  })}</ul>;
  return <>
    <section className="card">
      <div className="med-row"><h2>{date} 的服用紀錄</h2>
        <button className="primary" onClick={() => open('new')}><Icon name="plus" size={17} /> 記一筆</button></div>
      {entries.length ? rows(entries) : <p className="muted">這天還沒有服用紀錄。</p>}
    </section>
    {!!pending.length && <section className="card"><h2>其他日期待補批次</h2>{rows(pending)}</section>}
  </>;
}

export function App() {
  const api = useMeds();
  const [tab, setTab] = useState<Tab>('calendar');
  const [date, setDate] = useState(() => parseDateText(new URLSearchParams(location.search).get('date') ?? '') ?? todayKey());
  const [more, setMore] = useState<MoreSection | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [addDirty, setAddDirty] = useState(false);
  const edit = (type: Editor['type'], id: string) => {
    setEditor({ type, id });
    window.scrollTo(0, 0);
  };
  const close = () => setEditor(null);
  const finishAdd = () => {
    setAddDirty(false);
    setTab('calendar');
    window.scrollTo(0, 0);
  };
  const changeTab = (next: Tab) => {
    if (next === tab || api.busy) return;
    if ((editor || addDirty) && !confirm('要離開目前的編輯畫面嗎？')) return;
    close();
    setAddDirty(false);
    setMore(null);
    setTab(next);
    window.scrollTo(0, 0);
  };
  const snap = api.snap;
  // （2026-11-26 使用者決定：日曆依歸屬日期標記有服用紀錄的日子。）
  const recordedDates = new Set(snap?.logs.map((log) => log.date));
  const openLog = (id: string) => id === 'new' ? changeTab('add') : edit('log', id);

  return <div className="app meds-app">
    <header className="topbar">
      <AppSwitcher current="meds" homeUrl={home} date={date} confirmLeave={!!editor || addDirty} />
      <h1>用藥記錄</h1>
      <AppTabs items={tabs} current={tab} placement="top" onChange={changeTab} />
      {api.status === 'ready' && <button type="button" className="icon-btn" onClick={() => void api.refresh()} disabled={api.busy || !!editor || addDirty}
        aria-label="重新整理"><Icon name="refresh" /></button>}
    </header>
    {api.local && <div className="mode-banner">本機測試模式 · 資料存在這個瀏覽器</div>}
    {api.notice && <p className="med-notice" role="status">{api.notice}</p>}
    {api.error && <p className="med-error" role="alert">{api.error}</p>}
    <main aria-busy={api.busy}>
      {api.status === 'loading' && <p className="center muted">讀取中⋯⋯</p>}
      {api.status === 'connect' && <section className="card center">
        <p>連線後會把資料存到你的「生活APP-用藥記錄」試算表。</p>
        <button type="button" className="primary" disabled={api.busy} onClick={() => void api.connect()}>連線 Google</button>
      </section>}
      {api.status === 'error' && <div className="center"><button className="primary" onClick={() => location.reload()}>重新載入</button></div>}
      {api.status === 'ready' && snap && <>
        {tab === 'add' ? <EntryEditor key="add" api={api} snap={snap} date={date} editingCombo={false}
          onDateChange={setDate} onDirtyChange={setAddDirty} onClose={finishAdd}
          onSaved={(savedDate) => { setDate(savedDate); finishAdd(); }} />
        : editor && editor.type !== 'item' ? <EntryEditor key={`${editor.type}:${editor.id}`} api={api} snap={snap} date={date}
          log={editor.type === 'log' ? snap.logs.find(({ id }) => id === editor.id) : undefined}
          combo={editor.type === 'combo' ? snap.combos.find(({ id }) => id === editor.id) : undefined}
          editingCombo={editor.type === 'combo'} onClose={close}
          onSaved={(savedDate) => { if (editor.type === 'log') setDate(savedDate); close(); }} /> : <>
          {tab === 'calendar' && <>
            <MonthCalendar selected={date} setDate={setDate} dayInfo={(day) => recordedDates.has(day)
              ? { label: '有服用紀錄', marks: [{ kind: 'dot' }] } : null} />
            <LogList snap={snap} date={date} open={openLog} />
          </>}
          {tab === 'more' && !more && <nav className="med-more" aria-label="更多功能">
            {moreOptions.map(({ key, label, icon }) => (
              <button key={key} type="button" onClick={() => setMore(key)}>
                <Icon name={icon} /><span>{label}</span><Icon name="right" size={17} />
              </button>
            ))}
          </nav>}
          {tab === 'more' && more && !editor && <button className="link med-more-back" type="button" onClick={() => setMore(null)}>
            <Icon name="left" size={17} /> 返回更多
          </button>}
          {tab === 'more' && more === 'inventory' && <Inventory api={api} snap={snap} edit={editor?.id ?? null}
            open={(id) => edit('item', id)} close={close} />}
          {tab === 'more' && more === 'combos' &&
            <section className="card">
              <div className="med-row"><h2>常用組合</h2><button className="primary" onClick={() => edit('combo', 'new')}><Icon name="plus" size={17} /> 新增組合</button></div>
              {!snap.combos.length ? <p className="muted">可以建立平日、假日或睡前常一起服用的品項。</p> : <ul className="med-list">
                {snap.combos.map((combo) => {
                  const items = snap.items.filter((item) => combo.entries.some((entry) => entry.itemId === item.id));
                  const low = items.filter((item) => !canPickMed(item));
                  return <li key={combo.id}><button type="button" className="med-list-button" onClick={() => edit('combo', combo.id)}>
                    <span><strong>{combo.name}</strong><small>{items.map((item) => item.name).join('、')}</small>
                      {!!low.length && <small className="med-warn-text">庫存不足：{low.map((item) => item.name).join('、')}，請檢查組合</small>}</span>
                    <Icon name="pencil" size={16} />
                  </button></li>;
                })}
              </ul>}
            </section>
          }
          {tab === 'more' && more === 'data' && <section className="card"><h2>資料與試算表</h2>
              {api.fileUrl && <a href={api.fileUrl} target="_blank" rel="noreferrer">開啟用藥記錄試算表</a>}
              {api.local && <p className="muted">本機測試資料存在這個瀏覽器。</p>}
              {!!snap.issues.length && <details><summary>需要處理的資料（{snap.issues.length}）</summary>
                <ul>{snap.issues.map((issue) => <li key={`${issue.table}-${issue.rowNumber}`}>{issue.table} 第 {issue.rowNumber} 列：{issue.problem}</li>)}</ul>
              </details>}
          </section>}
        </>}
      </>}
    </main>
    <AppTabs items={tabs} current={tab} placement="bottom" onChange={changeTab} />
  </div>;
}
