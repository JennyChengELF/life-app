import { useState } from 'react';
import { Icon } from '@life/ui/icon';
import type { TimelineEntry } from '@life/db';
import { bowelEntries, bowelHomeMessage, editHash, fmtMoney, depositsDue, healthEntries, loanReminders, moneyDayTotals, moneyEntries, stocktakeStatus, sortEntries, todayKey, waterEntries, waterSummary } from '@life/db';
import { DateNav, Timeline } from '@life/ui/timeline';
import { AppSwitcher } from '@life/ui/app-switcher';
import { CalendarReminderList } from '@life/ui/calendar-reminder-list';
import { useHub } from './useHub';

const HOME_URL = import.meta.env.DEV ? `http://${location.hostname}:5172/` : './';

type AppKey = 'water' | 'health' | 'bowel' | 'money' | 'calendar' | 'period';

/**
 * 各 APP 的網址：上線時在同一個網站的子路徑（water/、health/、bowel/）；
 * 開發時每個 APP 是不同的 port。網址有 ?local（本機測試模式）時一起帶過去。
 */
const DEV_PORTS: Record<AppKey, number> = { water: 5173, health: 5174, bowel: 5175, money: 5176, calendar: 5177, period: 5178 };
function appUrl(app: AppKey, hash = '', date?: string) {
  const params = new URLSearchParams();
  if (new URLSearchParams(location.search).has('local')) params.set('local', '');
  if (date && date !== todayKey()) params.set('date', date);
  const q = params.size ? `?${params.toString()}` : '';
  return import.meta.env.DEV ? `http://${location.hostname}:${DEV_PORTS[app]}/${q}${hash}` : `${app}/${q}${hash}`;
}

function requestedDate() {
  const value = new URLSearchParams(location.search).get('date');
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= todayKey() ? value : todayKey();
}

export function App() {
  const hub = useHub();
  const [date, setDate] = useState(requestedDate);

  return (
    <div className="app hub">
      <header className="topbar">
        <AppSwitcher current="hub" homeUrl={HOME_URL} date={date} />
        <h1>生活</h1>
        {hub.status === 'ready' && (
          <button className="icon-btn" onClick={hub.refresh} disabled={hub.busy} title="重新整理（讀取試算表最新資料）" aria-label="重新整理">
            <span className={hub.busy ? 'spin' : ''}>
              <Icon name="refresh" />
            </span>
          </button>
        )}
      </header>
      {hub.mode === 'local' && <div className="mode-banner">本機測試模式：資料只存在這個瀏覽器，還沒接上 Google 試算表</div>}
      <main>
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
  // 借出太久沒還（天數在記帳 APP 設定，2026-11-18）
  const loans = loanReminders(hub.moneySnap);
  // 定存 7 天內到期、或已到期還沒處理（2026-11-18）
  const deps = depositsDue(hub.moneySnap.deposits, todayKey());
  // 月底盤點：每月最後一天起，到盤點完或下個月 10 號（2026-11-18 確認）
  const stocktake = stocktakeStatus(hub.moneySnap, todayKey());
  const depCur = (name: string) => hub.moneySnap!.accounts.find((a) => a.name === name)?.currency ?? 'TWD';
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
      {date === todayKey() && hub.calendarError && <div className="msg warn">暫時無法讀取行程提醒</div>}
      {date === todayKey() && hub.calendarSnap && <CalendarReminderList snapshot={hub.calendarSnap} eventHref={(event) => appUrl('calendar', `#event/${encodeURIComponent(event.id)}`, event.startDate)} />}
      {stocktake && stocktake.pending.length > 0 && (
        <div className="messages">
          <a className="msg warn" href={appUrl('money', '#stocktake')}>
            🧮 {Number(stocktake.month.slice(5))} 月底盤點：還有 {stocktake.pending.length} 個帳戶沒盤點（{stocktake.to.slice(5).replace('-', '/')} 前）
          </a>
        </div>
      )}
      {deps.length > 0 && (
        <div className="messages">
          {deps.map((d) => (
            <a key={d.id} className="msg warn" href={appUrl('money')}>
              🏦 定存 {fmtMoney(d.principal, depCur(d.account))}（{d.account}）{d.maturityDate < todayKey() ? '已經' : '將在 '}
              {d.maturityDate.slice(5).replace('-', '/')} 到期，記得解約或續存
            </a>
          ))}
        </div>
      )}
      {loans.length > 0 && (
        <div className="messages">
          {loans.map((l) => (
            <a key={l.person + l.currency} className="msg warn" href={appUrl('money')}>
              🤝 {l.person} 欠你 {fmtMoney(l.amount, l.currency)}，已經 {l.days} 天
            </a>
          ))}
        </div>
      )}
      {bowelMsg && (
        <div className="messages">
          <div className="msg info">
            💩 {bowelMsg.text}
            {bowelMsg.weightGain != null && `；今天體重 +${bowelMsg.weightGain}kg 屬正常現象`}
          </div>
        </div>
      )}
      <section className="card">
        {/* 2026-11-22 使用者決定：綜合首頁尚在規劃，暫時只用日期列，不顯示月曆與快速按鈕。 */}
        <DateNav date={date} setDate={setDate} />
        <a className="water-sum" href={appUrl('water', '', date)}>
          <span className="sum-icon">
            <Icon name="droplet" size={18} />
          </span>
          <span className="water-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="喝水進度">
            <i style={{ width: `${pct}%` }} />
          </span>
          <span className="water-text">
            {w.total.toLocaleString()} / {w.goal.toLocaleString()} ml{' '}
            <span className="muted small">{left > 0 ? `還差 ${left.toLocaleString()}` : '已達標 🎉'}</span>
          </span>
        </a>
        {(money.expense !== 0 || money.income !== 0) && (
          <a className="money-sum" href={appUrl('money', '', date)}>
            <span className="sum-icon">
              <Icon name="wallet" size={18} />
            </span>
            支出 <b>{fmtMoney(money.expense)}</b>
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
