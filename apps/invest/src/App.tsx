import { useEffect, useRef, useState } from 'react';
import {
  AuthError, blankAsset, blankInvestEvent, dividendEligibility, dividendEstimate, GoogleAuth, importInvestRows, INVEST_KINDS, INVEST_PASTE_SHEETS, InvestMoney, investDate,
  investPortfolio, investmentsForMoney, LocalBackend, parseDateText, previewInvestImport, SheetsBackend, todayKey,
  type InvestAsset, type InvestEvent, type InvestImportRow, type InvestSnapshot, type MoneySnapshot, type Txn,
} from '@life/db';
import { AppSwitcher } from '@life/ui/app-switcher';
import { AppTabs, type AppTabItem } from '@life/ui/app-tabs';
import { Icon } from '@life/ui/icon';
import { MonthCalendar } from '@life/ui/month-calendar';
import { dividendHint, Editor, format } from './Editor';
import { refreshQuotes } from './quotes';

type Tab = 'add' | 'calendar' | 'stats' | 'more';
const tabs: AppTabItem<Tab>[] = [
  { key: 'add', label: '新增', icon: 'plus' }, { key: 'calendar', label: '月曆', icon: 'calendar' },
  { key: 'stats', label: '統計', icon: 'chart' }, { key: 'more', label: '更多', icon: 'more' },
];
const params = new URLSearchParams(location.search);
const date = parseDateText(params.get('date') ?? '') ?? todayKey();
const viaMoney = params.has('fromMoney');
const requestedEvent = params.get('event');
const oldMoney = params.get('moneyTxn');
const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim();
const home = import.meta.env.DEV ? `http://${location.hostname}:5172/` : '../';
const pasteKey = (row: InvestImportRow) => `${row.table}:${row.rowNumber}`;
const moneyUrl = (id?: string) => {
  const url = new URL(import.meta.env.DEV ? `http://${location.hostname}:5176/` : '../money/', location.href);
  if (params.has('local')) url.searchParams.set('local', '');
  if (id) {
    url.hash = `edit/money/${encodeURIComponent(id)}`;
    url.searchParams.set('fromInvest', '1');
  }
  return url.href;
};

export function App() {
  const [{ auth, backend, bridge }] = useState(() => {
    const auth = clientId && !params.has('local') ? new GoogleAuth(clientId) : null;
    const backend = auth ? new SheetsBackend(auth) : new LocalBackend();
    return { auth, backend, bridge: new InvestMoney(backend) };
  });
  const [snap, setSnap] = useState<InvestSnapshot | null>(null);
  const [money, setMoney] = useState<MoneySnapshot | null>(null);
  const [tab, setTab] = useState<Tab>(viaMoney || oldMoney || requestedEvent ? 'add' : 'calendar');
  const [day, setDay] = useState(date);
  const [event, setEvent] = useState<InvestEvent | null>(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const [asset, setAsset] = useState<InvestAsset | null>(null);
  const [paste, setPaste] = useState<InvestImportRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<'loading' | 'connect' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const started = useRef(false);
  const running = useRef(false);
  const initialized = useRef<Promise<void> | null>(null);
  const cashInitialized = useRef<Promise<void> | null>(null);
  const loadedRoute = useRef(false);
  const store = bridge.investments;

  async function loadMoney() {
    if (!cashInitialized.current) {
      cashInitialized.current = (backend instanceof SheetsBackend ? backend.init(['hub', 'money']) : backend.init())
        .catch((e) => { cashInitialized.current = null; throw e; });
    }
    await cashInitialized.current;
    const next = await bridge.money.load();
    setMoney(next);
    return next;
  }

  function fail(err: unknown) {
    setError(err instanceof Error ? err.message : String(err));
    if (err instanceof AuthError) { setStatus('connect'); initialized.current = null; cashInitialized.current = null; }
  }

  async function load() {
    if (!initialized.current) {
      initialized.current = (backend instanceof SheetsBackend ? backend.init(['invest']) : backend.init())
        .catch((e) => { initialized.current = null; throw e; });
    }
    await initialized.current;
    const next = await store.load(true);
    setSnap(next);
    setStatus('ready');
    if (loadedRoute.current) return;
    loadedRoute.current = true;
    if (requestedEvent) {
      const row = next.events.find((e) => e.id === requestedEvent);
      if (row) setEvent(row); else setError('找不到這筆投資紀錄');
    }
    if (viaMoney || oldMoney || next.events.find((e) => e.id === requestedEvent)?.moneyId) await loadMoney();
  }

  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (err) { fail(err); }
    finally { running.current = false; setBusy(false); }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        if (auth) {
          await auth.prepare();
          if (!auth.isSignedIn()) { setStatus('connect'); return; }
        }
        await load();
      } catch (err) { setStatus('error'); fail(err); }
    })();
  }, []);

  useEffect(() => {
    if (tab !== 'stats' || !snap) return;
    void run(async () => {
      const result = await refreshQuotes(store, snap.assets);
      await load();
      if (result.failed) setNotice(`${result.failed} 檔未能更新，仍顯示上次的報價。可在「更多」手動補。`);
    });
  }, [tab, Boolean(snap)]);

  const open = (row: InvestEvent) => {
    setEvent(row); setTab('add');
    if (investDate(row)) setDay(investDate(row));
    if (row.moneyId && !money) void run(async () => { await loadMoney(); });
  };
  const after = async (id: string, warning?: string) => {
    await load();
    if (warning) { setNotice(warning); return; }
    if (viaMoney && !oldMoney) {
      const row = (await store.load(true)).events.find((x) => x.id === id);
      if (row?.moneyId && !row.pending) { location.href = moneyUrl(row.moneyId); return; }
    }
    if (oldMoney) {
      await loadMoney();
      setEvent(null);
      setEditorVersion((n) => n + 1);
      setNotice('已儲存投資連結。可繼續補其他標的，或返回原記帳。');
      return;
    }
    setEvent(null); setTab('calendar');
  };
  const save = (draft: InvestEvent, cash: boolean) => void run(async () => {
    if (oldMoney && !draft.moneyId) {
      const ledger = money ?? await loadMoney();
      const txn = ledger.txns.find((t) => t.id === oldMoney);
      if (!txn) throw new Error('找不到原本的記帳交易');
      const account = ledger.accounts.find((a) => a.name === txn.account);
      const source = { ...draft, cashDate: txn.date, cashAccount: txn.account ?? '', cashCurrency: account?.currency ?? draft.cashCurrency };
      const id = await bridge.link(source, oldMoney);
      await after(id);
      return;
    }
    if (cash) {
      if (!money) await loadMoney();
      const result = await bridge.generate(draft);
      if (result.error) {
        await load();
        const saved = (await store.load(true)).events.find((e) => e.id === result.id);
        if (saved) setEvent(saved);
        setNotice(`投資已儲存，記帳待同步：${result.error}`);
        return;
      }
      await after(result.id);
    } else {
      await after(await store.saveEvent(draft));
    }
  });
  const remove = (row: InvestEvent) => {
    if (!window.confirm(row.moneyMode === 'generated' ? '刪除投資及連動記帳？' : '刪除這筆投資紀錄？')) return;
    void run(async () => {
      if (row.moneyId && !money) await loadMoney();
      try { await bridge.remove(row); } finally { await load(); }
      if (viaMoney) { location.href = moneyUrl(); return; }
      setEvent(null); setTab('calendar');
    });
  };
  const retry = (row: InvestEvent) => void run(async () => {
    await loadMoney();
    if (row.removePending) await bridge.remove(row);
    else if (row.moneyMode === 'linked') await bridge.link(row, row.moneyId);
    else {
      const result = await bridge.generate(row);
      if (result.error) { setNotice(`仍待同步：${result.error}`); return; }
    }
    setEvent(null); await load();
  });
  const makePreview = () => void run(async () => {
    const rows = await previewInvestImport(store);
    setPaste(rows); setSelected(new Set(rows.filter((r) => !r.errors.length && !r.duplicate).map(pasteKey)));
  });
  const positions = snap && investPortfolio(snap.assets, snap.events);
  const current = snap ? snap.events.filter((e) => !e.removePending && (
    (e.kind === 'dividend' ? e.cashDate || e.tradeDate : investDate(e)) === day
    || (e.kind === 'switch' && e.secondDate === day)
  )) : [];
  const active = snap?.events.filter((e) => !e.removePending) ?? [];
  const alerts = active.filter((e) => e.kind === 'dividend' && !e.moneyId || dividendHint(e, snap!).startsWith('股數待核對') || positions?.shortages.has(e.id));
  const pending = snap?.events.filter((e) => e.pending) ?? [];
  const oldTxn = money?.txns.find((txn) => txn.id === oldMoney);
  const linkedTxn = oldTxn ?? money?.txns.find((txn) => txn.id === event?.moneyId);
  const moneyGroup = linkedTxn ? investmentsForMoney(active, linkedTxn.id) : [];
  const oldCategory = oldTxn?.lines.find((line) => line.kind === '收入')?.category;
  const editor = event ?? {
    ...blankInvestEvent(oldTxn?.direction === '入' ? oldCategory?.includes('配息') ? 'dividend' : 'redeem' : 'buy', oldMoney ? '' : day),
    cashDate: oldTxn?.date ?? (viaMoney ? day : ''), cashAmount: oldTxn?.direction === '入' ? oldTxn.amount : null, cashAccount: oldTxn?.account ?? '',
    cashCurrency: money?.accounts.find((a) => a.name === oldTxn?.account)?.currency ?? 'TWD',
  };
  return <div className="app invest-app">
    <header className="topbar invest-topbar">
      <AppSwitcher current={params.has('investEditor') ? 'money' : 'invest'} homeUrl={home} date={day} />
      <h1>{params.has('investEditor') ? '記帳 · 投資交易' : '投資'}</h1>
      {/* 2026-11-28 使用者決定：四個分頁在桌面與手機都放在頁首。 */}
      {status === 'ready' && <AppTabs items={tabs} current={tab} placement="top"
        onChange={(next) => { setTab(next); setAsset(null); if (next !== 'add') setEvent(null); }} />}
      <button type="button" className="icon-btn" aria-label="重新整理" title="重新整理"
        disabled={busy || status !== 'ready'} onClick={() => void run(load)}>
        <span className={busy ? 'spin' : ''}><Icon name="refresh" /></span>
      </button>
    </header>
    {error && <p role="alert" className="msg error">{error}</p>}
    {notice && <p role="status" className="msg warn">{notice}</p>}
    {status === 'loading' && <p className="card">讀取投資資料中…</p>}
    {status === 'connect' && <section className="card"><h2>連接 Google 試算表</h2>
      <button className="btn primary" disabled={busy} onClick={() => void run(async () => { await auth?.signIn(); await load(); })}>登入 Google</button>
    </section>}
    {status === 'error' && <button className="btn" onClick={() => void run(load)}>重試</button>}
    {status === 'ready' && snap && <>
      {viaMoney && <p className="hint"><a className="invest-link" href={moneyUrl()}>回記帳 APP</a></p>}
      {pending.length > 0 && <section className="card"><h2>待同步</h2>{pending.map((e) =>
        <div className="invest-actions" key={e.id}><span>{INVEST_KINDS[e.kind]} · {snap.assets.find((a) => a.id === e.asset)?.symbol}</span>
          <button className="btn" disabled={busy} onClick={() => retry(e)}>重試{e.removePending ? '刪除' : '同步'}</button></div>)}</section>}
      {tab === 'add' && <>
        {linkedTxn && <MoneySummary txn={linkedTxn} money={money!} group={moneyGroup} assets={snap.assets}
          busy={busy} onOpen={open} onAllocate={() => {
            if (!window.confirm('依已連結的買進重建這筆扣款的支出明細？銀行實扣金額會保留。')) return;
            void run(async () => { await bridge.allocatePurchases(linkedTxn.id); await loadMoney(); setNotice('已分列買進明細。'); });
          }} />}
        {oldMoney && !linkedTxn && <p className="hint">{money ? '找不到原本的記帳交易。' : '讀取記帳摘要中…'}</p>}
        {event?.moneyId && !event.pending && !linkedTxn && <div className="invest-actions">
          <a className="invest-link" href={moneyUrl(event.moneyId)}>查看記帳</a></div>}
        {oldMoney && !event && <section className="card"><h2>從既有記帳連到投資</h2><ul className="invest-list">
          {active.filter((e) => !e.moneyId && (!moneyGroup.length || e.kind === 'buy')).map((row) => <li key={row.id}><button type="button"
            onClick={() => void run(async () => { await bridge.link(row, oldMoney); await after(row.id); })}>
            {investDate(row)} · {snap.assets.find((a) => a.id === row.asset)?.symbol} · {INVEST_KINDS[row.kind]}</button></li>)}
        </ul></section>}
        {(!oldMoney || oldTxn) && <Editor key={event ? `${event.id}:${event.pending}:${event.moneyId}` : `new:${editorVersion}:${oldTxn?.id ?? ''}`}
          initial={editor} day={day} onDate={setDay} snap={snap} money={money}
          busy={busy} fromMoney={viaMoney} linking={!!oldMoney} onSave={save}
          onQuickAsset={async (symbol) => {
            let id: string | undefined;
            await run(async () => {
              const saved = await store.addAssetBySymbol(symbol);
              await load();
              id = saved;
            });
            return id;
          }}
          onCancel={() => { setEvent(null); if (!oldMoney) setTab('calendar'); else setEditorVersion((n) => n + 1); }}
          onCash={() => { if (!money) void run(async () => { await loadMoney(); }); }}
          onMoney={(row, id) => void run(async () => { await bridge.link(row, id); await after(row.id); })}
          onUnlink={(row) => void run(async () => { await bridge.unlink(row); await after(row.id); })}
          onRemove={remove} />}
      </>}
      {tab === 'calendar' && <>
        <MonthCalendar selected={day} setDate={setDay} dayInfo={(d) => active.some((e) => (
          (e.kind === 'dividend' ? e.cashDate || e.tradeDate : investDate(e)) === d || (e.kind === 'switch' && e.secondDate === d)
        )) ? { marks: [{ color: 'var(--accent)', label: '有投資紀錄' }] } : null} />
        <EventList title={day} rows={current} snap={snap} day={day} onOpen={open} />
        {!!alerts.length && <EventList title="需要處理的資料" rows={alerts} snap={snap} day="" onOpen={open} />}
      </>}
      {tab === 'stats' && positions && <>
        <div className="invest-actions"><button className="btn" disabled={busy} onClick={() => void run(async () => {
          const result = await refreshQuotes(store, snap.assets, true); await load();
          setNotice(`已更新 ${result.updated} 檔；${result.failed} 檔未能更新。`);
        })}>更新估值</button></div>
        <Positions snap={snap} portfolio={positions} onAsset={setAsset} />
        <DividendTotals snap={snap} />
        <EventList title="已實現損益與配息" rows={active.filter((e) => e.kind === 'dividend' || e.kind === 'sell' || e.kind === 'redeem')}
          snap={snap} day="" onOpen={open} />
      </>}
      {tab === 'more' && <>
        <section className="card"><h2>標的與保單</h2><button type="button" className="btn" onClick={() => setAsset({ ...blankAsset })}>新增標的</button>
          <ul className="invest-list">{snap.assets.map((a) => <li key={a.id}><button onClick={() => setAsset(a)}>
            {a.symbol} {a.name}<small>{a.kind === 'pending' ? '類型待補 · ' : ''}{a.account || '未填保管帳戶'} · {a.currency || '幣別待補'}</small></button></li>)}</ul>
        </section>
        <section className="card"><h2>資料與試算表</h2>
          {backend.fileUrl('invest') && <a className="invest-link" target="_blank" rel="noreferrer" href={backend.fileUrl('invest')!}>開啟投資試算表</a>}
          {backend.fileUrl('invest') && <p className="hint">首次自動查基金淨值時，若 investFundQuotes 顯示外部資料授權提示，可在試算表允許存取，再回來更新估值。</p>}
          <p className="hint">將舊資料分別貼成純值，從第 2 列開始。代號欄使用純文字，保留前面的 0。</p>
          <details><summary>各種舊資料的工作表名稱</summary><ul>{Object.entries(INVEST_PASTE_SHEETS).filter(([, kind]) => kind)
            .map(([table, kind]) => <li key={table}>{kind}：{table}</li>)}</ul></details>
          <button className="btn" type="button" onClick={makePreview} disabled={busy}>預覽試算表貼上區</button>
          {paste && <><div className="invest-overflow"><table className="invest-table"><thead><tr><th>匯入</th><th>列號</th><th>代號／日期</th><th>檢查結果</th></tr></thead>
            <tbody>{paste.map((r) => <tr key={pasteKey(r)}><td><input type="checkbox" aria-label={`${INVEST_PASTE_SHEETS[r.table]}第 ${r.rowNumber} 列`}
              disabled={!!r.errors.length} checked={selected.has(pasteKey(r))} onChange={() => setSelected((old) => {
                const key = pasteKey(r);
                const next = new Set(old); if (next.has(key)) next.delete(key); else next.add(key); return next;
              })} /></td><td>{INVEST_PASTE_SHEETS[r.table]} {r.rowNumber}</td><td>{r.asset?.symbol} {r.event && investDate(r.event)}</td>
              <td>{r.errors.length ? r.errors.join('；') : r.duplicate ? '可能重複' : '可以匯入'}</td></tr>)}</tbody></table></div>
            <button className="btn primary" disabled={!selected.size || busy} onClick={() => void run(async () => {
              const count = await importInvestRows(store, paste.filter((r) => selected.has(pasteKey(r))));
              setPaste(null); await load(); setNotice(`已補登 ${count} 筆投資紀錄。`);
            })}>匯入 {selected.size} 筆</button></>}
        </section>
      </>}
      {asset && <AssetForm key={asset.id || 'new'} initial={asset} close={() => setAsset(null)} busy={busy} save={(a) => void run(async () => {
        await store.saveAsset(a); setAsset(null); await load();
      })} />}
    </>}
  </div>;
}

function MoneySummary({ txn, money, group, assets, busy, onOpen, onAllocate }: {
  txn: Txn; money: MoneySnapshot; group: InvestEvent[]; assets: InvestAsset[];
  busy: boolean; onOpen: (event: InvestEvent) => void; onAllocate: () => void;
}) {
  const bank = money.accounts.find((account) => account.name === txn.account);
  const net = txn.origCurrency && bank?.currency === 'TWD' ? txn.twdAmount : txn.amount;
  return <section className="card">
    <h2>原記帳摘要</h2>
    <p>{txn.date} · {txn.account || '帳戶未填'} · {txn.direction === '入' ? '實收' : '實扣'} {bank?.currency || txn.currency || 'TWD'} {format(net)}</p>
    {txn.note && <p className="hint">{txn.note}</p>}
    {group.length > 0 && <ul className="invest-list">{group.map((event) => {
      const asset = assets.find((row) => row.id === event.asset);
      return <li key={event.id}><button type="button" onClick={() => onOpen(event)}>
        {asset?.symbol} {asset?.name} · {INVEST_KINDS[event.kind]}{event.pending ? '（待同步）' : ''}
      </button></li>;
    })}</ul>}
    {oldMoney && txn.direction === '出' && <p className="hint">同一筆扣款買多檔時，請分別填各標的的實扣金額。</p>}
    <div className="invest-actions">
      <a className="invest-link" href={moneyUrl(txn.id)}>查看原記帳</a>
      {group.length > 1 && txn.direction === '出' && <button className="btn" type="button" disabled={busy} onClick={onAllocate}>按標的分列記帳明細</button>}
    </div>
  </section>;
}

function EventList({ title, rows, snap, day, onOpen }: {
  title: string; rows: InvestEvent[]; snap: InvestSnapshot; day: string; onOpen: (event: InvestEvent) => void;
}) {
  const p = investPortfolio(snap.assets, snap.events);
  return <section className="card"><h2>{title}</h2>{rows.length ? <ul className="invest-list">
    {rows.map((e) => {
      const a = snap.assets.find((a) => a.id === e.asset);
      const gain = p.gains.get(e.id);
      const hint = dividendHint(e, snap);
      const forecast = a && e.kind === 'dividend' && e.cashAmount == null
        ? dividendEstimate(e, dividendEligibility(e, snap.assets, snap.events), a) : null;
      return <li key={e.id}><button type="button" onClick={() => onOpen(e)}>
        <strong>{!day && `${investDate(e)} · `}{e.kind === 'switch' && day === e.secondDate && day !== investDate(e) ? '基金換入' : INVEST_KINDS[e.kind]} · {a?.symbol} {a?.name}</strong>
        <small>{e.quantity != null ? `${format(e.quantity)} ${a?.kind === 'stock' ? '股' : '單位'}` : ''}
          {e.cashAmount != null ? ` · ${e.cashCurrency} ${format(e.cashAmount)}` : ''}
          {forecast != null ? ` · 推算實收 ${e.cashCurrency || '幣別待補'} ${format(forecast)}` : ''}
          {gain?.native != null ? ` · 損益 ${a?.currency} ${format(gain.native)}` : ''}
          {gain?.twd != null && a?.currency !== 'TWD' ? ` · 台幣損益 ${format(gain.twd)}` : ''}</small>
        {hint.startsWith('股數待核對') && <span className="msg warn">{hint}</span>}
        {e.kind === 'dividend' && !e.moneyId && <span className={e.cashDate && e.cashDate <= todayKey() ? 'msg warn' : 'hint'}>尚未連結記帳</span>}
        {e.kind === 'switch' && !e.secondQuantity && <small>待補換入</small>}
        {p.shortages.has(e.id) && <small>買進資料待補，損益尚未計算</small>}
        {!e.tradeDate && e.kind !== 'dividend' && <small>成交日未提供</small>}
      </button></li>;
    })}
  </ul> : <p className="hint">沒有紀錄</p>}</section>;
}

function DividendTotals({ snap }: { snap: InvestSnapshot }) {
  const totals = new Map<string, { actual: number; estimate: number; missing: number }>();
  for (const e of snap.events) {
    if (e.kind !== 'dividend' || e.removePending || !e.cashDate || e.cashDate > todayKey()) continue;
    const asset = snap.assets.find((a) => a.id === e.asset);
    const currency = e.cashCurrency || asset?.currency || '幣別待補';
    const amounts = totals.get(currency) ?? { actual: 0, estimate: 0, missing: 0 };
    if (e.cashAmount != null) amounts.actual += e.cashAmount;
    else {
      const estimate = asset && dividendEstimate(e, dividendEligibility(e, snap.assets, snap.events), asset);
      if (estimate == null) amounts.missing++;
      else amounts.estimate += estimate;
    }
    totals.set(currency, amounts);
  }
  return <section className="card"><h2>現金股利</h2>
    {totals.size ? [...totals].map(([currency, a]) => <p key={currency}>{currency} · 確認實收 {format(a.actual)}
      {a.estimate > 0 && ` · 另有推算 ${format(a.estimate)}`}{a.missing > 0 && ` · 待補金額 ${a.missing} 筆`}</p>)
      : <p className="hint">還沒有已到發放日的股利</p>}
  </section>;
}

function Positions({ snap, portfolio, onAsset }: {
  snap: InvestSnapshot; portfolio: ReturnType<typeof investPortfolio>; onAsset: (a: InvestAsset) => void;
}) {
  const list = [...portfolio.positions.values()].filter((p) => p.quantity > 0 || p.incomplete);
  const policies = new Map<string, string[]>();
  for (const a of snap.assets.filter((a) => a.kind === 'policy')) {
    const key = a.account || a.symbol;
    policies.set(key, [...(policies.get(key) ?? []), a.id]);
  }
  return <>
    <section className="card"><h2>目前持有</h2>{!list.length && <p>還沒有持有部位</p>}
      <ul className="invest-list">{list.map((p) => {
        const a = p.asset;
        const value = a.quote == null ? null : p.quantity * a.quote;
        const twd = value != null && a.quoteFx ? value * a.quoteFx : null;
        return <li key={a.id}><button type="button" onClick={() => onAsset(a)}>
          <strong>{a.symbol} {a.name} · {format(p.quantity)} {a.kind === 'stock' ? '股' : '單位'}</strong>
          <small>{a.currency || '幣別待補'} · 成本 {format(p.cost)} · 平均 {format(p.cost != null && p.quantity > 0 ? p.cost / p.quantity : null)} ·
            市值 {format(value)} · 帳面損益 {format(value == null || p.cost == null ? null : value - p.cost)}</small>
          {a.currency !== 'TWD' && <small>台幣成本 {format(p.twdCost)} · 台幣市值 {format(twd)} · 台幣損益 {format(twd == null || p.twdCost == null ? null : twd - p.twdCost)}</small>}
          <small>價格／淨值 {format(a.quote)} · {a.quoteDate || '未更新'} · {a.quoteSource || '無來源'}{a.kind === 'policy' && ` · 單位數更新至 ${p.lastDate}`}</small>
          {a.quoteFx != null && a.currency !== 'TWD' && <small>估值匯率 {a.quoteFx} · {a.quoteFxDate || '日期未填'}</small>}
          {p.incomplete && <span className="msg warn">買進資料待補</span>}
        </button></li>;
      })}</ul>
    </section>
    {[...policies].map(([name, ids]) => {
      const rows = snap.events.filter((e) => ids.includes(e.asset) && !e.removePending && investDate(e) <= todayKey());
      const totals = (condition: (e: InvestEvent) => boolean) => rows.filter(condition).reduce((sum, e) => {
        const a = snap.assets.find((a) => a.id === e.asset);
        const amount = e.cashCurrency === 'TWD' && e.cashAmount != null ? e.cashAmount
          : a?.currency === 'TWD' ? e.originalAmount : e.fx && e.originalAmount != null ? e.originalAmount * e.fx : null;
        return sum == null || amount == null ? null : sum + amount;
      }, 0 as number | null);
      const valuation = ids.map((id) => portfolio.positions.get(id)).reduce((sum, p) => {
        if (!p || p.quantity === 0) return sum;
        const rate = p.asset.currency === 'TWD' ? 1 : p.asset.quoteFx;
        return sum == null || p.asset.quote == null || rate == null || p.incomplete ? null : sum + p.quantity * p.asset.quote * rate;
      }, 0 as number | null);
      return <section className="card" key={name}><h2>{name}</h2><p>已繳保費 NT$ {format(totals((e) => e.kind === 'premium'))}</p>
        <p>加值回饋 NT$ {format(totals((e) => e.kind === 'bonus'))}</p>
        <p>保單內扣費用 NT$ {format(totals((e) => e.kind === 'insuranceCost' || e.kind === 'policyFee'))}</p>
        <p>目前保單估算價值 NT$ {format(valuation)}</p></section>;
    })}
  </>;
}

function AssetForm({ initial, close, save, busy }: {
  initial: InvestAsset; close: () => void; save: (a: InvestAsset) => void; busy: boolean;
}) {
  const [a, set] = useState(initial);
  const field = (key: 'symbol' | 'name' | 'account' | 'currency' | 'market' | 'quoteUrl' | 'quoteDate' | 'quoteFxDate', title: string, type = 'text') =>
    <label className="field">{title}<input type={type} value={a[key]} onChange={(e) => set({ ...a, [key]: e.currentTarget.value })} /></label>;
  return <form className="card" onSubmit={(ev) => { ev.preventDefault(); save(a); }}>
    <h2>{initial.id ? '編輯標的與估值' : '新增標的'}</h2>
    <div className="invest-grid">
      {field('symbol', '標的代號')}{field('name', '標的名稱')}
      <label className="field">類型<select value={a.kind} onChange={(e) => set({ ...a, kind: e.currentTarget.value as InvestAsset['kind'] })}>
        {a.kind === 'pending' && <option value="pending">類型待補</option>}
        <option value="stock">股票／ETF</option><option value="fund">基金</option><option value="policy">保單基金</option>
      </select></label>
      {field('account', '券商／保單名稱')}{field('currency', '計價幣別（可待補）')}{field('market', '市場（例如 TW、US）')}
      {a.kind !== 'stock' && field('quoteUrl', '公開基金淨值網址', 'url')}
      <label className="field">最新價格／淨值<input type="number" step="any" min="0" value={a.quote ?? ''} onChange={(e) =>
        set({ ...a, quote: e.currentTarget.value ? e.currentTarget.valueAsNumber : null, quoteSource: '手動更新', quoteDate: a.quoteDate || todayKey() })} /></label>
      {field('quoteDate', '淨值／報價日期', 'date')}
      <label className="field">估值用台幣匯率<input type="number" step="any" min="0" value={a.quoteFx ?? ''} onChange={(e) =>
        set({ ...a, quoteFx: e.currentTarget.value ? e.currentTarget.valueAsNumber : null, quoteFxDate: a.quoteFxDate || todayKey() })} /></label>
      {field('quoteFxDate', '估值匯率日期', 'date')}
    </div>
    {a.kind !== 'stock' && <p className="hint">請填對應基金級別的摩根或鉅亨公開頁。瀚亞可填公開淨值總表，名稱要和網站列出的完整級別及幣別相同。</p>}
    <div className="invest-actions"><button className="btn primary" disabled={busy}>儲存標的</button>
      <button type="button" className="btn" onClick={close}>取消</button></div>
  </form>;
}
