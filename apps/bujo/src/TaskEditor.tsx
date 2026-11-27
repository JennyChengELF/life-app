import { useState } from 'react';
import { parseDateText, type BujoSchedule, type BujoTask } from '@life/db';
import { TagPicker } from '@life/ui/tag-picker';
import { TimeField } from '@life/ui/time-field';
import { PeopleFields } from '@life/ui/people-fields';
import type { BujoApi } from './useBujo';

export const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export function TaskEditor({ api, date, task, schedule, onDirty, onClose, onSaved }: {
  api: BujoApi;
  date: string;
  task?: BujoTask;
  schedule?: BujoSchedule;
  onDirty: () => void;
  onClose: () => void;
  onSaved: (date?: string) => void;
}) {
  const initial = task ?? schedule;
  const [kind, setKind] = useState<'one' | 'weekly'>(schedule ? 'weekly' : 'one');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [tags, setTags] = useState(initial?.tagIds ?? []);
  const [organizationId, setOrganizationId] = useState(initial?.organizationId ?? '');
  const [place, setPlace] = useState(initial?.place ?? '');
  const [peopleIds, setPeopleIds] = useState(initial?.peopleIds ?? []);
  const [startDate, setStartDate] = useState(task?.startDate ?? date);
  const [dueDate, setDueDate] = useState(task?.dueDate ?? date);
  const [weekday, setWeekday] = useState(schedule?.weekday ?? new Date(`${date}T00:00:00`).getDay());
  const [time, setTime] = useState(schedule?.time ?? '00:00');
  const weekly = kind === 'weekly';

  const save = async () => {
    const fields = { title, note, tagIds: tags, organizationId, place: organizationId ? '' : place, peopleIds };
    const saved = weekly
      ? await api.save(() => api.store.saveSchedule({ ...fields, weekday, time }, schedule?.seriesId))
      : await api.save(() => api.store.saveTask({ ...fields, startDate, dueDate }, task));
    if (saved) onSaved(weekly ? undefined : parseDateText(startDate) ?? undefined);
  };

  const organizations = api.snap?.organizations ?? [];
  const choices = organizations.filter((org) => !org.archived || org.id === organizationId);
  return <section className="card bujo-editor">
    <h2>{schedule ? '修改重複待辦' : task ? '修改待辦' : '新增待辦'}</h2>
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} onChange={onDirty}>
      <fieldset className="bujo-fields" disabled={api.busy}>
        {!initial && <fieldset className="bujo-type">
          <legend>待辦類型</legend>
          <div className="bujo-choice">
            <label><input type="radio" name="kind" checked={!weekly} onChange={() => setKind('one')} /> 一般待辦</label>
            <label><input type="radio" name="kind" checked={weekly} onChange={() => setKind('weekly')} /> 每週重複</label>
          </div>
        </fieldset>}
        <label className="field">待辦名稱<input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
        {weekly ? <div className="bujo-columns">
          <label className="field">每週出現日<select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
            {weekdays.map((label, index) => <option key={label} value={index}>{label}</option>)}
          </select></label>
          <TimeField label="出現時間" value={time} onChange={setTime} showNow={false} />
        </div> : <div className="bujo-columns">
          <label className="field">開始日<input type="date" required value={startDate} onChange={(e) => {
            const next = e.target.value;
            if (dueDate === startDate || (next && next > dueDate)) setDueDate(next);
            setStartDate(next);
          }} /></label>
          <label className="field">到期日<input type="date" required min={startDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
        </div>}
        <div className="bujo-columns">
          <label className="field">地點／機構<select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>
            <option value="">選擇共用機構</option>
            {organizationId && !choices.some(({ id }) => id === organizationId) && <option value={organizationId}>找不到的機構</option>}
            {choices.map((org) => <option key={org.id} value={org.id}>{org.name}{org.archived ? '（已停用）' : ''}</option>)}
          </select></label>
          {!organizationId && <label className="field">自訂地點<input value={place} onChange={(e) => setPlace(e.target.value)} /></label>}
        </div>
        <label className="field">備註<textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <PeopleFields people={api.snap?.calendar.people ?? []} selected={peopleIds}
          onChange={(ids) => { setPeopleIds(ids); onDirty(); }} busy={api.busy} />
        <TagPicker tags={api.snap?.tags ?? []} selected={tags} busy={api.busy}
          onChange={(ids) => { setTags(ids); onDirty(); }} onAdd={api.addTag} />
      </fieldset>
      <div className="bujo-actions">
        <button className="link" type="button" onClick={onClose} disabled={api.busy}>取消</button>
        <button className="primary" type="submit" disabled={api.busy}>儲存</button>
      </div>
    </form>
  </section>;
}
