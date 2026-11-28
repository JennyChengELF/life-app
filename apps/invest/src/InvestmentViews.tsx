import { useState, type CSSProperties } from 'react';
import { fmtMoney, INVEST_KINDS, investDate, type InvestAsset, type InvestEvent, type InvestPosition, type InvestSnapshot } from '@life/db';
import { Icon, type IconName } from '@life/ui/icon';
import { dividendHint, format } from './Editor';

export const assetKinds = [
  { kind: 'stock', label: '股票', icon: 'trend', color: '#246dcc' },
  { kind: 'fund', label: '基金', icon: 'wallet', color: '#168477' },
  { kind: 'policy', label: '保單', icon: 'clipboard', color: '#7954b3' },
  { kind: 'pending', label: '類型待補', icon: 'tag', color: '#737b8a' },
] as const satisfies ReadonlyArray<{ kind: InvestAsset['kind']; label: string; icon: IconName; color: string }>;

const unit = (asset?: InvestAsset) => asset?.kind === 'stock' ? '股' : '單位';
const tradeDate = (event: InvestEvent) => event.kind === 'dividend' ? event.cashDate || event.tradeDate : investDate(event);
const tradeGroups = ['買進', '賣出', '轉換', '股利／配息', '保費與費用', '保單回饋'] as const;

function changes(events: InvestEvent[], assets: InvestAsset[]) {
  return events.flatMap((event) => {
    const date = tradeDate(event);
    const asset = assets.find((item) => item.id === event.asset);
    const group = event.kind === 'buy' ? '買進' : event.kind === 'sell' || event.kind === 'redeem' ? '賣出' :
      event.kind === 'switch' ? '轉換' : event.kind === 'bonus' ? '保單回饋' :
        ['dividend', 'stockDividend'].includes(event.kind) ? '股利／配息' : '保費與費用';
    const negative = ['sell', 'redeem', 'switch', 'insuranceCost', 'policyFee'].includes(event.kind);
    const quantity = event.kind === 'dividend' || event.quantity == null ? null : event.quantity * (negative ? -1 : 1);
    const rows = [{ key: event.id, event, asset, date, group, quantity,
      label: event.kind === 'switch' ? '基金轉出' : INVEST_KINDS[event.kind], incoming: false }];
    if (event.kind !== 'switch' || !event.secondDate) return rows;
    return [...rows, { key: `${event.id}:in`, event, asset: assets.find((item) => item.id === event.secondAsset),
      date: event.secondDate, group, label: '基金轉入', quantity: event.secondQuantity, incoming: true }];
  }).filter((row) => row.date);
}

function TradeRows({ rows, snap, onOpen, shortages }: {
  rows: ReturnType<typeof changes>; snap: InvestSnapshot; shortages: Set<string>; onOpen: (event: InvestEvent) => void;
}) {
  return <ul className="app-row-list">{rows.map(({ key, event, asset, label, quantity, incoming }) => {
    const kind = assetKinds.find((item) => item.kind === asset?.kind) ?? assetKinds[3];
    const hint = dividendHint(event, snap);
    return <li key={key}><button type="button" className="app-row" onClick={() => onOpen(event)}>
      <span className={`invest-row-icon invest-kind-${kind.kind}`}><Icon name={kind.icon} /></span>
      <span className="app-row-main">
        <strong>{asset ? `${asset.symbol} ${asset.name}` : '標的待補'}</strong>
        <small>{label}{!incoming && event.cashAmount != null && ` · ${fmtMoney(event.cashAmount, event.cashCurrency)}`}</small>
        {shortages.has(event.id) && <small className="invest-row-alert">買進資料待補，損益尚未計算</small>}
        {hint.startsWith('股數待核對') && <small className="invest-row-alert">{hint}</small>}
        {event.kind === 'dividend' && !event.moneyId && <small>尚未連結記帳</small>}
      </span>
      {quantity != null && <strong className={`app-row-value ${quantity < 0 ? 'invest-quantity-out' : 'invest-quantity-in'}`}>
        {quantity > 0 ? '+' : quantity < 0 ? '−' : ''}{format(Math.abs(quantity))} {unit(asset)}
      </strong>}
      {quantity == null && event.kind !== 'dividend' && <small className="app-row-value">數量待補</small>}
    </button></li>;
  })}</ul>;
}

export function DayInvestmentList({ day, snap, onOpen, shortages }: {
  day: string; snap: InvestSnapshot; shortages: Set<string>; onOpen: (event: InvestEvent) => void;
}) {
  const rows = changes(snap.events.filter((row) => !row.removePending), snap.assets).filter((row) => row.date === day);
  return <div className="invest-day-list">
    <h2>{day} 投資紀錄</h2>
    {!rows.length && <p className="card hint">這天沒有投資紀錄</p>}
    {assetKinds.map(({ kind, label }) => {
      const group = rows.filter((row) => (row.asset?.kind ?? 'pending') === kind);
      if (!group.length) return null;
      return <section className="card" key={kind}>
        <h3>{kind === 'policy' ? '保險' : label}</h3>
        {tradeGroups.map((trade) => {
          const items = group.filter((row) => row.group === trade);
          return items.length > 0 && <section key={trade} className="invest-trade-group">
            <h4>{trade}</h4><TradeRows rows={items} snap={snap} shortages={shortages} onOpen={onOpen} />
          </section>;
        })}
      </section>;
    })}
  </div>;
}

export function marketValueTwd(position: InvestPosition) {
  const { asset, quantity } = position;
  if (quantity <= 0 || asset.quote == null || !asset.currency) return null;
  const fx = asset.currency === 'TWD' ? 1 : asset.quoteFx;
  return fx && fx > 0 ? quantity * asset.quote * fx : null;
}

export function InvestmentAllocation({ positions }: { positions: InvestPosition[] }) {
  const held = positions.filter((position) => position.quantity > 0);
  const values = assetKinds.slice(0, 3).map((kind) => ({ ...kind,
    value: held.filter((position) => position.asset.kind === kind.kind).reduce((sum, item) => sum + (marketValueTwd(item) ?? 0), 0),
  }));
  const total = values.reduce((sum, item) => sum + item.value, 0);
  const missing = held.filter((item) => item.asset.kind === 'pending' || marketValueTwd(item) == null).length;
  let angle = 0;
  const colors = values.filter(({ value }) => value > 0).map(({ color, value }) => {
    const start = angle;
    angle += value / total * 100;
    return `${color} ${start}% ${angle}%`;
  });
  const pie = colors.length === 1 ? values.find(({ value }) => value > 0)?.color
    : colors.length ? `conic-gradient(${colors.join(', ')})` : undefined;
  return <section className="card">
    <h2>持有成分</h2>
    <div className="invest-allocation">
      {pie && <div className="invest-allocation-pie" style={{ background: pie }} aria-hidden="true" />}
      <div><p>目前台幣市值合計 <strong>{fmtMoney(total)}</strong></p>
        {missing > 0 && <p className="hint">{missing} 檔待估值。金額和佔比以已有估值的標的計算。</p>}
        {!total && <p className="hint">目前沒有可顯示的市值佔比。</p>}
        <ul className="app-row-list invest-allocation-legend">{values.map(({ kind, label, value, color }) => <li key={kind}>
          <span><i style={{ '--legend-color': color } as CSSProperties} />{label}</span>
          <strong>{fmtMoney(value)}</strong><span>{total ? `${format(Math.round(value / total * 1000) / 10)}%` : '—'}</span>
        </li>)}</ul>
      </div>
    </div>
  </section>;
}

export function AssetDirectory({ assets, positions, onOpen, onNew }: {
  assets: InvestAsset[]; positions: Map<string, InvestPosition>; onOpen: (asset: InvestAsset) => void; onNew: () => void;
}) {
  return <section className="card">
    <h2>標的與保單</h2>
    {assetKinds.map(({ kind, label }) => {
      const group = assets.filter((asset) => asset.kind === kind);
      return group.length > 0 && <section className="invest-trade-group" key={kind}>
        <h3>{kind === 'policy' ? '保險' : label}</h3>
        <ul className="app-row-list">{group.map((asset) => <li key={asset.id}>
          <button type="button" className="app-row" onClick={() => onOpen(asset)}>
            <span className="app-row-main"><strong>{asset.symbol} {asset.name}</strong>
              <small>{[asset.currency, asset.account].filter(Boolean).join(' · ')}</small></span>
            <span className="app-row-value">{format(positions.get(asset.id)?.quantity ?? 0)} {unit(asset)}</span><Icon name="right" />
          </button>
        </li>)}</ul>
      </section>;
    })}
    <div className="invest-actions"><button className="primary" type="button" onClick={onNew}><Icon name="plus" /> 新增標的</button></div>
  </section>;
}

export function AssetDetail({ asset, position, day, snap, shortages, onOpen, onBack, onEdit }: {
  asset: InvestAsset; position?: InvestPosition; day: string; snap: InvestSnapshot; shortages: Set<string>;
  onOpen: (event: InvestEvent) => void; onBack: () => void; onEdit: () => void;
}) {
  const [month, setMonth] = useState(day.slice(0, 7));
  const dates = changes(snap.events.filter((event) => !event.removePending &&
    (event.asset === asset.id || event.secondAsset === asset.id)), snap.assets)
    .filter((row) => row.asset?.id === asset.id && row.date.startsWith(month));
  const grouped = [...new Set(dates.map(({ date }) => date))].sort((a, b) => b.localeCompare(a));
  const changeMonth = (offset: number) => {
    const [year, current] = month.split('-').map(Number);
    const next = new Date(year, current - 1 + offset, 1);
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  };
  const value = position ? marketValueTwd(position) : null;
  return <>
    <section className="card">
      <button type="button" className="link more-back" onClick={onBack}><Icon name="left" size={18} /> 返回標的與保單</button>
      <h2>{asset.symbol} {asset.name}</h2>
      <p className="hint">{[assetKinds.find(({ kind }) => kind === asset.kind)?.label, asset.currency, asset.account].filter(Boolean).join(' · ')}</p>
      <p>目前持有 <strong>{format(position?.quantity ?? 0)} {unit(asset)}</strong>{value != null && ` · 市值 ${fmtMoney(value)}`}</p>
      {position && position.quantity > 0 && value == null && <p className="hint">待估值</p>}
      <button type="button" onClick={onEdit}><Icon name="pencil" /> 修改標的</button>
    </section>
    <section className="card">
      <div className="invest-month">
        <button type="button" className="icon-btn" onClick={() => changeMonth(-1)} aria-label="上個月"><Icon name="left" /></button>
        <h2>{Number(month.slice(0, 4))} 年 {Number(month.slice(5))} 月</h2>
        <button type="button" className="icon-btn" onClick={() => changeMonth(1)} aria-label="下個月"><Icon name="right" /></button>
      </div>
      {grouped.length ? grouped.map((date) => <section className="invest-trade-group" key={date}>
        <h3>{date}</h3><TradeRows rows={dates.filter((row) => row.date === date)} snap={snap} shortages={shortages} onOpen={onOpen} />
      </section>) : <p className="hint">這個月沒有交易紀錄</p>}
    </section>
  </>;
}
