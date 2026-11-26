import { useEffect, useMemo, useRef, useState } from 'react';
import { addSharedTag, AuthError, BujoStore, GoogleAuth, LocalBackend, SheetsBackend, type BujoSnapshot } from '@life/db';

const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim();
const forceLocal = new URLSearchParams(location.search).has('local');

export function useBujo() {
  const { auth, backend, store } = useMemo(() => {
    const auth = clientId && !forceLocal ? new GoogleAuth(clientId) : null;
    const backend = auth ? new SheetsBackend(auth) : new LocalBackend();
    return { auth, backend, store: new BujoStore(backend) };
  }, []);
  const [snap, setSnap] = useState<BujoSnapshot | null>(null);
  const [status, setStatus] = useState<'loading' | 'connect' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const started = useRef(false);
  const initialized = useRef(false);
  const working = useRef(false);

  const load = async () => {
    if (!initialized.current) {
      if (backend instanceof SheetsBackend) await backend.init(['hub', 'bujo']);
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

  const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      return await action();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      working.current = false;
    }
  };

  const afterSave = async () => {
    try {
      await load();
    } catch (e) {
      fail(e);
      if (!(e instanceof AuthError)) setError('已儲存，但畫面更新失敗。請重新整理。');
    }
  };

  return {
    snap, status, busy, error, notice, store, local: !auth, fileUrl: backend.fileUrl('bujo'),
    connect: () => run(async () => {
      await auth?.signIn();
      await load();
    }),
    refresh: () => run(load),
    save: (action: () => Promise<void>, message = '已儲存') => run(async () => {
      await action();
      await afterSave();
      setNotice(message);
      return true;
    }),
    addTag: (name: string) => run(async () => {
      const id = await addSharedTag(backend, name);
      await afterSave();
      return id;
    }),
  };
}

export type BujoApi = ReturnType<typeof useBujo>;
