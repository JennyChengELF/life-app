import { useEffect, useMemo, useRef, useState } from 'react';
import { AuthError, GoogleAuth, LocalBackend, MedStore, SheetsBackend, type MedSnapshot } from '@life/db';

const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim();
const forceLocal = new URLSearchParams(location.search).has('local');

export function useMeds() {
  const { auth, backend, store } = useMemo(() => {
    const auth = clientId && !forceLocal ? new GoogleAuth(clientId) : null;
    const backend = auth ? new SheetsBackend(auth) : new LocalBackend();
    return { auth, backend, store: new MedStore(backend) };
  }, []);
  const [snap, setSnap] = useState<MedSnapshot | null>(null);
  const [status, setStatus] = useState<'loading' | 'connect' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const started = useRef(false);
  const initialized = useRef(false);
  const working = useRef(false);

  const load = async () => {
    if (!initialized.current) {
      if (backend instanceof SheetsBackend) await backend.init(['meds']);
      else await backend.init();
      initialized.current = true;
    }
    setSnap(await store.load());
    setStatus('ready');
  };

  const fail = (e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    if (e instanceof AuthError) {
      initialized.current = false;
      setStatus('connect');
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        if (auth) {
          await auth.prepare();
          if (!auth.isSignedIn()) return setStatus('connect');
        }
        await load();
      } catch (e) {
        setStatus('error');
        fail(e);
      }
    })();
  }, []);

  const run = async (action: () => Promise<void>, saved?: string) => {
    if (working.current) return false;
    working.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      if (saved) setNotice(saved);
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  return {
    snap, status, busy, error, notice, store, local: !auth,
    connect: () => run(async () => {
      await auth?.signIn();
      await load();
    }),
    refresh: () => run(load),
    save: (action: () => Promise<void>, message = '已儲存') => run(async () => {
      await action();
      try {
        await load();
      } catch (e) {
        fail(new Error('已儲存，但畫面更新失敗。請重新整理。', { cause: e }));
      }
    }, message),
    fileUrl: backend.fileUrl('meds'),
  };
}

export type MedApi = ReturnType<typeof useMeds>;
