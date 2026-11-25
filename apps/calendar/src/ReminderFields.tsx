import { useState } from 'react';
import {
  addDateDays,
  CALENDAR_REMINDER_LIMITS,
  CALENDAR_REMINDER_UNITS,
  dateDiffDays,
  type CalendarReminder,
  type CalendarReminderUnit,
} from '@life/db';

export function ReminderFields({ rules, allDay, startDate, startTime, onChange }: {
  rules: CalendarReminder[];
  allDay: boolean;
  startDate: string;
  startTime: string | null;
  onChange: (rules: CalendarReminder[]) => void;
}) {
  const [open, setOpen] = useState(rules.length > 0);
  const defaultRule = (kind: CalendarReminder['kind']): CalendarReminder => {
    if (kind === 'start') return { kind };
    if (kind === 'before') return { kind, amount: 30, unit: 'minutes' };
    return { kind, dayOffset: 0, time: startTime || '09:00' };
  };
  const change = (index: number, rule: CalendarReminder) => onChange(rules.map((item, i) => i === index ? rule : item));

  return <section className="reminder-fields">
    <button type="button" className="link reminder-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>提醒{rules.length > 0 && `（${rules.length}）`}</button>
    {open && <>
      {rules.map((rule, index) => (
        <div className="reminder-rule" key={index}>
          <label className="field">提醒方式
            <select value={rule.kind} onChange={(e) => change(index, defaultRule(e.target.value as CalendarReminder['kind']))}>
              <option value="start" disabled={allDay}>行程開始時</option>
              <option value="before" disabled={allDay}>提前提醒</option>
              <option value="custom">指定日期與時間</option>
            </select>
          </label>
          {rule.kind === 'before' && <div className="form-grid">
            <label className="field">提前<input type="number" required min={1} max={CALENDAR_REMINDER_LIMITS[rule.unit]} value={rule.amount || ''} onChange={(e) => change(index, { ...rule, amount: Number(e.target.value) })} /></label>
            <label className="field">單位<select value={rule.unit} onChange={(e) => {
              const unit = e.target.value as CalendarReminderUnit;
              change(index, { ...rule, unit, amount: Math.min(rule.amount, CALENDAR_REMINDER_LIMITS[unit]) });
            }}>{Object.entries(CALENDAR_REMINDER_UNITS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          </div>}
          {rule.kind === 'custom' && <div className="form-grid">
            <label className="field">提醒日期<input type="date" required min={addDateDays(startDate, -365)} max={addDateDays(startDate, 365)} value={startDate && Number.isFinite(rule.dayOffset) ? addDateDays(startDate, rule.dayOffset) : ''} onChange={(e) => change(index, { ...rule, dayOffset: e.target.value ? dateDiffDays(startDate, e.target.value) : NaN })} /></label>
            <label className="field">提醒時間<input type="time" required value={rule.time} onChange={(e) => change(index, { ...rule, time: e.target.value })} /></label>
          </div>}
          <button type="button" className="link" onClick={() => onChange(rules.filter((_, i) => i !== index))}>移除此提醒</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rules, defaultRule(allDay ? 'custom' : 'before')])}>＋ 新增提醒</button>
    </>}
  </section>;
}
