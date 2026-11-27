import type { Backend, RowUpdate, TableRow } from './backend';
import { CalendarStore, type CalendarSnapshot } from './calendar';
import { bujoCalendarOccurrences, type BujoCalendarCompletion } from './bujo-calendar';
import { newId } from './ids';
import { loadSharedTags, readTagIds, writeTagIds } from './shared-tags';
import { addDays, endOfDay, parseDateText, parseDateTimeText, startOfDay, toDateKey } from './time';

export interface BujoFields {
  title: string;
  note: string;
  tagIds: string[];
  place?: string;
  organizationId?: string | null;
  peopleIds?: string[];
}

interface StoredRow {
  id: string;
  rowNumber: number;
}

export interface BujoTaskInput extends BujoFields {
  startDate: string;
  dueDate: string;
}

export interface BujoScheduleInput extends BujoFields {
  weekday: number;
  time: string;
}

export interface BujoTask extends BujoTaskInput, StoredRow {
  completedDate: string | null;
}

export interface BujoSchedule extends BujoScheduleInput, StoredRow {
  seriesId: string;
  effectiveAt: number;
  stopped: boolean;
}

interface BujoCompletion extends StoredRow {
  scheduleId: string;
  occurrenceDate: string;
  completedDate: string | null;
}

export interface BujoOccurrence extends BujoFields {
  id: string;
  scheduleId: string | null;
  seriesId: string | null;
  startDate: string;
  dueDate: string;
  availableAt: number;
  expiresAt: number;
  historyDate: string;
  completedDate: string | null;
  calendarStatus?: 'scheduled' | 'cancelled' | 'unlinked';
  statDate?: string;
  seriesTitle?: string;
}

const text = (v: unknown) => String(v ?? '').trim();
const date = (v: unknown) => parseDateText(text(v));
const validTime = (v: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
const validWeekday = (v: number) => Number.isInteger(v) && v >= 0 && v <= 6;
const instanceKey = (id: string, day: string) => `${id}:${day}`;

function taskFields(input: BujoFields) {
  const title = input.title.trim();
  if (!title) throw new Error('請填待辦名稱');
  return {
    title, note: input.note.trim() || null, tagIds: writeTagIds(input.tagIds),
    place: input.place?.trim() || null, organizationId: input.organizationId || null,
    peopleIds: writeTagIds(input.peopleIds ?? []),
  };
}

function readFields(row: TableRow): BujoFields {
  return {
    title: text(row.values.title), note: text(row.values.note), tagIds: readTagIds(row.values.tagIds),
    place: text(row.values.place), organizationId: text(row.values.organizationId) || null,
    peopleIds: readTagIds(row.values.peopleIds),
  };
}

function groupSchedules(schedules: BujoSchedule[]) {
  const groups = new Map<string, BujoSchedule[]>();
  const ordered = [...schedules].sort((a, b) => a.effectiveAt - b.effectiveAt || a.rowNumber - b.rowNumber);
  for (const schedule of ordered) {
    const group = groups.get(schedule.seriesId) ?? [];
    group.push(schedule);
    groups.set(schedule.seriesId, group);
  }
  return groups;
}

export function latestBujoSchedules(schedules: BujoSchedule[]) {
  return [...groupSchedules(schedules).values()].map((group) => group[group.length - 1]);
}

function firstWeeklyDate(weekday: number, since: number) {
  const day = toDateKey(since);
  return addDays(day, (weekday - new Date(since).getDay() + 7) % 7);
}

export function bujoTaskStatus(task: BujoOccurrence, now: number) {
  if (task.completedDate) return 'completed';
  if (task.calendarStatus === 'cancelled' || task.calendarStatus === 'unlinked') return 'cancelled';
  if (now >= task.expiresAt) return 'missed';
  return now < task.availableAt ? 'upcoming' : 'open';
}

export function bujoDayEntries(entries: BujoOccurrence[], day: string, now: number) {
  const open: BujoOccurrence[] = [], completed: BujoOccurrence[] = [], missed: BujoOccurrence[] = [], cancelled: BujoOccurrence[] = [];
  for (const entry of entries) {
    const status = bujoTaskStatus(entry, now);
    if (status === 'completed' && entry.completedDate === day) completed.push(entry);
    // （2026-11-26 使用者決定：提前完成後，區間剩下的日期不再顯示。）
    if (status === 'completed') continue;
    // （2026-11-26 暫定：一般待辦於到期日查漏做，重複待辦於原訂出現日查漏做。）
    if (status === 'missed' && entry.historyDate === day) missed.push(entry);
    if (status === 'cancelled' && entry.historyDate === day) cancelled.push(entry);
    if ((status === 'open' || status === 'upcoming') && entry.startDate <= day && day <= entry.dueDate
      && (day !== toDateKey(now) || status === 'open')) open.push(entry);
  }
  return { open, completed, missed, cancelled };
}

export function bujoMonthlyStats(entries: BujoOccurrence[], schedules: BujoSchedule[], month: string, now: number) {
  const latest = new Map(latestBujoSchedules(schedules).map((schedule) => [schedule.seriesId, schedule.title]));
  const counts = new Map<string, { seriesId: string; title: string; completed: number; missed: number }>();
  for (const entry of entries) {
    // （2026-11-26 使用者決定：每次依原訂出現日歸月；到期前尚未完成不算漏做。）
    if (!entry.seriesId || !(entry.statDate ?? entry.startDate).startsWith(month) || (!entry.completedDate && entry.availableAt > now)
      || entry.calendarStatus === 'cancelled') continue;
    const count = counts.get(entry.seriesId) ?? {
      seriesId: entry.seriesId, title: latest.get(entry.seriesId) ?? entry.seriesTitle ?? entry.title, completed: 0, missed: 0,
    };
    const status = bujoTaskStatus(entry, now);
    if (status === 'completed') count.completed++;
    if (status === 'missed') count.missed++;
    counts.set(entry.seriesId, count);
  }
  return [...counts.values()].sort((a, b) => a.title.localeCompare(b.title, 'zh-Hant'));
}

export function bujoOccurrences(snap: BujoSnapshot, through: string): BujoOccurrence[] {
  const entries: BujoOccurrence[] = snap.tasks.map((task) => ({
    ...task,
    scheduleId: null, seriesId: null,
    availableAt: startOfDay(task.startDate), expiresAt: startOfDay(addDays(task.dueDate, 1)),
    historyDate: task.dueDate,
  }));
  const completionByKey = new Map(snap.completions.map((item) => [instanceKey(item.scheduleId, item.occurrenceDate), item.completedDate]));
  const limit = endOfDay(through);
  for (const versions of groupSchedules(snap.schedules).values()) {
    const lastChange = toDateKey(versions[versions.length - 1].effectiveAt);
    const lookAhead = addDays(through > lastChange ? through : lastChange, 7);
    const occurrences: { schedule: BujoSchedule; day: string; at: number; nextVersionAt: number }[] = [];
    for (const [index, schedule] of versions.entries()) {
      if (schedule.stopped || schedule.effectiveAt > endOfDay(lookAhead)) continue;
      const nextVersionAt = versions[index + 1]?.effectiveAt ?? Infinity;
      let day = firstWeeklyDate(schedule.weekday, schedule.effectiveAt);
      while (day <= lookAhead) {
        const at = parseDateTimeText(`${day} ${schedule.time}`)!;
        if (at >= nextVersionAt) break;
        if (at >= schedule.effectiveAt) occurrences.push({ schedule, day, at, nextVersionAt });
        day = addDays(day, 7);
      }
    }

    for (const [index, { schedule, day, at, nextVersionAt }] of occurrences.entries()) {
      if (at > limit) break;
      const id = instanceKey(schedule.id, day);
      const regularExpiry = parseDateTimeText(`${addDays(day, 7)} ${schedule.time}`)!;
      const next = occurrences[index + 1];
      // （2026-11-26 使用者決定：排程修改保留已出現的一筆，下一次出現才結束；停用則仍按原期限。）
      const regularExpiryDay = toDateKey(regularExpiry);
      const nextDate = next && nextVersionAt < startOfDay(regularExpiryDay) ? next.day : regularExpiryDay;
      // （2026-11-26 使用者決定：下一筆所在日的 00:00 截止，避免同天出現前後兩筆。）
      const expiresAt = startOfDay(nextDate <= day ? addDays(day, 1) : nextDate);
      entries.push({
        ...schedule, id, scheduleId: schedule.id,
        startDate: day, dueDate: toDateKey(expiresAt - 1), availableAt: at, expiresAt,
        historyDate: day, completedDate: completionByKey.get(id) ?? null,
      });
    }
  }
  entries.push(...bujoCalendarOccurrences(snap.calendar, snap.calendarCompletions, through));
  return entries.sort((a, b) => a.availableAt - b.availableAt);
}

type BujoTable = 'bujoTasks' | 'bujoSchedules' | 'bujoCompletions' | 'bujoCalendarCompletions';

interface BujoOrganization {
  id: string;
  name: string;
  archived: boolean;
}

export interface BujoSnapshot {
  tasks: BujoTask[];
  schedules: BujoSchedule[];
  completions: BujoCompletion[];
  calendar: CalendarSnapshot;
  calendarCompletions: BujoCalendarCompletion[];
  organizations: BujoOrganization[];
  tags: Awaited<ReturnType<typeof loadSharedTags>>;
  issues: string[];
}

export class BujoStore {
  constructor(private backend: Backend) {}

  private async read<T extends StoredRow>(
    table: BujoTable, rows: TableRow[], issues: string[],
    parse: (row: TableRow, id: string) => Omit<T, keyof StoredRow> | null,
  ): Promise<T[]> {
    const results: T[] = [], fixes: RowUpdate[] = [];
    for (const row of rows) {
      const v = row.values;
      if (row.empty || v.deletedAt != null) continue;
      const givenId = text(v.id);
      const now = Date.now();
      const id = givenId || newId(now);
      const data = row.errors.length ? null : parse(row, id);
      if (!data) {
        issues.push(`${table} 第 ${row.rowNumber} 列資料不完整或格式有誤`);
        continue;
      }
      if (!givenId) fixes.push({
        rowNumber: row.rowNumber, expectId: '',
        values: { id, createdAt: v.createdAt ?? now, updatedAt: now, ...(table === 'bujoSchedules' ? { seriesId: text(v.seriesId) || id } : {}) },
      });
      results.push({ ...data, id, rowNumber: row.rowNumber } as T);
    }
    if (fixes.length) await this.backend.update(table, fixes);
    return results;
  }

  async load(): Promise<BujoSnapshot> {
    const [tasks, schedules, completions, calendarCompletions, tags, calendar, organizations] = await Promise.all([
      this.backend.read('bujoTasks'), this.backend.read('bujoSchedules'),
      this.backend.read('bujoCompletions'), this.backend.read('bujoCalendarCompletions'), loadSharedTags(this.backend),
      new CalendarStore(this.backend).load(Date.now(), { includeTags: false }),
      this.loadOrganizations(),
    ]);
    const issues: string[] = [];
    const [parsedTasks, parsedSchedules, parsedCompletions, parsedCalendarCompletions] = await Promise.all([
      this.read<BujoTask>('bujoTasks', tasks, issues, (row) => {
        const fields = readFields(row);
        const startDate = date(row.values.startDate), dueDate = date(row.values.dueDate);
        const completedDate = date(row.values.completedDate);
        if (!fields.title || !startDate || !dueDate || startDate > dueDate || (completedDate && completedDate < startDate)) return null;
        return { ...fields, startDate, dueDate, completedDate };
      }),
      this.read<BujoSchedule>('bujoSchedules', schedules, issues, (row, id) => {
        const v = row.values, fields = readFields(row);
        const weekday = v.weekday, time = text(v.time) || '00:00';
        const effectiveAt = v.effectiveAt ?? v.createdAt;
        if (!fields.title || typeof weekday !== 'number' || !validWeekday(weekday)
          || !validTime(time) || typeof effectiveAt !== 'number' || !Number.isFinite(effectiveAt)) return null;
        return { ...fields, seriesId: text(v.seriesId) || id, weekday, time, effectiveAt, stopped: v.stopped === true };
      }),
      this.read<BujoCompletion>('bujoCompletions', completions, issues, (row) => {
        const scheduleId = text(row.values.scheduleId);
        const occurrenceDate = date(row.values.occurrenceDate), completedDate = date(row.values.completedDate);
        if (!scheduleId || !occurrenceDate || (completedDate && completedDate < occurrenceDate)) return null;
        return { scheduleId, occurrenceDate, completedDate };
      }),
      this.read<BujoCalendarCompletion>('bujoCalendarCompletions', calendarCompletions, issues, (row) => {
        const entryKey = text(row.values.entryKey), completedDate = date(row.values.completedDate);
        try {
          const details = JSON.parse(text(row.values.details)) as BujoOccurrence | null;
          if (!entryKey.startsWith('calendar:') || !details || details.id !== entryKey
            || typeof details.title !== 'string' || !date(details.startDate) || !date(details.historyDate)
            || !Array.isArray(details.tagIds) || (details.peopleIds && !Array.isArray(details.peopleIds))
            || !Number.isFinite(details.availableAt) || !Number.isFinite(details.expiresAt)) return null;
          return { entryKey, completedDate, details };
        } catch {
          return null;
        }
      }),
    ]);
    return {
      tasks: parsedTasks, schedules: parsedSchedules, completions: parsedCompletions, tags, issues,
      calendar, calendarCompletions: parsedCalendarCompletions, organizations,
    };
  }

  private async loadOrganizations(): Promise<BujoOrganization[]> {
    const organizations: BujoOrganization[] = [], fixes: RowUpdate[] = [];
    for (const row of await this.backend.read('hubOrganizations')) {
      const name = text(row.values.name);
      if (row.empty || row.values.deletedAt != null || !name) continue;
      const currentId = text(row.values.id), now = Date.now(), id = currentId || newId(now);
      if (!currentId) fixes.push({ rowNumber: row.rowNumber, expectId: '', values: { id, createdAt: now, updatedAt: now } });
      organizations.push({ id, name, archived: row.values.archived === true });
    }
    if (fixes.length) await this.backend.update('hubOrganizations', fixes);
    return organizations.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  }

  async saveTask(input: BujoTaskInput, existing?: BujoTask, now = Date.now()) {
    const fields = taskFields(input);
    const startDate = date(input.startDate), dueDate = date(input.dueDate);
    if (!startDate || !dueDate || dueDate < startDate) throw new Error('請填有效的區間，到期日不能早於開始日');
    if (existing?.completedDate && existing.completedDate < startDate) throw new Error('開始日不能晚於這筆的完成日');
    const values = { ...fields, startDate, dueDate, updatedAt: now };
    if (existing) {
      await this.backend.update('bujoTasks', [{ rowNumber: existing.rowNumber, expectId: existing.id, values }]);
    } else {
      await this.backend.append('bujoTasks', [{ ...values, id: newId(now), createdAt: now }]);
    }
  }

  async deleteTask(task: BujoTask, now = Date.now()) {
    await this.backend.update('bujoTasks', [{
      rowNumber: task.rowNumber, expectId: task.id, values: { deletedAt: now, updatedAt: now },
    }]);
  }

  async saveSchedule(input: BujoScheduleInput, seriesId?: string, stopped = false, now = Date.now()) {
    const fields = taskFields(input);
    if (!validWeekday(input.weekday) || !validTime(input.time)) throw new Error('請選擇星期並填入有效的 24 小時制時間');
    const id = newId(now);
    // 保留秒的精度，和 Google 試算表來回讀寫的時間精度相同。
    const effectiveAt = Math.floor(now / 1000) * 1000;
    await this.backend.append('bujoSchedules', [{
      ...fields, id, seriesId: seriesId ?? id, weekday: input.weekday, time: input.time,
      effectiveAt, stopped, createdAt: now, updatedAt: now,
    }]);
  }

  async setCompletion(entry: BujoOccurrence, completedDate: string | null, snap: BujoSnapshot, now = Date.now()) {
    const done = completedDate === null ? null : date(completedDate);
    const earliest = entry.completedDate && entry.completedDate < entry.startDate ? entry.completedDate : entry.startDate;
    if (completedDate !== null && (!done || done < earliest || done > toDateKey(now) || (!entry.completedDate && entry.availableAt > now))) {
      throw new Error('完成日須介於待辦開始日和今天之間');
    }
    const values = { completedDate: done, updatedAt: now };
    if (entry.calendarStatus) {
      // （2026-11-26 暫定：行程取消或刪除時，已記下的實際完成紀錄保留。）
      if (!entry.completedDate && entry.calendarStatus !== 'scheduled') throw new Error('這筆行程已取消或移除');
      const previous = [...snap.calendarCompletions].reverse().find((item) => item.entryKey === entry.id);
      const details = JSON.stringify({ ...entry, completedDate: null });
      if (previous) {
        await this.backend.update('bujoCalendarCompletions', [{ rowNumber: previous.rowNumber, expectId: previous.id, values: { ...values, details } }]);
      } else if (done) {
        await this.backend.append('bujoCalendarCompletions', [{ id: newId(now), entryKey: entry.id, ...values, details, createdAt: now }]);
      }
      return;
    }
    if (!entry.scheduleId) {
      const task = snap.tasks.find(({ id }) => id === entry.id);
      if (!task) throw new Error('找不到這筆待辦，請重新整理');
      await this.backend.update('bujoTasks', [{ rowNumber: task.rowNumber, expectId: task.id, values }]);
      return;
    }
    const previous = [...snap.completions].reverse().find((item) => item.scheduleId === entry.scheduleId && item.occurrenceDate === entry.startDate);
    if (previous) {
      await this.backend.update('bujoCompletions', [{ rowNumber: previous.rowNumber, expectId: previous.id, values }]);
    } else if (done) {
      await this.backend.append('bujoCompletions', [{
        id: newId(now), scheduleId: entry.scheduleId, occurrenceDate: entry.startDate, ...values, createdAt: now,
      }]);
    }
  }
}
