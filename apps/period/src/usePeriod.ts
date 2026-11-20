import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Backend, ConditionSnapshot, PeriodSnapshot } from '@life/db';
import { AuthError, ConditionStore, GoogleAuth, LocalBackend, PeriodStore, SheetsBackend } from '@life/db';

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';
const FORCE_LOCAL = new URLSearchParams(location.search).has('local');
const LOCAL_CYCLE_REPAIR_KEY = 'life.local.periodCycles.repair.20261120-start-click';

if (FORCE_LOCAL && localStorage.getItem(LOCAL_CYCLE_REPAIR_KEY) !== 'done') {
  // （2026-11-20 使用者決定：清除舊版「開始」按鈕誤寫入的本機正式經期測試資料；只執行一次，不影響之後重新測試的新資料。）
  localStorage.removeItem('life.local.periodCycles');
  localStorage.setItem(LOCAL_CYCLE_REPAIR_KEY, 'done');
}
export type Status = 'starting' | 'need-connect' | 'loading' | 'ready' | 'error';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export function usePeriod() {
  const { backend, auth, periodStore, conditionStore } = useMemo(() => {
    const auth = CLIENT_ID && !FORCE_LOCAL ? new GoogleAuth(CLIENT_ID) : null;
    const backend: Backend = auth ? new SheetsBackend(auth) : new LocalBackend();
    return { backend, auth, periodStore: new PeriodStore(backend), conditionStore: new ConditionStore(backend, 'period') };
  }, []);
  const [status, setStatus] = useState<Status>('starting');
  const [snap, setSnap] = useState<PeriodSnapshot | null>(null);
  const [conditions, setConditions] = useState<ConditionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const initPromise = useRef<Promise<void> | null>(null);
  const toastTimer = useRef<number>();

  const showToast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, kind });
    toastTimer.current = window.setTimeout(() => setToast(null), kind === 'error' ? 8000 : 5000);
  }, []);

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof AuthError) {
        setStatus('need-connect');
        setError(e.message);
      } else showToast(e instanceof Error ? e.message : String(e), 'error');
    },
    [showToast],
  );

  const load = useCallback(async () => {
    if (!initPromise.current) {
      initPromise.current = backend.init().catch((e) => {
        initPromise.current = null;
        throw e;
      });
    }
    await initPromise.current;
    const [p, c] = await Promise.all([periodStore.load(), conditionStore.load()]);
    setSnap(p);
    setConditions(c);
    setStatus('ready');
    setError(null);
  }, [backend, periodStore, conditionStore]);

  useEffect(() => {
    void (async () => {
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
    try {
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }, [load, fail]);

  const run = useCallback(
    async <T>(action: (p: PeriodStore, c: ConditionStore) => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      try {
        const result = await action(periodStore, conditionStore);
        await load();
        return result;
      } catch (e) {
        fail(e);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [periodStore, conditionStore, load, fail],
  );

  return {
    mode: backend.kind,
    status,
    snap,
    conditions,
    error,
    busy,
    toast,
    connect,
    refresh,
    run,
    showToast,
    dismissToast: () => setToast(null),
    periodFileUrl: () => backend.fileUrl('period'),
    healthFileUrl: () => backend.fileUrl('health'),
  };
}

export type PeriodApi = ReturnType<typeof usePeriod>;
