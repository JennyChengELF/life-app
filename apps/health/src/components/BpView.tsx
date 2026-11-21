import { useState } from 'react';
import type { BloodPressure, HealthSnapshot } from '@life/db';
import { compute722, formatRange, judgeBp, recentBpAverage, toDateKey, toInputDateTime } from '@life/db';
import type { HealthApi } from '../useHealth';
import type { Nav, VitalForm } from '../App';
import { fmtDateTime, parseNum } from '../format';
import { TrendChart } from './TrendChart';
import { Badge, NumField, RangeSeg, sinceOf, useTimeInput, VitalFormShell } from './vital';

export function BpView({ api, snap, nav, form }: { api: HealthApi; snap: HealthSnapshot; nav: Nav; form: VitalForm | null }) {
  if (form) return <BpForm api={api} nav={nav} rec={form.rec as BloodPressure | null} initialTime={form.initialTime} />;
  return (
    <div className="vital">
      <button className="primary big full" onClick={() => nav.vital('bp')}>
        🩸 記一筆血壓
      </button>
      {snap.bp.length === 0 ? (
        <p className="muted center-text">還沒有血壓紀錄</p>
      ) : (
        <>
          <AverageCard snap={snap} />
          <BpTrend snap={snap} />
          <BpHistory snap={snap} nav={nav} />
        </>
      )}
    </div>
  );
}

const showBp = (sys: number, dia: number) => `${sys}/${dia}`;

/** 722 平均（量滿才有）或最近 7 天的一般平均 */
function AverageCard({ snap }: { snap: HealthSnapshot }) {
  const r722 = compute722(snap.bp, snap.settings.bpPeriods);
  const recent = recentBpAverage(snap.bp, 7);
  const p = snap.settings.bpPeriods;
  const fmtDay = (d: string) => d.slice(5).replace('-', '/');
  return (
    <section className="card">
      {r722 ? (
        <>
          <div className="sum-head">
            <h2>722 平均</h2>
            <span className="muted small">
              {fmtDay(r722.days[0])}–{fmtDay(r722.days[6])}
            </span>
          </div>
          <div className="big-num">
            {showBp(r722.all.sys, r722.all.dia)} <small>mmHg</small> <Badge judge={r722.judge} />
          </div>
          <p className="small muted">
            早上 {showBp(r722.morning.sys, r722.morning.dia)}、晚上 {showBp(r722.evening.sys, r722.evening.dia)}（共 {r722.all.n} 筆）
          </p>
        </>
      ) : (
        <>
          <h2>最近 7 天平均</h2>
          {recent ? (
            <div className="big-num">
              {showBp(recent.sys, recent.dia)} <small>mmHg · {recent.n} 筆</small> <Badge judge={judgeBp(recent.sys, recent.dia)} />
            </div>
          ) : (
            <p className="muted">最近 7 天沒有量</p>
          )}
        </>
      )}
      {!r722 && (
        <p className="muted small">
          量滿 722 就會顯示 722 平均：連續 7 天，早上（{formatRange(p.morning)}）和晚上（{formatRange(p.evening)}）各量一次，每次量 2 遍（10 分鐘內）。時段可以在設定改。
        </p>
      )}
    </section>
  );
}

function BpTrend({ snap }: { snap: HealthSnapshot }) {
  const [range, setRange] = useState(90);
  const [showPulse, setShowPulse] = useState(false);
  const list = snap.bp.filter((x) => x.time >= sinceOf(range));
  return (
    <section className="card">
      <div className="chart-head">
        <h2>趨勢</h2>
        <RangeSeg value={range} onChange={setRange} />
      </div>
      <div className="chips">
        <button className={!showPulse ? 'active' : ''} onClick={() => setShowPulse(false)}>
          血壓
        </button>
        <button className={showPulse ? 'active' : ''} onClick={() => setShowPulse(true)}>
          脈搏
        </button>
      </div>
      {showPulse ? (
        <TrendChart
          points={list.filter((x) => x.pulse != null).map((x) => ({ time: x.time, value: x.pulse! }))}
          unit="次/分"
          format={(v) => String(Math.round(v))}
        />
      ) : (
        <TrendChart
          series={[
            { label: '收縮壓', points: list.map((x) => ({ time: x.time, value: x.systolic })) },
            { label: '舒張壓', points: list.map((x) => ({ time: x.time, value: x.diastolic })) },
          ]}
          unit="mmHg"
          format={(v) => String(Math.round(v))}
          refs={[
            { value: 130, label: '130' },
            { value: 80, label: '80' },
          ]}
        />
      )}
    </section>
  );
}

function BpHistory({ snap, nav }: { snap: HealthSnapshot; nav: Nav }) {
  const [limit, setLimit] = useState(30);
  const rows = [...snap.bp].reverse();
  return (
    <section className="card">
      <h2>紀錄</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>時間</th>
              <th>
                血壓 <small>mmHg</small>
              </th>
              <th>脈搏</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((x) => (
              <tr key={x.id} onClick={() => nav.vital('bp', { rec: x })} title="點一下修改">
                <td className="nowrap">
                  {fmtDateTime(x.time)}
                  {x.note && ' 📝'}
                </td>
                <td className="num">{showBp(x.systolic, x.diastolic)}</td>
                <td className="num">{x.pulse ?? '—'}</td>
                <td className="num">
                  <Badge judge={judgeBp(x.systolic, x.diastolic)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <button className="link" onClick={() => setLimit(limit + 50)}>
          顯示更多（還有 {rows.length - limit} 筆）
        </button>
      )}
    </section>
  );
}

function BpForm({ api, nav, rec, initialTime }: { api: HealthApi; nav: Nav; rec: BloodPressure | null; initialTime?: number }) {
  const [time, setTime] = useTimeInput(rec?.time ?? initialTime);
  const [note, setNote] = useState(rec?.note ?? '');
  const [sys, setSys] = useState(rec ? String(rec.systolic) : '');
  const [dia, setDia] = useState(rec ? String(rec.diastolic) : '');
  const [pulse, setPulse] = useState(rec?.pulse != null ? String(rec.pulse) : '');
  const [count, setCount] = useState(0);
  const s = parseNum(sys);
  const d = parseNum(dia);
  const judge = s && d && s > d ? judgeBp(s, d) : null;

  return (
    <div className="body-form">
      <VitalFormShell
        title={rec ? '修改血壓' : count ? `記一筆血壓（第 ${count + 1} 遍）` : '記一筆血壓'}
        api={api}
        editing={!!rec}
        time={time}
        setTime={setTime}
        note={note}
        setNote={setNote}
        onClose={nav.closeForm}
        onSaveAgain={() => {
          setCount((c) => c + 1);
          setSys('');
          setDia('');
          setPulse('');
          setTime(toInputDateTime(Date.now()));
        }}
        onSave={async (ms, n) => {
          const v = { systolic: parseNum(sys) ?? NaN, diastolic: parseNum(dia) ?? NaN, pulse: parseNum(pulse) };
          if (Number.isNaN(v.pulse)) {
            api.showToast({ kind: 'error', text: '脈搏不是數字' });
            return false;
          }
          const ok = await api.run((st) => (rec ? st.updateBp(rec, v, ms, n) : st.addBp(v, ms, n)).then(() => true));
          if (ok) api.showToast({ kind: 'info', text: rec ? '已修改' : `已記錄血壓 ${v.systolic}/${v.diastolic}（${toDateKey(ms) === toDateKey(Date.now()) ? '今天' : toDateKey(ms)}）` });
          return !!ok;
        }}
        onDelete={async () => !!(await api.run((st) => st.deleteVital('healthBloodPressure', rec!).then(() => true)))}
      >
        <div className="form-grid">
          <NumField label="收縮壓（高）" unit="mmHg" value={sys} onChange={setSys} autoFocus={!rec} />
          <NumField label="舒張壓（低）" unit="mmHg" value={dia} onChange={setDia} />
          <NumField label="脈搏" unit="次/分" value={pulse} onChange={setPulse} />
        </div>
        {judge && (
          <p>
            <Badge judge={judge} />
          </p>
        )}
      </VitalFormShell>
      <p className="muted small">標準：低於 130/80 正常；130–139 或 80–89 偏高；140/90 以上高；低於 90/60 偏低（台灣 2022 居家血壓）。</p>
    </div>
  );
}
