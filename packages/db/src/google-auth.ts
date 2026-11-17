/**
 * Google 登入（Google Identity Services 的 token 模式）。
 * 權限只要求 drive.file：只能存取「這個 APP 自己建立的檔案」。
 * 取得的通行證（access token）約 1 小時有效，過期要使用者點一下重新連線。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any;
  }
}

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const STORAGE_KEY = 'life.google.token';

export class AuthError extends Error {
  constructor(message = '需要連線 Google') {
    super(message);
    this.name = 'AuthError';
  }
}

interface SavedToken {
  value: string;
  exp: number;
}

function loadScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('無法載入 Google 登入元件，請檢查網路'));
    document.head.appendChild(s);
  });
}

export class GoogleAuth {
  private token: SavedToken | null = null;
  private client: any = null;
  private pending: { resolve: () => void; reject: (e: Error) => void } | null = null;

  constructor(private clientId: string) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as SavedToken | null;
      if (saved && saved.exp > Date.now()) this.token = saved;
    } catch {
      /* 讀不到就當沒登入 */
    }
  }

  /** 先載入 Google 元件（頁面打開時呼叫，讓之後按「連線」能立刻跳出視窗） */
  async prepare(): Promise<void> {
    await loadScript();
    if (this.client) return;
    this.client = window.google.accounts.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: DRIVE_FILE_SCOPE,
      callback: (resp: any) => {
        const p = this.pending;
        this.pending = null;
        if (resp.error) {
          p?.reject(new AuthError(`Google 登入失敗：${resp.error_description ?? resp.error}`));
          return;
        }
        // 提早 2 分鐘視為過期
        this.token = { value: resp.access_token, exp: Date.now() + (Number(resp.expires_in) - 120) * 1000 };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(this.token));
        } catch {
          /* 存不了沒關係 */
        }
        p?.resolve();
      },
      error_callback: (err: any) => {
        const p = this.pending;
        this.pending = null;
        p?.reject(new AuthError(err?.type === 'popup_closed' ? '登入視窗被關閉了' : '無法開啟 Google 登入視窗（請允許彈出視窗）'));
      },
    });
  }

  isSignedIn(): boolean {
    return !!this.token && this.token.exp > Date.now();
  }

  /** 必須在使用者點擊時呼叫，否則瀏覽器會擋彈出視窗 */
  signIn(): Promise<void> {
    if (!this.client) return Promise.reject(new AuthError('Google 登入元件還沒載入，請稍候再試'));
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      // 已同意過的話 prompt '' 不會再問，視窗會自動關閉
      this.client.requestAccessToken({ prompt: '' });
    });
  }

  getToken(): string {
    if (!this.isSignedIn()) throw new AuthError();
    return this.token!.value;
  }

  /** 通行證被 Google 拒絕時呼叫 */
  invalidate() {
    this.token = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  signOut() {
    if (this.token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(this.token.value, () => {});
    this.invalidate();
  }
}
