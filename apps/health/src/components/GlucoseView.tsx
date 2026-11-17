import { useState } from 'react';
import type { BloodGlucose, GlucoseTiming, HealthSnapshot } from '@life/db';
import { GLUCOSE_TIMINGS, guessTiming, judgeGlucose } from '@life/db';
import type { HealthApi } from '../useHealth';
import type { Nav, VitalForm } from '../App';
import { fmtDateTime, parseNum } from '../format';
import { TrendChart } from './TrendChart';
import { Badge, Choice, NumField, RangeSeg, sinceOf, useTimeInput, VitalFormShell } from './vital';

export function GlucoseView({ api, snap, nav, form }: { api: HealthApi; snap: HealthSnapshot; nav: Nav; form: VitalForm | null }) {
  const used = GLUCOSE_TIMINGS.filter((t) => snap.glucose.some((x) => x.timing === t));
  // 預設看最常量的時機（不同時機的標準不同，混在一起的趨勢圖看不出東西）
  const [timing, setTiming] = useState<GlucoseTiming | '全部'>(() => {
    const count = (t: GlucoseTiming) => snap.glucose.filter((x) => x.timing === t).length;
    return [...used].sort((a, b) => count(b) - count(a))[0] ?? '全部';
  });
  if (form) return <GlucoseForm api={api} nav={nav} rec={form.rec as BloodGlucose | null} />;
  const list = timing === '全部' ? snap.glucose : snap.glucose.filter((x) => x.timing === timing);
  return (
    <div className="vital">
      <button className="primary big full" onClick={() => nav.vital('glucose')}>
        🍬 記一筆血糖
      </button>
      {snap.glucose.length === 0 ? (
        <p className="muted center-text">還沒有血糖紀錄</p>
      ) : (
        <>
          {used.length > 1 && (
            <div className="chips">
              {(['全部', ...used] as const).map((t) => (
                <button key={t} className={timing === t ? 'active' : ''} onClick={() => setTiming(t)}>
                  {t}
                </button>
              ))}
            </div>
          )}
          <GlucoseTrend list={list} mixed={timing === '全部' && used.length > 1} />
          <GlucoseHistory list={list} nav={nav} />
        </>
      )}
    </div>
  );
}

function GlucoseTrend({ list, mixed }: { list: BloodGlucose[]; mixed: boolean }) {
  const [range, setRange] = useState(90);
  const pts = list.filter((x) => x.time >= sinceOf(range)).map((x) => ({ time: x.time, value: x.mgdl }));
  return (
    <section className="card">
      <div className="chart-head">
        <h2>趨勢</h2>
        <RangeSeg value={range} onChange={setRange} />
      </div>
      {mixed ? (
        <p className="muted small">不同測量時機的標準不一樣，點上面的時機分開看趨勢。</p>
      ) : (
        <TrendChart points={pts} unit="mg/dL" format={(v) => String(Math.round(v))} />
      )}
    </section>
  );
}

function GlucoseHistory({ list, nav }: { list: BloodGlucose[]; nav: Nav }) {
  const [limit, setLimit] = useState(30);
  const rows = [...list].reverse();
  return (
    <section className="card">
      <h2>紀錄</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>時間</th>
              <th>時機</th>
              <th>
                血糖 <small>mg/dL</small>
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((x) => (
              <tr key={x.id} onClick={() => nav.vital('glucose', { rec: x })} title="點一下修改">
                <td className="nowrap">
                  {fmtDateTime(x.time)}
                  {x.note && ' 📝'}
                </td>
                <td className="num">{x.timing}</td>
                <td className="num">{x.mgdl}</td>
                <td className="num">
                  <Badge judge={judgeGlucose(x.timing, x.mgdl)} />
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

const STANDARD: Record<GlucoseTiming, string> = {
  空腹: '70–99 正常、100–125 偏高、126 以上高',
  飯前: '70–99 正常、100–125 偏高、126 以上高',
  飯後2小時: '低於 140 正常、140–199 偏高、200 以上高',
  睡前: '200 以上高',
  隨機: '200 以上高',
};

function GlucoseForm({ api, nav, rec }: { api: HealthApi; nav: Nav; rec: BloodGlucose | null }) {
  const [time, setTimeRaw] = useTimeInput(rec?.time);
  const [note, setNote] = useState(rec?.note ?? '');
  const [mgdl, setMgdl] = useState(rec ? String(rec.mgdl) : '');
  const [timing, setTiming] = useState<GlucoseTiming>(rec?.timing ?? guessTiming(Date.now()));
  /** 使用者自己選過時機後，改時間就不再自動猜 */
  const [picked, setPicked] = useState(!!rec);
  const setTime = (t: string) => {
    setTimeRaw(t);
    const ms = new Date(t).getTime();
    if (!picked && Number.isFinite(ms)) setTiming(guessTiming(ms));
  };
  const v = parseNum(mgdl);
  const judge = v != null && v > 0 ? judgeGlucose(timing, v) : null;

  return (
    <div className="body-form">
      <VitalFormShell
        title={rec ? '修改血糖' : '記一筆血糖'}
        api={api}
        editing={!!rec}
        time={time}
        setTime={setTime}
        note={note}
        setNote={setNote}
        onClose={nav.closeForm}
        onSave={async (ms, n) => {
          const input = { timing, mgdl: parseNum(mgdl) ?? NaN };
          const ok = await api.run((st) => (rec ? st.updateGlucose(rec, input, ms, n) : st.addGlucose(input, ms, n)).then(() => true));
          if (ok) api.showToast({ kind: 'info', text: rec ? '已修改' : `已記錄血糖 ${input.mgdl}（${timing}）` });
          return !!ok;
        }}
        onDelete={async () => !!(await api.run((st) => st.deleteVital('healthBloodGlucose', rec!).then(() => true)))}
      >
        <div className="field">
          測量時機
          <Choice
            options={GLUCOSE_TIMINGS}
            value={timing}
            onChange={(t) => {
              setTiming(t);
              setPicked(true);
            }}
          />
          {!picked && <span className="hint">依時間自動選的，不對可以改</span>}
        </div>
        <NumField label="血糖" unit="mg/dL" value={mgdl} onChange={setMgdl} autoFocus={!rec} hint={judge && <Badge judge={judge} />} />
      </VitalFormShell>
      <p className="muted small">
        {timing}的標準：{STANDARD[timing]}；任何時機低於 70 偏低、低於 54 低血糖。
      </p>
    </div>
  );
}
