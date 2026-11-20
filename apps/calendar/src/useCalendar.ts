import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Backend, CalendarSnapshot } from '@life/db';
import { AuthError, CalendarStore, GoogleAuth, LocalBackend, SheetsBackend } from '@life/db';

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';
const FORCE_LOCAL = new URLSearchParams(location.search).has('local');

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
  const toastTimer = useRef<number>();

  const showToast = useCallback((t: Omit<Toast, 'id'>, ms = 5500) => {
    window.clearTimeout(toastTimer.current);
    setToast({ ...t, id: Date.now() });
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }, []);

  const load = useCallback(async () => {
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
  }, [backend, store]);

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
