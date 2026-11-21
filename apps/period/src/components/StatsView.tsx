import { useState } from 'react';
import type { PeriodSnapshot } from '@life/db';
import { cycleDifferenceToNext, dateDiff, durationDifference, periodLength, periodStats, predictPeriod, todayKey } from '@life/db';
import type { PeriodApi } from '../usePeriod';

export function StatsView({ api, snap, openDate }: { api: PeriodApi; snap: PeriodSnapshot; openDate: (d: string) => void }) {
  const stats = periodStats(snap.cycles);
  const prediction = predictPeriod(snap);
  const [showAll, setShowAll] = useState(false);
  const ordered = [...snap.cycles].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const latestCycle = ordered[0] ?? null;
  const visible = showAll ? ordered : ordered.slice(0, 5);
  return <>
    <section className="card"><h2>週期統計</h2><div className="stat-grid">
      <Stat label="平均週期" value={stats.averageCycle} /><Stat label="平均經期" value={stats.averagePeriod} /><Stat label="最短週期" value={stats.shortestCycle} /><Stat label="最長週期" value={stats.longestCycle} />
    </div></section>
    <section className="card"><h2>下一次預測</h2>{prediction ? <><p className="prediction-date">{prediction.nextStart} ～ {prediction.nextEnd}</p><p className="muted small">週期：{prediction.cycleDays} 天（{prediction.cycleBasis === 'history' ? '最近實際紀錄' : '你的設定'}）・經期：{prediction.periodDays} 天（{prediction.periodBasis === 'history' ? '最近實際紀錄' : '你的設定'}）</p>{prediction.ovulationDate && <p className="muted small">估計排卵日 {prediction.ovulationDate}・估計易孕期 {prediction.fertileFrom} ～ {prediction.fertileTo}</p>}<p className="muted small disclaimer">僅依週期推算，不能確認實際排卵，也不適合作為避孕依據。</p></> : <p className="muted">請先到設定填預設週期與經期天數，或補足實際紀錄。</p>}</section>
    <section className="card"><h2>歷史經期資訊</h2>{snap.cycles.length ? <><ul className="cycle-list">{visible.map((c) => {
      const next = snap.cycles.filter((x) => x.startDate > c.startDate).sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null;
      const cycleDays = next ? dateDiff(c.startDate, next.startDate) : null;
      const periodDays = periodLength(c);
      const isCurrent = !c.endDate && c.id === latestCycle?.id && c.startDate <= todayKey();
      const ongoingDays = isCurrent ? dateDiff(c.startDate, todayKey()) + 1 : null;
      const endLabel = c.endDate ? formatDate(c.endDate) : isCurrent ? '進行中' : '待確認結束日';
      // （2026-11-22 使用者決定：週期提醒要放在這筆開始日到下一筆開始日的週期天數下面。）
      const cd = cycleDifferenceToNext(snap.cycles, c);
      const dd = durationDifference(snap.cycles, c);
      return <li className="history-row" key={c.id}><button className="cycle-row" onClick={() => openDate(c.startDate)}><span><strong>{formatDate(c.startDate)}</strong> ～ {endLabel}</span><span className="history-values"><span className="history-metric"><span>週期天數：{cycleDays != null ? `${cycleDays} 天` : '尚未完成'}</span>{cd && <small>比先前平均週期 {cd.average} 天{cd.direction === 'longer' ? '長' : '短'} {cd.difference} 天</small>}</span><span className="history-metric"><span>經期天數：{periodDays != null ? `${periodDays} 天` : ongoingDays != null ? `目前第 ${ongoingDays} 天` : '待確認'}</span>{dd && <small>比先前平均經期 {dd.average} 天{dd.direction === 'longer' ? '長' : '短'} {dd.difference} 天</small>}</span></span></button><label className="check compact history-exclude"><input type="checkbox" checked={c.excludeFromPrediction} onChange={(e) => void api.run((p) => p.updateCycle(c, { excludeFromPrediction: e.target.checked }))} />不納入預測</label></li>;
    })}</ul>{ordered.length > 5 && <button className="history-more" onClick={() => setShowAll((x) => !x)}>{showAll ? '收合，只顯示最新 5 筆' : `顯示更多（還有 ${ordered.length - 5} 筆）`}</button>}</> : <p className="muted">還沒有經期紀錄</p>}</section>
  </>;
}

function Stat({ label, value }: { label: string; value: number | null }) { return <div className="stat-tile"><div className="stat-label">{label}</div><div className="stat-value">{value ?? '—'}{value != null && <small> 天</small>}</div></div>; }

const formatDate = (date: string) => date.replaceAll('-', '/');
