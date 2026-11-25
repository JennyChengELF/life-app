import { useEffect, useMemo, useState } from 'react';
import { dueCalendarReminders, type CalendarEvent, type CalendarSnapshot } from '@life/db';

export function CalendarReminderList({ snapshot, eventHref, onOpen }: {
  snapshot: CalendarSnapshot;
  eventHref: (event: CalendarEvent) => string;
  onOpen?: (event: CalendarEvent) => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = window.setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  const due = useMemo(() => dueCalendarReminders(snapshot, now), [snapshot, now]);
  if (!due.length) return null;

  return <section className="calendar-reminder-list" aria-label="行程提醒">
    {due.map(({ id, event, time }) => (
      <a className="msg warn" key={id} href={eventHref(event)} onClick={(e) => {
        if (!onOpen || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onOpen(event);
      }}>
        行程提醒 · {time}　{event.title}
        <span className="small">（{event.startDate.replaceAll('-', '/')}{event.startTime ? ` ${event.startTime}` : ' 全天'}）</span>
      </a>
    ))}
  </section>;
}
