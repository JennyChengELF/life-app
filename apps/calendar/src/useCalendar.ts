import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Backend, CalendarSnapshot } from '@life/db';
import { AuthError, CalendarStore, GoogleAuth, installTaiwanCalendarResource, LocalBackend, SheetsBackend, type TaiwanCalendarResource } from '@life/db';

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';
const FORCE_LOCAL = new URLSearchParams(location.search).has('local');
const TAIWAN_VERSION_KEY = 'life.calendar.taiwanCalendarVersion';

export type Status = 'starting' | 'need-connect' | 'loading' | 'ready' | 'error';
export interface Toast { id: number; text: string; kind: 'info' | 'error' }

export function useCalendar() {
  const { backend, auth, store } = useMemo(() => {
    const auth = CLIENT_ID && !FORCE_LOCAL ? new GoogleAuth(CLIENT_ID) : null;
    const backend: Backend = auth ? new SheetsBackend(auth) : new LocalBackend();
    return { backend, auth, store: new CalendarStore(backend) };
  }, []);
  const [status, setStatus] = useState<Status>('starting');
  const [snap, setSnap] = useState<CalendarSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const initPromise = useRef<Promise<void> | null>(null);
  const taiwanCalendarPromise = useRef<Promise<boolean> | null>(null);
  const taiwanCalendarNotified = useRef(false);
  const toastTimer = useRef<number>();

  const showToast = useCallback((t: Omit<Toast, 'id'>, ms = 5500) => {
    window.clearTimeout(toastTimer.current);
    setToast({ ...t, id: Date.now() });
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }, []);

  const loadTaiwanCalendar = useCallback(async () => {
    if (!taiwanCalendarPromise.current) taiwanCalendarPromise.current = (async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}taiwan-calendar.json`, { cache: 'no-cache' });
        if (!response.ok) return false;
        const resource = await response.json() as TaiwanCalendarResource;
        installTaiwanCalendarResource(resource);
        const previous = localStorage.getItem(TAIWAN_VERSION_KEY);
        localStorage.setItem(TAIWAN_VERSION_KEY, resource.version);
        return !!previous && previous !== resource.version;
      } catch {
        // 本機開發或政府來源暫時失敗時，繼續使用程式內建的官方資料。
        return false;
      }
    })();
    return taiwanCalendarPromise.current;
  }, []);

  const load = useCallback(async () => {
    const taiwanCalendarUpdated = await loadTaiwanCalendar();
    if (!initPromise.current) {
      initPromise.current = backend.init().catch((e) => {
        initPromise.current = null;
        throw e;
      });
    }
    await initPromise.current;
    setSnap(await store.load());
    setStatus('ready');
    setError(null);
    if (taiwanCalendarUpdated && !taiwanCalendarNotified.current) {
      taiwanCalendarNotified.current = true;
      showToast({ kind: 'info', text: '台灣休假與補班資料已更新' });
    }
  }, [backend, loadTaiwanCalendar, showToast, store]);

  const fail = useCallback((e: unknown) => {
    if (e instanceof AuthError) {
      setStatus('need-connect');
      setError(e.message);
    } else showToast({ kind: 'error', text: e instanceof Error ? e.message : String(e) }, 8000);
  }, [showToast]);

  useEffect(() => {
    (async () => {
      try {
        if (auth) {
          await auth.prepare();
          if (!auth.isSignedIn()) return setStatus('need-connect');
        }
        setStatus('loading');
        await load();
      } catch (e) {
        if (e instanceof AuthError) setStatus('need-connect');
        else {
          setStatus('error');
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
  }, [auth, load]);

  const connect = useCallback(async () => {
    if (!auth) return;
    try {
      setError(null);
      await auth.signIn();
      setStatus('loading');
      await load();
    } catch (e) {
      setStatus('need-connect');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [auth, load]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try { await load(); } catch (e) { fail(e); } finally { setBusy(false); }
  }, [load, fail]);

  const run = useCallback(async <T,>(action: (s: CalendarStore) => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    try {
      const result = await action(store);
      await load();
      return result;
    } catch (e) {
      fail(e);
      try { await load(); } catch { /* 已顯示原錯誤 */ }
      return undefined;
    } finally { setBusy(false); }
  }, [store, load, fail]);

  return {
    mode: backend.kind,
    status,
    snap,
    error,
    busy,
    toast,
    showToast,
    dismissToast: () => setToast(null),
    connect,
    refresh,
    run,
    fileUrl: () => backend.fileUrl('calendar'),
  };
}

export type CalendarApi = ReturnType<typeof useCalendar>;
