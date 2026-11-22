import type { PeriodCycle, PeriodSnapshot } from '@life/db';
import { cycleDifferenceToNext, dateDiff, durationDifference, periodLength, periodStats, predictPeriod, todayKey } from '@life/db';
import type { PeriodApi } from '../usePeriod';

export function StatsView({ api, snap, openDate }: { api: PeriodApi; snap: PeriodSnapshot; openDate: (date: string) => void }) {
  const stats = periodStats(snap.cycles);
  const prediction = predictPeriod(snap);
  const ordered = [...snap.cycles].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const latest = ordered[0] ?? null;
  const years = [...new Set(ordered.map((cycle) => cycle.startDate.slice(0, 4)))];
  const currentYear = todayKey().slice(0, 4);
  return <>
    <section className="card"><h2>週期統計</h2><div className="stat-grid"><Stat label="平均週期" value={stats.averageCycle} /><Stat label="平均經期" value={stats.averagePeriod} /><Stat label="最短週期" value={stats.shortestCycle} /><Stat label="最長週期" value={stats.longestCycle} /></div></section>
    <section className="card"><h2>下一次預測</h2>{prediction ? <><p className="prediction-date">{formatDate(prediction.nextStart)} ～ {formatDate(prediction.nextEnd)}</p><p className="muted small">週期：{prediction.cycleDays} 天（{prediction.cycleBasis === 'history' ? '最近實際紀錄' : '你的設定'}）・經期：{prediction.periodDays} 天（{prediction.periodBasis === 'history' ? '最近實際紀錄' : '你的設定'}）</p>{prediction.ovulationDate && <p className="muted small">估計排卵日 {formatDate(prediction.ovulationDate)}・估計易孕期 {formatDate(prediction.fertileFrom!)} ～ {formatDate(prediction.fertileTo!)}</p>}<p className="muted small disclaimer">僅依週期推算，不能確認實際排卵，也不適合作為避孕依據。</p></> : <p className="muted">請先到更多設定預設週期與經期天數，或補足實際紀錄。</p>}</section>
    <section className="card"><h2>歷史經期</h2>{years.length ? years.map((year) => {
      const rows = ordered.filter((cycle) => cycle.startDate.startsWith(year));
      return <details className="history-year" key={year} open={year === currentYear}><summary><strong>{year} 年</strong><span>{rows.length} 次</span></summary><ul className="cycle-list">{rows.map((cycle) => <HistoryRow key={cycle.id} api={api} cycle={cycle} snap={snap} latest={latest} openDate={openDate} />)}</ul></details>;
    }) : <p className="muted">還沒有經期紀錄</p>}</section>
  </>;
}

function HistoryRow({ api, cycle, snap, latest, openDate }: { api: PeriodApi; cycle: PeriodCycle; snap: PeriodSnapshot; latest: PeriodCycle | null; openDate: (date: string) => void }) {
  const next = snap.cycles.filter((value) => value.startDate > cycle.startDate).sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null;
  const cycleDays = next ? dateDiff(cycle.startDate, next.startDate) : null;
  const days = periodLength(cycle);
  const current = !cycle.endDate && cycle.id === latest?.id && cycle.startDate <= todayKey();
  const ongoingDays = current ? dateDiff(cycle.startDate, todayKey()) + 1 : null;
  const end = cycle.endDate ? formatDate(cycle.endDate) : current ? '進行中' : '待確認結束日';
  const cycleDiff = cycleDifferenceToNext(snap.cycles, cycle);
  const durationDiff = durationDifference(snap.cycles, cycle);
  return <li className="history-row"><button className="cycle-row" onClick={() => openDate(cycle.startDate)}><span><strong>{formatDate(cycle.startDate)}</strong> ～ {end}</span><span className="history-values"><span className="history-metric"><span>週期天數：{cycleDays != null ? `${cycleDays} 天` : '尚未完成'}</span>{cycleDiff && <small>比先前平均 {cycleDiff.direction === 'longer' ? '長' : '短'} {cycleDiff.difference} 天</small>}</span><span className="history-metric"><span>經期天數：{days != null ? `${days} 天` : ongoingDays != null ? `目前第 ${ongoingDays} 天` : '待確認'}</span>{durationDiff && <small>比先前平均 {durationDiff.direction === 'longer' ? '長' : '短'} {durationDiff.difference} 天</small>}</span></span></button><label className="check compact history-exclude"><input type="checkbox" checked={cycle.excludeFromPrediction} onChange={(event) => void api.run((store) => store.updateCycle(cycle, { excludeFromPrediction: event.target.checked }))} />不納入預測</label></li>;
}

function Stat({ label, value }: { label: string; value: number | null }) { return <div className="stat-tile"><div className="stat-label">{label}</div><div className="stat-value">{value ?? '—'}{value != null && <small> 天</small>}</div></div>; }
const formatDate = (date: string) => date.replaceAll('-', '/');
