import { useEffect, useState } from 'react';
import type { ConditionLogDraft, ConditionSeverity, ConditionSnapshot, PeriodCycle, PeriodDay, PeriodSnapshot } from '@life/db';
import {
  CONDITION_SEVERITIES,
  cycleDifference,
  dateDiff,
  durationDifference,
  estimatedCycleEnd,
  isDateInCycle,
  PERIOD_CLOTS,
  PERIOD_COLORS,
  PERIOD_FLOWS,
  predictPeriod,
  projectPeriods,
  todayKey,
} from '@life/db';
import { Icon } from '@life/ui/icon';
import { DateNav } from '@life/ui/timeline';
import type { PeriodApi } from '../usePeriod';

interface DraftCondition extends ConditionLogDraft {
  key: string;
  expanded: boolean;
}

export function TodayView({ api, snap, conditions, date, setDate, goSettings }: { api: PeriodApi; snap: PeriodSnapshot; conditions: ConditionSnapshot; date: string; setDate: (d: string) => void; goSettings: () => void }) {
  const today = todayKey();
  const prediction = predictPeriod(snap);
  const sortedCycles = [...snap.cycles].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const lastCycle = sortedCycles.at(-1) ?? null;
  const ongoing = lastCycle && !lastCycle.endDate ? lastCycle : null;
  const completedCycle = sortedCycles.find((c) => !!c.endDate && isDateInCycle(date, c)) ?? null;
  const pendingCycle = [...sortedCycles].reverse().find((c, reverseIndex) => {
    if (c.endDate || date < c.startDate) return false;
    const originalIndex = sortedCycles.length - 1 - reverseIndex;
    const nextStart = sortedCycles[originalIndex + 1]?.startDate ?? null;
    return !nextStart || date < nextStart;
  }) ?? null;
  const selectedCycle = completedCycle ?? pendingCycle;
  const projections = date > today ? projectPeriods(snap, date) : [];
  const projectedPeriod = projections.find((x) => date >= x.startDate && date <= x.endDate) ?? null;
  const projectedStarts = projections.filter((x) => x.startDate <= date).map((x) => x.startDate);
  const predictionBase = projectedStarts.at(-1) ?? lastCycle?.startDate ?? null;
  const predictionLabel = date > today
    ? projectedPeriod
      ? `預計經期第 ${dateDiff(projectedPeriod.startDate, date) + 1} 天`
      : predictionBase ? `預測週期第 ${dateDiff(predictionBase, date) + 1} 天` : null
    : null;
  const latest = snap.cycles[snap.cycles.length - 1] ?? null;
  const [editorDirty, setEditorDirty] = useState(false);
  const messages: string[] = [];
  if (prediction) {
    const until = dateDiff(today, prediction.nextStart);
    if (until === 0 && snap.settings.startDatePromptEnabled) messages.push('預計今天開始，是否已經來了？');
    else if (snap.settings.upcomingReminderEnabled && until >= 0 && until <= snap.settings.upcomingReminderDaysBefore) messages.push(until === 0 ? '預計今天開始' : `預計 ${until} 天後開始`);
    if (snap.settings.suppliesReminderEnabled && until >= 0 && until <= 3) messages.push('可以準備生理用品');
  }
  const cd = latest ? cycleDifference(snap.cycles, latest) : null;
  const dd = latest ? durationDifference(snap.cycles, latest) : null;
  if (cd) messages.push(`這次和你平常不同，時間比平均週期 ${cd.average} 天${cd.direction === 'longer' ? '長' : '短'} ${cd.difference} 天`);
  if (dd) messages.push(`這次和你平常不同，經期比平均 ${dd.average} 天${dd.direction === 'longer' ? '長' : '短'} ${dd.difference} 天`);

  let status = '還沒有足夠資料預測';
  if (ongoing && today >= ongoing.startDate) status = `經期第 ${dateDiff(ongoing.startDate, today) + 1} 天`;
  else if (prediction) {
    const diff = dateDiff(today, prediction.nextStart);
    status = diff > 0 ? `預計 ${diff} 天後開始` : diff === 0 ? '預計今天開始' : `原預測 ${prediction.nextStart.replaceAll('-', '/')}，目前晚 ${Math.abs(diff)} 天`;
  }

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!editorDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editorDirty]);

  const changeDate = (next: string) => {
    if (next === date) return;
    if (editorDirty && !confirm('這天的紀錄尚未儲存，確定要離開嗎？')) return;
    setDate(next);
  };
  const startToday = async () => {
    if (date !== today && editorDirty && !confirm('這天的紀錄尚未儲存，確定要改記今天嗎？')) return;
    setDate(today);
    const ok = await api.run(async (p) => { await p.addCycle(today); return true; });
    if (ok) api.showToast('已將今天設為經期開始日');
  };

  return <>
    <section className="card status-card compact-status">
      <div className="status-label">目前狀態</div><div className="status-value">{status}</div>
      {!prediction && <button className="link" onClick={goSettings}>設定週期與經期天數</button>}
      {!ongoing && <button className="primary status-action" disabled={api.busy} onClick={() => void startToday()}>今天經期開始</button>}
    </section>
    {messages.length > 0 && <div className="messages">{messages.map((m) => <div className="msg info" key={m}>{m}</div>)}</div>}
    <DateNav date={date} setDate={changeDate} />
    <PeriodControlCard api={api} date={date} cycle={selectedCycle} cycles={snap.cycles} settings={snap.settings} />
    <DailyDetails api={api} conditions={conditions} date={date} cycle={selectedCycle} predictionLabel={predictionLabel} day={snap.days.find((x) => x.date === date) ?? null} onDirtyChange={setEditorDirty} />
  </>;
}

function PeriodControlCard({ api, date, cycle, cycles, settings }: { api: PeriodApi; date: string; cycle: PeriodCycle | null; cycles: PeriodCycle[]; settings: PeriodSnapshot['settings'] }) {
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(cycle?.startDate ?? date);
  const [end, setEnd] = useState(cycle?.endDate ?? '');
  const [note, setNote] = useState(cycle?.note ?? '');
  useEffect(() => {
    setEditing(false);
    setStart(cycle?.startDate ?? date);
    setEnd(cycle?.endDate ?? '');
    setNote(cycle?.note ?? '');
  }, [cycle?.id, cycle?.startDate, cycle?.endDate, cycle?.note, date]);

  const startPeriod = async () => {
    const ok = await api.run(async (p) => { await p.addCycle(date); return true; });
    if (ok) api.showToast(`已將 ${formatDate(date)} 設為經期開始日`);
  };
  const endPeriod = async () => {
    if (!cycle) return;
    const ok = await api.run(async (p) => { await p.updateCycle(cycle, { endDate: date }); return true; });
    if (ok) api.showToast(`已將 ${formatDate(date)} 設為經期最後一天`);
  };

  if (editing && cycle) return <section className="card cycle-card"><h2>修改正式經期</h2>
    <div className="two-cols"><label className="field">開始日<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label><label className="field">最後一天<input type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} /></label></div>
    <label className="field">整次備註<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
    <div className="editor-actions"><button className="primary" disabled={!start || (!!end && end < start) || api.busy} onClick={() => void api.run(async (p) => { await p.updateCycle(cycle, { startDate: start, endDate: end || null, note }); return true; }).then((ok) => ok && setEditing(false))}>儲存</button><button onClick={() => setEditing(false)}>取消</button><button className="danger" onClick={() => { if (confirm('刪除這次正式經期？每日出血與身體狀況會保留。')) void api.run((p) => p.deleteCycle(cycle)); }}>刪除這次經期</button></div>
  </section>;

  const canStart = !cycle && date <= todayKey();
  const canEnd = !!cycle && !cycle.endDate && date >= cycle.startDate && date <= todayKey();
  return <section className="card period-control-card">
    <div className="section-title-row"><h2>經期</h2>{cycle && <button className="icon-btn subtle" aria-label="修改經期起訖" title="修改經期起訖" onClick={() => setEditing(true)}><Icon name="pencil" size={19} /></button>}</div>
    {canStart && <button className="period-state-btn start" disabled={api.busy} onClick={() => void startPeriod()}><span aria-hidden="true">▶</span>開始</button>}
    {canEnd && <button className="period-state-btn end" disabled={api.busy} onClick={() => void endPeriod()}><span aria-hidden="true">■</span>結束</button>}
    {cycle && !cycle.endDate && <p className="muted small estimated-end">預計結束：{formatDate(estimatedCycleEnd(cycles, settings, cycle))}（實際仍以你按「結束」的日期為準）</p>}
    {cycle?.endDate && <p className="period-range">{formatDate(cycle.startDate)} ～ {formatDate(cycle.endDate)}</p>}
    {!cycle && date > todayKey() && <p className="muted small">未來日期不能先設為經期開始。</p>}
  </section>;
}

function DailyDetails({ api, conditions, date, cycle, predictionLabel, day, onDirtyChange }: { api: PeriodApi; conditions: ConditionSnapshot; date: string; cycle: PeriodCycle | null; predictionLabel: string | null; day: PeriodDay | null; onDirtyChange: (value: boolean) => void }) {
  const items = conditions.items.filter((x) => x.showInPeriod && !x.archived);
  const currentLogs = conditions.logs.filter((x) => x.date === date && conditions.items.find((i) => i.name === x.symptom)?.showInPeriod);
  const latestWeight = conditions.weights.filter((x) => x.date === date).at(-1) ?? null;
  const toDraft = (): DraftCondition[] => currentLogs.map((x) => ({ key: x.id, id: x.id, rowNumber: x.rowNumber, symptom: x.symptom, severity: x.severity, note: x.note, time: x.time, expanded: false }));
  const [editing, setEditing] = useState(false);
  const [flow, setFlow] = useState<PeriodDay['flow']>(day?.flow ?? null);
  const [colors, setColors] = useState<PeriodDay['colors']>(day?.colors ?? []);
  const [clotSize, setClot] = useState<PeriodDay['clotSize']>(day?.clotSize ?? null);
  const [note, setNote] = useState(day?.note ?? '');
  const [drafts, setDrafts] = useState<DraftCondition[]>(toDraft);

  const reset = () => {
    setFlow(day?.flow ?? null);
    setColors(day?.colors ?? []);
    setClot(day?.clotSize ?? null);
    setNote(day?.note ?? '');
    setDrafts(toDraft());
  };
  useEffect(() => {
    setEditing(false);
    reset();
  }, [date, day?.id, day?.flow, day?.clotSize, day?.note, day?.colors.join('、'), conditions.loadedAt]);

  const originalDay = JSON.stringify({ flow: day?.flow ?? null, colors: day?.colors ?? [], clotSize: day?.clotSize ?? null, note: day?.note ?? '' });
  const editedDay = JSON.stringify({ flow, colors, clotSize, note });
  const logValues = (rows: DraftCondition[]) => rows.map(({ key: _key, expanded: _expanded, ...x }) => x);
  const originalConditions = JSON.stringify(logValues(toDraft()));
  const editedConditions = JSON.stringify(logValues(drafts));
  const dirty = editing && (originalDay !== editedDay || originalConditions !== editedConditions);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  if (!editing) return <>
    <section className="card day-summary-card">
      <div className="day-summary-heading"><div><h2>{formatLongDate(date)}</h2>{cycle ? <p className="muted small">{cycle.endDate ? `經期第 ${dateDiff(cycle.startDate, date) + 1} 天` : `經期第 ${dateDiff(cycle.startDate, date) + 1} 天・待確認結束日`}</p> : predictionLabel && <p className="muted small">{predictionLabel}</p>}</div></div>
      <dl className="day-summary-list">
        <div><dt>體重</dt><dd>{latestWeight ? `${latestWeight.kg} kg` : '沒有紀錄'}</dd></div>
        <div><dt>經血量</dt><dd>{day?.flow ?? '沒有紀錄'}</dd></div>
        <div><dt>血色</dt><dd>{day?.colors.length ? day.colors.join('、') : '沒有紀錄'}</dd></div>
        <div><dt>最大血塊</dt><dd>{day?.clotSize ?? '沒有紀錄'}</dd></div>
      </dl>
    </section>
    <section className="card"><h2>備註</h2><p className={day?.note ? '' : 'muted'}>{day?.note ?? '沒有紀錄'}</p></section>
    <section className="card"><h2>身體狀況</h2>{currentLogs.length ? <ul className="condition-summary-list">{currentLogs.map((log) => <li key={log.id}><strong>{log.symptom}</strong>{log.severity && <span>程度：{log.severity}</span>}{log.time != null && <span>時間：{formatTime(log.time)}</span>}{log.note && <span>備註：{log.note}</span>}</li>)}</ul> : <p className="muted">沒有紀錄</p>}</section>
    <button className="day-edit-fab" aria-label="編輯這天的紀錄" title="編輯這天的紀錄" onClick={() => setEditing(true)}><Icon name="pencil" size={22} /><span>編輯</span></button>
  </>;

  const toggleColor = (x: (typeof PERIOD_COLORS)[number]) => setColors(colors.includes(x) ? colors.filter((c) => c !== x) : [...colors, x]);
  const addCondition = (symptom: string) => setDrafts((rows) => [...rows, { key: `new-${Date.now()}-${rows.length}`, symptom, severity: null, note: null, time: null, expanded: false }]);
  const updateCondition = (key: string, patch: Partial<DraftCondition>) => setDrafts((rows) => rows.map((x) => x.key === key ? { ...x, ...patch } : x));
  const removeCondition = (key: string) => setDrafts((rows) => rows.filter((x) => x.key !== key));
  const hasDayContent = !!flow || colors.length > 0 || !!clotSize || !!note.trim();
  const save = async () => {
    const ok = await api.run(async (p, c) => {
      if (hasDayContent) await p.saveDay(date, { flow, colors, clotSize, note }, day ?? undefined);
      else if (day) await p.deleteDay(day);
      if (originalConditions !== editedConditions) await c.saveDayLogs(date, drafts, currentLogs);
      return true;
    });
    if (ok) {
      setEditing(false);
      api.showToast('這天的紀錄已儲存');
    }
  };
  const cancel = () => {
    if (dirty && !confirm('放棄尚未儲存的修改嗎？')) return;
    reset();
    setEditing(false);
  };

  return <>
    <section className="card"><h2>這天的出血</h2>
      <Choice label="經血量" options={PERIOD_FLOWS} value={flow} setValue={setFlow} />
      <div className="field"><span>血色（可複選）</span><div className="choice">{PERIOD_COLORS.map((x) => <button key={x} className={colors.includes(x) ? 'active' : ''} onClick={() => toggleColor(x)}>{x}</button>)}</div></div>
      <Choice label="當日最大血塊" options={PERIOD_CLOTS} value={clotSize} setValue={setClot} />
    </section>
    <section className="card"><h2>備註</h2><label className="field">這天的備註（選填）<input value={note} onChange={(e) => setNote(e.target.value)} /></label></section>
    <section className="card"><h2>身體狀況</h2>
      <div className="choice condition-choices">{items.map((item) => <button key={item.id} onClick={() => addCondition(item.name)}>{item.name}</button>)}</div>
      {drafts.length === 0 ? <p className="muted small">點選上方症狀後會新增一列；程度、時間與備註都可留白。</p>
        : <div className="condition-drafts">{drafts.map((draft) => <ConditionDraftRow key={draft.key} date={date} draft={draft} update={(patch) => updateCondition(draft.key, patch)} remove={() => removeCondition(draft.key)} />)}</div>}
    </section>
    <div className="daily-save-bar"><button onClick={cancel}>取消</button><button className="primary big" disabled={!dirty || api.busy} onClick={() => void save()}>{api.busy ? '儲存中…' : '儲存這天的紀錄'}</button>{dirty && <span className="muted small">尚未儲存</span>}</div>
  </>;
}

function ConditionDraftRow({ date, draft, update, remove }: { date: string; draft: DraftCondition; update: (patch: Partial<DraftCondition>) => void; remove: () => void }) {
  const localTime = draft.time == null ? '' : formatTime(draft.time);
  const setTime = (value: string) => update({ time: value ? new Date(`${date}T${value}`).getTime() : null });
  const hasMore = draft.time != null || !!draft.note?.trim();
  return <div className="condition-draft">
    <div className="condition-main-row"><strong>{draft.symptom}</strong><div className="choice condition-severity">{CONDITION_SEVERITIES.map((x) => <button key={x} className={draft.severity === x ? 'active' : ''} onClick={() => update({ severity: draft.severity === x ? null : x as ConditionSeverity })}>{x}</button>)}</div><button className="link more-toggle" onClick={() => update({ expanded: !draft.expanded })}>{draft.expanded ? '收合' : `更多${hasMore ? '・已填' : ''}`}</button><button className="link danger-text" onClick={remove}>移除</button></div>
    {draft.expanded && <div className="condition-more"><label className="field">時間（選填）<span className="time-row"><input type="time" value={localTime} onChange={(e) => setTime(e.target.value)} />{date === todayKey() && <button onClick={() => setTime(`${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`)}>現在</button>}</span></label><label className="field">備註（選填）<input value={draft.note ?? ''} onChange={(e) => update({ note: e.target.value })} /></label></div>}
  </div>;
}

function Choice<T extends string>({ label, options, value, setValue }: { label: string; options: readonly T[]; value: T | null; setValue: (v: T | null) => void }) {
  return <div className="field"><span>{label}</span><div className="choice">{options.map((x) => <button key={x} className={value === x ? 'active' : ''} onClick={() => setValue(value === x ? null : x)}>{x}</button>)}</div></div>;
}

const formatDate = (date: string) => date.replaceAll('-', '/');
const formatLongDate = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return `${year} 年 ${month} 月 ${day} 日`;
};
const formatTime = (time: number) => `${String(new Date(time).getHours()).padStart(2, '0')}:${String(new Date(time).getMinutes()).padStart(2, '0')}`;
