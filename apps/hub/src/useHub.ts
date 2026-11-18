import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Backend, BowelSnapshot, HealthSnapshot, WaterSnapshot } from '@life/db';
import { AuthError, BowelStore, GoogleAuth, HealthStore, LocalBackend, SheetsBackend, WaterStore } from '@life/db';

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';
/** 網址加 ?local 可強制用本機測試模式 */
const FORCE_LOCAL = new URLSearchParams(location.search).has('local');

export type Status = 'starting' | 'need-connect' | 'loading' | 'ready' | 'error';

/**
 * 綜合首頁讀喝水、健康、排便的資料（同一個網站，Google 登入和各 APP 共用）。
 * 首頁只顯示（讀取時和各 APP 一樣會補齊試算表）；要新增 / 修改就跳到那個 APP。
 */
export function useHub() {
  const { backend, auth, water, health, bowel } = useMemo(() => {
    const auth = CLIENT_ID && !FORCE_LOCAL ? new GoogleAuth(CLIENT_ID) : null;
    const backend: Backend = auth ? new SheetsBackend(auth) : new LocalBackend();
    return { backend, auth, water: new WaterStore(backend, 'hub'), health: new HealthStore(backend, 'hub'), bowel: new BowelStore(backend, 'hub') };
  }, []);

  const [status, setStatus] = useState<Status>('starting');
  const [waterSnap, setWaterSnap] = useState<WaterSnapshot | null>(null);
  const [healthSnap, setHealthSnap] = useState<HealthSnapshot | null>(null);
  const [bowelSnap, setBowelSnap] = useState<BowelSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const initPromise = useRef<Promise<void> | null>(null);

  const load = useCallback(async () => {
    if (!initPromise.current) {
      initPromise.current = backend.init().catch((e) => {
        initPromise.current = null;
        throw e;
      });
    }
    await initPromise.current;
    const [w, h, b] = await Promise.all([water.load(), health.load(), bowel.load()]);
    setWaterSnap(w);
    setHealthSnap(h);
    setBowelSnap(b);
    setStatus('ready');
    setError(null);
  }, [backend, water, health, bowel]);

  const fail = useCallback((e: unknown) => {
    if (e instanceof AuthError) {
      setStatus('need-connect');
      setError(e.message);
    } else {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

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
        fail(e);
      }
    })();
  }, [auth, load, fail]);

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
      fail(e);
    } finally {
      setBusy(false);
    }
  }, [load, fail]);

  // 從各 APP 改完回來（瀏覽器返回、切回分頁）時重新讀取
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => e.persisted && status === 'ready' && refresh();
    const onVisible = () => document.visibilityState === 'visible' && status === 'ready' && refresh();
    window.addEventListener('pageshow', onShow);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('pageshow', onShow);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [status, refresh]);

  return { mode: backend.kind, status, waterSnap, healthSnap, bowelSnap, error, busy, connect, refresh };
}
