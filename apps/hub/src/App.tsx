import { useState } from 'react';
import type { TimelineEntry } from '@life/db';
import { bowelEntries, bowelHomeMessage, editHash, fmtMoney, healthEntries, moneyDayTotals, moneyEntries, resolvePinned, sortEntries, todayKey, waterEntries, waterSummary } from '@life/db';
import { DateNav, Timeline } from '@life/ui/timeline';
import { useHub } from './useHub';

type AppKey = 'water' | 'health' | 'bowel' | 'money';

/**
 * 各 APP 的網址：上線時在同一個網站的子路徑（water/、health/、bowel/）；
 * 開發時每個 APP 是不同的 port。網址有 ?local（本機測試模式）時一起帶過去。
 */
const DEV_PORTS: Record<AppKey, number> = { water: 5173, health: 5174, bowel: 5175, money: 5176 };
function appUrl(app: AppKey, hash = '') {
  const q = new URLSearchParams(location.search).has('local') ? '?local' : '';
  return import.meta.env.DEV ? `http://${location.hostname}:${DEV_PORTS[app]}/${q}${hash}` : `${app}/${q}${hash}`;
}

interface Tile {
  key: string;
  app: AppKey;
  hash: string;
  icon: string;
  label: string;
}

/** 所有按鈕（key 存在設定裡，不要改） */
const TILES: Tile[] = [
  { key: 'water', app: 'water', hash: '', icon: '💧', label: '喝水' },
  // 一鍵記錄：打開排便 APP 就記一筆、展開詳細欄位，填完回首頁（2026-11-18 確認）
  { key: 'bowelNew', app: 'bowel', hash: '#new', icon: '💩', label: '記排便' },
  { key: 'body', app: 'health', hash: '#new', icon: '⚖️', label: '記體重' },
  { key: 'bp', app: 'health', hash: '#bp', icon: '🩸', label: '記血壓' },
  { key: 'glucose', app: 'health', hash: '#glucose', icon: '🍬', label: '記血糖' },
  { key: 'temp', app: 'health', hash: '#temp', icon: '🌡️', label: '記體溫' },
  { key: 'health', app: 'health', hash: '', icon: '🩺', label: '健康' },
  { key: 'bowel', app: 'bowel', hash: '', icon: '🚽', label: '排便' },
  { key: 'moneyNew', app: 'money', hash: '#new', icon: '✏️', label: '記一筆' },
  { key: 'money', app: 'money', hash: '', icon: '💰', label: '記帳' },
];
const tileOf = (k: string) => TILES.find((t) => t.key === k)!;

/**
 * 類別（2026-11-18 確認：首頁上面是自己勾的「常用」，下面是類別資料夾，所有功能都找得到）。
 * 💡 目前有健康、記帳；子彈筆記等做好再加
 */
const GROUPS: { key: string; icon: string; label: string; tiles: string[] }[] = [
  { key: 'health', icon: '🩺', label: '健康', tiles: ['water', 'bowelNew', 'body', 'bp', 'glucose', 'temp', 'health', 'bowel'] },
  { key: 'money', icon: '💰', label: '記帳', tiles: ['moneyNew', 'money'] },
];

/** 💡 還沒設定過時的常用（和原本首頁一樣） */
const DEFAULT_PINNED = ['water', 'bowelNew', 'body', 'bp', 'glucose'];

function TileLink({ t }: { t: Tile }) {
  return (
    <a className="tile" href={appUrl(t.app, t.hash)}>
      <span className="tile-icon">{t.icon}</span>
      {t.label}
    </a>
  );
}

function Launcher({ hub }: { hub: ReturnType<typeof useHub> }) {
  const pinned = resolvePinned(
    hub.hubSnap?.settings.pinned ?? null,
    TILES.map((t) => t.key),
    DEFAULT_PINNED,
  );
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string[] | null>(null);
  // 還沒連上試算表時不能存設定
  const canEdit = hub.status === 'ready' && !!hub.hubSnap;

  if (editing) return <PinEditor initial={editing} hub={hub} onClose={() => setEditing(null)} />;

  const group = GROUPS.find((g) => g.key === open);
  return (
    <>
      <div className="launch-head">
        <span className="muted small">常用</span>
        {canEdit && (
          <button className="link small" onClick={() => setEditing(pinned)}>
            ✏️ 編輯
          </button>
        )}
      </div>
      {pinned.length > 0 ? (
        <nav className="launcher">
          {pinned.map((k) => (
            <TileLink key={k} t={tileOf(k)} />
          ))}
        </nav>
      ) : (
        <p className="muted small">還沒有常用的按鈕，按「編輯」勾選。</p>
      )}
      <nav className="groups">
        {GROUPS.map((g) => (
          <button key={g.key} className={open === g.key ? 'active' : ''} aria-expanded={open === g.key} onClick={() => setOpen(open === g.key ? null : g.key)}>
            {g.icon} {g.label} {open === g.key ? '▴' : '▾'}
          </button>
        ))}
      </nav>
      {group && (
        <nav className="launcher group-tiles">
          {group.tiles.map((k) => (
            <TileLink key={k} t={tileOf(k)} />
          ))}
        </nav>
      )}
    </>
  );
}

/** 勾選常用的按鈕、調整順序 */
function PinEditor({ initial, hub, onClose }: { initial: string[]; hub: ReturnType<typeof useHub>; onClose: () => void }) {
  const [keys, setKeys] = useState(initial);
  const move = (k: string, d: -1 | 1) => {
    const i = keys.indexOf(k);
    const j = i + d;
    if (j < 0 || j >= keys.length) return;
    const next = [...keys];
    [next[i], next[j]] = [next[j], next[i]];
    setKeys(next);
  };
  const toggle = (k: string) => setKeys(keys.includes(k) ? keys.filter((x) => x !== k) : [...keys, k]);
  // 勾選的依順序在前，沒勾的照原本順序在後
  const rows = [...keys.map(tileOf), ...TILES.filter((t) => !keys.includes(t.key))];
  return (
    <section className="card pin-editor">
      <h2>首頁常用的按鈕</h2>
      <p className="muted small">勾選的會顯示在首頁上面，用 ↑↓ 調整順序。沒勾的在下面的類別裡還是找得到。</p>
      <ul className="order-list">
        {rows.map((t) => {
          const on = keys.includes(t.key);
          const i = keys.indexOf(t.key);
          return (
            <li key={t.key} className={on ? '' : 'off'}>
              <label className="check">
                <input type="checkbox" checked={on} onChange={() => toggle(t.key)} />
                {t.icon} {t.label}
              </label>
              {on && (
                <>
                  <button className="icon-small" onClick={() => move(t.key, -1)} disabled={i === 0} aria-label={`${t.label} 往前`}>
                    ↑
                  </button>
                  <button className="icon-small" onClick={() => move(t.key, 1)} disabled={i === keys.length - 1} aria-label={`${t.label} 往後`}>
                    ↓
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {hub.error && <p className="error-text small">{hub.error}</p>}
      <div className="editor-actions">
        <button
          className="primary"
          disabled={hub.busy}
          onClick={async () => {
            if (await hub.savePinned(keys)) onClose();
          }}
        >
          儲存
        </button>
        <button onClick={onClose}>取消</button>
        <button className="link" onClick={() => setKeys(DEFAULT_PINNED)}>
          恢復預設
        </button>
      </div>
    </section>
  );
}

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
        <Launcher hub={hub} />
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
  if (hub.status === 'error' || !hub.waterSnap || !hub.healthSnap || !hub.bowelSnap || !hub.moneySnap)
    return (
      <div className="center">
        <p className="error-text">{hub.error ?? '讀取失敗'}</p>
        <button className="primary" onClick={() => location.reload()}>
          重新載入
        </button>
      </div>
    );

  const w = waterSummary(hub.waterSnap, date);
  const entries = sortEntries([
    ...healthEntries(hub.healthSnap, date),
    ...waterEntries(hub.waterSnap, date),
    ...bowelEntries(hub.bowelSnap, date),
    ...moneyEntries(hub.moneySnap, date),
  ]);
  const money = moneyDayTotals(hub.moneySnap, date);
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
        {(money.expense !== 0 || money.income !== 0) && (
          <a className="money-sum" href={appUrl('money')}>
            💰 支出 <b>{fmtMoney(money.expense)}</b>
            {money.income !== 0 && (
              <>
                {' '}・ 收入 <b>{fmtMoney(money.income)}</b>
              </>
            )}
          </a>
        )}
        <Timeline entries={entries} onPick={pick} />
      </section>
    </>
  );
}
