import { addDateDays, expandCalendarEvents, type CalendarEvent, type CalendarSnapshot } from './calendar';
import { calendarRecurrenceDates } from './calendar-recurrence';
import { resolveCalendarLocalTime } from './calendar-time';
import { addDays, parseDateTimeText, startOfDay, toDateKey } from './time';
import type { BujoOccurrence } from './bujo';

export interface BujoCalendarCompletion {
  id: string;
  rowNumber: number;
  entryKey: string;
  completedDate: string | null;
  details: BujoOccurrence;
}

function eventStart(event: CalendarEvent) {
  if (event.timeType === 'allDay') return startOfDay(event.startDate);
  if (event.timeMode === 'fixedZone' && event.startTimeZone) {
    return resolveCalendarLocalTime(event.startDate, event.startTime!, event.startTimeZone,
      event.startDisambiguation, event.startUtcOffset, true).epochMilliseconds;
  }
  return parseDateTimeText(`${event.startDate} ${event.startTime}`)!;
}

function startDay(master: CalendarEvent, key: string) {
  try {
    return toDateKey(eventStart({ ...master, startDate: key, startUtcOffset: null }));
  } catch {
    return key;
  }
}

function eventEndDay(event: CalendarEvent, startDate: string) {
  if (event.timeType === 'point') return startDate;
  if (event.timeType === 'range' && event.timeMode === 'fixedZone' && event.endTimeZone && event.endTime) {
    const at = resolveCalendarLocalTime(event.endDate, event.endTime, event.endTimeZone,
      event.endDisambiguation, event.endUtcOffset, true).epochMilliseconds;
    return toDateKey(at);
  }
  return event.endDate;
}

function followingSlots(master: CalendarEvent, through: string) {
  const rule = master.recurrence!;
  const dates = calendarRecurrenceDates(rule, master.startDate, master.startDate, through);
  // 只再找一個原訂日期來算期限，無須把遙遠未來的行程展開。
  const next = calendarRecurrenceDates(rule, master.startDate, addDateDays(through, 1), addDateDays(through, 200000), 1)[0];
  if (next) dates.push(next);
  return dates;
}

function baseOccurrence(
  event: CalendarEvent,
  master: CalendarEvent | undefined,
  nextDay: string | undefined,
  seriesTitle: string | undefined,
): BujoOccurrence {
  const at = eventStart(event);
  const startDate = toDateKey(at);
  const keyDate = event.recurrenceInstanceKey;
  const root = master?.bujoSeriesId ?? master?.id;
  const nominalDate = root && keyDate ? addDateDays(keyDate, -(master?.bujoDateShift ?? 0)) : event.startDate;
  const endDate = eventEndDay(event, startDate);
  const expiryDay = nextDay && nextDay > startDate
    ? nextDay
    : addDays(endDate > startDate ? endDate : startDate, 1);
  const id = root && keyDate ? `calendar:${root}:${nominalDate}` : `calendar:${event.id}`;
  return {
    id, seriesId: root ? `calendar:${root}` : null, scheduleId: null,
    seriesTitle, statDate: nominalDate, calendarStatus: event.status,
    title: event.title, note: event.note ?? '', tagIds: event.tagIds ?? [],
    place: [event.startPlace, event.endPlace].filter(Boolean).join(' → ') || (event.locationType === 'online' ? '線上' : ''),
    peopleIds: event.peopleIds ?? [],
    startDate, dueDate: addDays(expiryDay, -1),
    availableAt: root ? at : startOfDay(startDate),
    expiresAt: startOfDay(expiryDay),
    historyDate: startDate, completedDate: null,
  };
}

/** 待辦取自原行程，完成紀錄單獨保存；避免跨試算表重複寫入。 */
export function bujoCalendarOccurrences(snapshot: CalendarSnapshot, records: BujoCalendarCompletion[], through: string) {
  const completed = new Map(records.map((record) => [record.entryKey, record]));
  const result = new Map<string, BujoOccurrence>();
  const linkedParents = new Set(snapshot.events
    .filter((event) => event.bujoEnabled && event.recurrenceParentId)
    .map((event) => event.recurrenceParentId));
  const masters = snapshot.recurrenceMasters.filter((master) => master.bujoEnabled || linkedParents.has(master.id));
  const byId = new Map(masters.map((master) => [master.id, master]));
  const titles = new Map<string, string>();
  const nextDays = new Map<string, Map<string, string>>();
  let upperDate = addDays(through, 2); // 固定時區的行程可能換算到前後一天。
  // 改期到查詢範圍之後的已完成行程，仍然能找到來源。
  for (const { details } of records) {
    if (!details.seriesId || !details.statDate) continue;
    for (const master of masters) {
      if (`calendar:${master.bujoSeriesId ?? master.id}` !== details.seriesId) continue;
      const shifted = addDateDays(details.statDate, master.bujoDateShift ?? 0);
      if (shifted > upperDate) upperDate = shifted;
    }
  }

  const overridesByMaster = new Map<string, Map<string, CalendarEvent>>();
  for (const event of snapshot.events) {
    if (!event.recurrenceParentId || !event.recurrenceInstanceKey) continue;
    const overrides = overridesByMaster.get(event.recurrenceParentId) ?? new Map<string, CalendarEvent>();
    overrides.set(event.recurrenceInstanceKey, event);
    overridesByMaster.set(event.recurrenceParentId, overrides);
  }

  for (const master of [...masters].sort((a, b) => a.startDate.localeCompare(b.startDate))) {
    const dates = followingSlots(master, upperDate);
    const overrides = overridesByMaster.get(master.id);
    const slotDays = dates.map((key) => {
      const override = overrides?.get(key);
      // （2026-11-26 使用者決定：取消的次數不讓前一筆延長，仍使用該次原訂日。）
      return override ? toDateKey(eventStart(override)) : startDay(master, key);
    });
    if (master.bujoBoundary) slotDays.push(startDay(master, master.bujoBoundary));
    const chronological = [...new Set(slotDays)].sort();
    const afterDay = new Map(chronological.map((day, index) => [day, chronological[index + 1]]));
    const expiryBySlot = new Map<string, string>();
    for (const [index, key] of dates.entries()) {
      const day = afterDay.get(slotDays[index]);
      if (day) expiryBySlot.set(key, day);
    }
    nextDays.set(master.id, expiryBySlot);
    titles.set(master.bujoSeriesId ?? master.id, master.title);
  }

  const earliest = masters.reduce((date, master) => master.startDate < date ? master.startDate : date, upperDate);
  const events = expandCalendarEvents({ ...snapshot, recurrenceMasters: masters }, earliest, upperDate);
  for (const event of events) {
    if (event.systemSource || !event.bujoEnabled) continue;
    const master = event.recurrenceParentId ? byId.get(event.recurrenceParentId) : undefined;
    if (event.recurrenceParentId && !master) continue;
    const nextDay = master && event.recurrenceInstanceKey ? nextDays.get(master.id)?.get(event.recurrenceInstanceKey) : undefined;
    const entry = baseOccurrence(event, master, nextDay, master ? titles.get(master.bujoSeriesId ?? master.id) : undefined);
    if (entry.startDate > through && !completed.has(entry.id)) continue;
    entry.completedDate = completed.get(entry.id)?.completedDate ?? null;
    result.set(entry.id, entry);
  }
  for (const [key, record] of completed) {
    if (record.completedDate && !result.has(key)) {
      result.set(key, { ...record.details, id: key, completedDate: record.completedDate, calendarStatus: 'unlinked' });
    }
  }
  return [...result.values()];
}
