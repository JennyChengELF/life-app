import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';

export type LifeAppKey = 'hub' | 'water' | 'health' | 'bowel' | 'money' | 'calendar' | 'period' | 'meds' | 'bujo' | 'invest';

interface AppDefinition {
  key: LifeAppKey;
  label: string;
  path: string;
  icon: IconName;
  /** 2026-11-22 使用者決定：切換後開日曆；目前只有生理期需用 hash 指定。 */
  calendarHash?: string;
}

const APPS: AppDefinition[] = [
  { key: 'hub', label: '綜合首頁', path: '', icon: 'home' },
  { key: 'water', label: '喝水', path: 'water/', icon: 'droplet' },
  { key: 'health', label: '健康', path: 'health/', icon: 'stethoscope' },
  { key: 'bowel', label: '廁所大事', path: 'bowel/', icon: 'toilet' },
  { key: 'money', label: '記帳', path: 'money/', icon: 'wallet' },
  { key: 'calendar', label: '行事曆', path: 'calendar/', icon: 'calendar' },
  { key: 'period', label: '生理期', path: 'period/', icon: 'calendar', calendarHash: '#calendar' },
  { key: 'meds', label: '用藥記錄', path: 'meds/', icon: 'pill' },
  { key: 'bujo', label: '子彈筆記', path: 'bujo/', icon: 'book' },
  { key: 'invest', label: '投資', path: 'invest/', icon: 'chart' },
];

const DEV_PORTS: Record<LifeAppKey, number> = {
  hub: 5172,
  water: 5173,
  health: 5174,
  bowel: 5175,
  money: 5176,
  calendar: 5177,
  period: 5178,
  meds: 5179,
  bujo: 5180,
  invest: 5181,
};

function appUrl(app: AppDefinition, homeUrl: string, date?: string) {
  const dev = Object.values(DEV_PORTS).includes(Number(location.port));
  const url = dev
    ? new URL(`${location.protocol}//${location.hostname}:${DEV_PORTS[app.key]}/`)
    : app.key === 'hub'
      ? new URL(homeUrl, location.href)
      : new URL(app.path, new URL(homeUrl, location.href));
  url.search = '';
  url.hash = app.calendarHash ?? '';
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) url.searchParams.set('date', date);
  if (new URLSearchParams(location.search).has('local')) url.searchParams.set('local', '');
  return url.href;
}

/**
 * 所有 APP 左上角共用的功能切換選單。
 * （2026-11-22 使用者決定：切換時保留日期與 ?local，並進入目標 APP 的日曆。）
 */
export function AppSwitcher({
  current,
  homeUrl,
  date,
  confirmLeave = false,
}: {
  current: LifeAppKey;
  /** 綜合首頁網址；正式站通常是 ../，開發環境是 5172 port。 */
  homeUrl: string;
  /** 各 APP 目前選取的日期。 */
  date?: string;
  /** 畫面正在輸入資料時，切換前先詢問。 */
  confirmLeave?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pendingUrl = useRef<string | null>(null);

  const close = () => {
    if (!open) return;
    history.back();
  };

  useEffect(() => {
    if (!open) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    history.pushState({ lifeAppSwitcher: true }, '', location.href);
    const onPopState = () => {
      setOpen(false);
      document.body.style.overflow = oldOverflow;
      const url = pendingUrl.current;
      pendingUrl.current = null;
      if (url) location.assign(url);
      else queueMicrotask(() => triggerRef.current?.focus());
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('popstate', onPopState, { once: true });
    window.addEventListener('keydown', onKeyDown);
    queueMicrotask(() => closeRef.current?.focus());
    return () => {
      document.body.style.overflow = oldOverflow;
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('keydown', onKeyDown);
    };
    // open 為這個效果的完整生命週期；close 只透過 history 觸發 popstate。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const choose = (app: AppDefinition) => {
    if (app.key === current) return close();
    if (confirmLeave && !confirm('目前有尚未儲存的內容，確定要切換功能嗎？')) return;
    pendingUrl.current = appUrl(app, homeUrl, date);
    close();
  };

  return (
    <>
      <button
        ref={triggerRef}
        className="icon-btn app-switcher-trigger"
        type="button"
        title="切換功能"
        aria-label="切換功能"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div className="app-switcher-layer" onMouseDown={(event) => event.target === event.currentTarget && close()}>
          <section className="app-switcher-panel" role="dialog" aria-modal="true" aria-labelledby="app-switcher-title">
            <div className="app-switcher-head">
              <h2 id="app-switcher-title">切換功能</h2>
              <button ref={closeRef} type="button" className="icon-btn" onClick={close} aria-label="關閉功能選單">
                <Icon name="x" />
              </button>
            </div>
            <div className="app-switcher-list">
              {APPS.map((app) => (
                <button
                  type="button"
                  key={app.key}
                  className={app.key === current ? 'active' : ''}
                  aria-current={app.key === current ? 'page' : undefined}
                  onClick={() => choose(app)}
                >
                  <span className="app-switcher-icon"><Icon name={app.icon} /></span>
                  <span>{app.label}</span>
                  {app.key === current && <small>目前</small>}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
