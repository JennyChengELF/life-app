import { useState } from 'react';
import type { TimelineEntry } from '@life/db';
import { bowelEntries, bowelHomeMessage, editHash, healthEntries, sortEntries, todayKey, waterEntries, waterSummary } from '@life/db';
import { DateNav, Timeline } from '@life/ui/timeline';
import { useHub } from './useHub';

type AppKey = 'water' | 'health' | 'bowel';

/**
 * 各 APP 的網址：上線時在同一個網站的子路徑（water/、health/、bowel/）；
 * 開發時每個 APP 是不同的 port。網址有 ?local（本機測試模式）時一起帶過去。
 */
const DEV_PORTS: Record<AppKey, number> = { water: 5173, health: 5174, bowel: 5175 };
function appUrl(app: AppKey, hash = '') {
  const q = new URLSearchParams(location.search).has('local') ? '?local' : '';
  return import.meta.env.DEV ? `http://${location.hostname}:${DEV_PORTS[app]}/${q}${hash}` : `${app}/${q}${hash}`;
}

const TILES: { app: AppKey; hash: string; icon: string; label: string }[] = [
  { app: 'water', hash: '', icon: '💧', label: '喝水' },
  // 一鍵記錄：打開排便 APP 就記一筆、展開詳細欄位，填完回首頁（2026-11-18 確認）
  { app: 'bowel', hash: '#new', icon: '💩', label: '記排便' },
  { app: 'health', hash: '#new', icon: '⚖️', label: '記體重' },
  { app: 'health', hash: '#bp', icon: '🩸', label: '記血壓' },
  { app: 'health', hash: '#glucose', icon: '🍬', label: '記血糖' },
  { app: 'health', hash: '', icon: '🩺', label: '健康' },
  { app: 'bowel', hash: '', icon: '📅', label: '排便' },
];

export function App() {
  const hub = useHub();
  const [date, setDate] = useState(todayKey);

  return (
    <div className="app hub">
      <header className="topbar">
        <h1>🏠 生活</h1>
        {hub.status === 'ready' && (
          <button className="icon-btn" onClick={hub.refresh} disabled={hub.busy} title="重新整理（讀取試算表最新資料）">
            <span className={hub.busy ? 'spin' : ''}>⟳</span>
          </button>
        )}
      </header>
      {hub.mode === 'local' && <div className="mode-banner">本機測試模式：資料只存在這個瀏覽器，還沒接上 Google 試算表</div>}
      <main>
        <nav className="launcher">
          {TILES.map((t) => (
            <a key={t.label} className="tile" href={appUrl(t.app, t.hash)}>
              <span className="tile-icon">{t.icon}</span>
              {t.label}
            </a>
          ))}
        </nav>
        <Day hub={hub} date={date} setDate={setDate} />
      </main>
    </div>
  );
}

function Day({ hub, date, setDate }: { hub: ReturnType<typeof useHub>; date: string; setDate: (d: string) => void }) {
  if (hub.status === 'starting' || (hub.status === 'loading' && !hub.waterSnap)) return <div className="center muted">讀取中⋯⋯</div>;
  if (hub.status === 'need-connect')
    return (
      <div className="center connect">
        <p>連上 Google 試算表，就能在這裡看每天的紀錄。</p>
        <button className="primary big" onClick={hub.connect}>
          連線 Google
        </button>
        {hub.error && <p className="error-text">{hub.error}</p>}
      </div>
    );
  if (hub.status === 'error' || !hub.waterSnap || !hub.healthSnap || !hub.bowelSnap)
    return (
      <div className="center">
        <p className="error-text">{hub.error ?? '讀取失敗'}</p>
        <button className="primary" onClick={() => location.reload()}>
          重新載入
        </button>
      </div>
    );

  const w = waterSummary(hub.waterSnap, date);
  const entries = sortEntries([...healthEntries(hub.healthSnap, date), ...waterEntries(hub.waterSnap, date), ...bowelEntries(hub.bowelSnap, date)]);
  // 昨天排便較少（「喝水 +500ml」按鈕等喝水的加量功能做好再加）
  const bowelMsg = bowelHomeMessage(hub.bowelSnap, hub.healthSnap.body);
  const pct = w.goal > 0 ? Math.min(100, Math.round((w.total / w.goal) * 100)) : 0;
  const left = w.goal - w.total;

  // 點一列：打開那個 APP 的修改畫面（改完會回到首頁）
  const pick = (e: TimelineEntry) => {
    location.href = appUrl(e.ref.app, editHash(e.ref));
  };

  return (
    <>
      {bowelMsg && (
        <div className="messages">
          <div className="msg info">
            💩 {bowelMsg.text}
            {bowelMsg.weightGain != null && `；今天體重 +${bowelMsg.weightGain}kg 屬正常現象`}
          </div>
        </div>
      )}
      <section className="card">
        <DateNav date={date} setDate={setDate} />
        <a className="water-sum" href={appUrl('water')}>
          <span>💧</span>
          <span className="water-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="喝水進度">
            <i style={{ width: `${pct}%` }} />
          </span>
          <span className="water-text">
            {w.total.toLocaleString()} / {w.goal.toLocaleString()} ml{' '}
            <span className="muted small">{left > 0 ? `還差 ${left.toLocaleString()}` : '已達標 🎉'}</span>
          </span>
        </a>
        <Timeline entries={entries} onPick={pick} />
      </section>
    </>
  );
}
