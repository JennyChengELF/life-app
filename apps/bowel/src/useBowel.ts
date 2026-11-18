import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Backend, BowelSnapshot } from '@life/db';
import { AuthError, GoogleAuth, LocalBackend, SheetsBackend, BowelStore } from '@life/db';

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';
/** 網址加 ?local 可強制用本機測試模式 */
const FORCE_LOCAL = new URLSearchParams(location.search).has('local');

export type Status = 'starting' | 'need-connect' | 'loading' | 'ready' | 'error';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
  undo?: () => void;
}

export function useBowel() {
  const { backend, auth, store } = useMemo(() => {
    const auth = CLIENT_ID && !FORCE_LOCAL ? new GoogleAuth(CLIENT_ID) : null;
    const backend: Backend = auth ? new SheetsBackend(auth) : new LocalBackend();
    return { backend, auth, store: new BowelStore(backend) };
  }, []);

  const [status, setStatus] = useState<Status>('starting');
  const [snap, setSnap] = useState<BowelSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  /** 初始化（確認試算表）只做一次；同時呼叫的會共用同一個 */
  const initPromise = useRef<Promise<void> | null>(null);
  const toastTimer = useRef<number>();

  const showToast = useCallback((t: Omit<Toast, 'id'>, ms = 6000) => {
    window.clearTimeout(toastTimer.current);
    setToast({ ...t, id: Date.now() });
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }, []);

  const handleError = useCallback(
    (e: unknown) => {
      if (e instanceof AuthError) {
        setStatus('need-connect');
        setError(e.message);
        return;
      }
      showToast({ text: e instanceof Error ? e.message : String(e), kind: 'error' }, 8000);
    },
    [showToast],
  );

  const load = useCallback(async () => {
    if (!initPromise.current) {
      initPromise.current = backend.init().catch((e) => {
        initPromise.current = null; // 失敗的話下次再試
        throw e;
      });
    }
    await initPromise.current;
    const s = await store.load();
    setSnap(s);
    setStatus('ready');
    setError(null);
  }, [backend, store]);

  // 開啟時
  useEffect(() => {
    (async () => {
      try {
        if (auth) {
          await auth.prepare();
          if (!auth.isSignedIn()) {
            setStatus('need-connect');
            return;
          }
        }
        setStatus('loading');
        await load();
      } catch (e) {
        if (e instanceof AuthError) {
          setStatus('need-connect');
        } else {
          setStatus('error');
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
  }, [auth, load]);

  /** 必須由按鈕點擊觸發（瀏覽器才不會擋登入視窗） */
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
      handleError(e);
    } finally {
      setBusy(false);
    }
  }, [load, handleError]);

  /** 執行寫入：可先在畫面上樂觀更新，寫完再重新讀取 */
  const run = useCallback(
    async <T>(action: (s: BowelStore) => Promise<T>, optimistic?: (s: BowelSnapshot) => BowelSnapshot): Promise<T | undefined> => {
      if (optimistic) setSnap((s) => (s ? optimistic(s) : s));
      setBusy(true);
      try {
        const result = await action(store);
        await load();
        return result;
      } catch (e) {
        handleError(e);
        try {
          await load();
        } catch {
          /* 讀取也失敗就算了，錯誤訊息已顯示 */
        }
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [store, load, handleError],
  );

  const signOut = useCallback(() => {
    auth?.signOut();
    initPromise.current = null;
    setSnap(null);
    setStatus('need-connect');
  }, [auth]);

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
    signOut,
    fileUrl: () => backend.fileUrl('bowel'),
  };
}

export type BowelApi = ReturnType<typeof useBowel>;
