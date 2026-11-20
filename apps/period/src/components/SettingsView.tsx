import { useState } from 'react';
import type { ConditionItem, ConditionSnapshot, PeriodSettings, PeriodSnapshot } from '@life/db';
import type { PeriodApi } from '../usePeriod';

export function SettingsView({ api, snap, conditions }: { api: PeriodApi; snap: PeriodSnapshot; conditions: ConditionSnapshot }) {
  const [settings, setSettings] = useState<PeriodSettings>(snap.settings);
  const [newItem, setNewItem] = useState('');
  const set = <K extends keyof PeriodSettings>(key: K, value: PeriodSettings[K]) => setSettings({ ...settings, [key]: value });
  const issues = [...snap.issues, ...conditions.issues];
  return <div className="settings">
    <section className="card"><h2>週期與預測</h2>
      <div className="two-cols"><label className="field">預設週期天數<input type="number" min="1" max="365" value={settings.defaultCycleDays ?? ''} onChange={(e) => set('defaultCycleDays', e.target.value ? Number(e.target.value) : null)} placeholder="資料不足時使用" /></label><label className="field">預設經期天數<input type="number" min="1" max="60" value={settings.defaultPeriodDays ?? ''} onChange={(e) => set('defaultPeriodDays', e.target.value ? Number(e.target.value) : null)} placeholder="資料不足時使用" /></label></div>
      <label className="check"><input type="checkbox" checked={settings.ovulationEnabled} onChange={(e) => set('ovulationEnabled', e.target.checked)} />在月曆顯示估計排卵日與易孕期</label>
      {settings.ovulationEnabled && <label className="field">黃體期天數<input type="number" min="1" max="30" value={settings.lutealPhaseDays} onChange={(e) => set('lutealPhaseDays', Number(e.target.value))} /></label>}
      <p className="muted small">有至少 3 個有效週期間隔後，預測會改用最近最多 6 個實際週期的中間值；你的設定仍會保留。</p>
    </section>
    <section className="card"><h2>提醒</h2>
      <label className="check"><input type="checkbox" checked={settings.upcomingReminderEnabled} onChange={(e) => set('upcomingReminderEnabled', e.target.checked)} />經期將至</label>
      {settings.upcomingReminderEnabled && <label className="field">提前幾天<input type="number" min="0" max="30" value={settings.upcomingReminderDaysBefore} onChange={(e) => set('upcomingReminderDaysBefore', Number(e.target.value))} /></label>}
      <label className="check"><input type="checkbox" checked={settings.startDatePromptEnabled} onChange={(e) => set('startDatePromptEnabled', e.target.checked)} />預計開始日詢問是否已經來了</label>
      <label className="check"><input type="checkbox" checked={settings.suppliesReminderEnabled} onChange={(e) => set('suppliesReminderEnabled', e.target.checked)} />提前 3 天提醒準備生理用品</label>
      <p className="muted small">第一版只顯示在生理期 APP，不使用瀏覽器通知或手機推播。</p>
      <button className="primary" disabled={api.busy} onClick={() => void api.run(async (p) => { await p.saveSettings(settings); return true; }).then((ok) => ok && api.showToast('設定已儲存'))}>儲存設定</button>
    </section>
    <section className="card"><h2>生理期的身體狀況</h2><p className="muted small">這裡只管理生理期 APP 是否顯示，不會出現健康或廁所大事的勾選設定。</p>
      <ul className="condition-admin">{conditions.items.filter((i) => !i.archived).map((item) => <ConditionItemRow key={item.id} api={api} item={item} />)}</ul>
      <div className="row"><input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="新增症狀名稱" /><button disabled={!newItem.trim() || api.busy} onClick={() => void api.run(async (_p, c) => { await c.addItem(newItem); return true; }).then((ok) => ok && setNewItem(''))}>新增</button></div>
    </section>
    {issues.length > 0 && <section className="card issues"><h2>試算表有 {issues.length} 列需要修正</h2><p className="muted small">APP 不會自動刪除、合併或改寫這些內容，請依列數回試算表修正。</p>{issues.map((x) => <div className="issue-row" key={`${x.table}-${x.rowNumber}`}><strong>{x.table} 第 {x.rowNumber} 列</strong><ul className="problems">{x.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>)}</section>}
    <section className="card"><h2>試算表</h2><div className="editor-actions">{api.periodFileUrl() && <a className="btn" href={api.periodFileUrl()!} target="_blank" rel="noreferrer">開啟生理期試算表</a>}{api.healthFileUrl() && <a className="btn" href={api.healthFileUrl()!} target="_blank" rel="noreferrer">開啟健康試算表</a>}</div><p className="muted small">補舊資料時，一列填一次經期的開始日與結束日即可，其他欄位可留白。</p></section>
  </div>;
}

function ConditionItemRow({ api, item }: { api: PeriodApi; item: ConditionItem }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  return <li>{editing ? <div className="row grow"><input value={name} onChange={(e) => setName(e.target.value)} aria-label="症狀名稱" /><button className="primary" disabled={!name.trim() || api.busy} onClick={() => void api.run(async (_p, c) => { await c.updateItem(item, { name }); return true; }).then((ok) => ok && setEditing(false))}>儲存</button><button onClick={() => { setName(item.name); setEditing(false); }}>取消</button></div> : <><label className="check"><input type="checkbox" checked={item.showInPeriod} onChange={(e) => void api.run((_p, c) => c.updateItem(item, { showInPeriod: e.target.checked }))} />{item.name}</label><span className="row"><button className="link" onClick={() => setEditing(true)}>改名</button><button className="link danger-text" onClick={() => { if (confirm(`刪除「${item.name}」？歷史紀錄會保留。`)) void api.run((_p, c) => c.deleteItem(item)); }}>刪除</button></span></>}</li>;
}
