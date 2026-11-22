import { useState } from 'react';
import type { HealthSnapshot, Temperature, TempKind, TempSite } from '@life/db';
import { judgeTemp, TEMP_KINDS, TEMP_SITES } from '@life/db';
import type { HealthApi } from '../useHealth';
import type { Nav, VitalForm } from '../App';
import { fmtDateTime, parseNum } from '../format';
import { TrendChart } from './TrendChart';
import { Badge, Choice, NumField, RangeSeg, sinceOf, useTimeInput, VitalFormShell } from './vital';

const decimals = (k: TempKind) => (k === '基礎' ? 2 : 1);

export function TempView({ api, snap, nav, form }: { api: HealthApi; snap: HealthSnapshot; nav: Nav; form: VitalForm | null }) {
  // 預設看最近量的那一種
  const [kind, setKind] = useState<TempKind>(snap.temps[snap.temps.length - 1]?.kind ?? '一般');
  const [siteFilter, setSiteFilter] = useState<TempSite | '全部'>(snap.settings.tempSite['一般'] ?? '全部');
  if (form) return <TempForm api={api} snap={snap} nav={nav} rec={form.rec as Temperature | null} initialKind={form.tempKind ?? kind} initialTime={form.initialTime} />;
  const allOfKind = snap.temps.filter((x) => x.kind === kind);
  const list = kind === '一般' && siteFilter !== '全部' ? allOfKind.filter((item) => item.site === siteFilter) : allOfKind;
  const latest = allOfKind[allOfKind.length - 1] ?? null;
  return (
    <div className="vital">
      <div className="chips">
        {TEMP_KINDS.map((k) => (
          <button key={k} className={kind === k ? 'active' : ''} onClick={() => { setKind(k); if (k === '一般') setSiteFilter(snap.settings.tempSite['一般'] ?? '全部'); }}>
            {k}體溫
          </button>
        ))}
      </div>
      {kind === '一般' && <div className="chips">{(['全部', ...TEMP_SITES] as const).map((site) => <button key={site} className={siteFilter === site ? 'active' : ''} onClick={() => setSiteFilter(site)}>{site === '全部' ? '全部部位' : site}</button>)}</div>}
      {latest && <section className="card"><h2>最近一次{kind}體溫</h2><div className="big-num">{latest.celsius.toFixed(decimals(kind))} <small>°C</small></div><p className="muted small">{latest.site ?? '未填部位'}・{fmtDateTime(latest.time)}</p></section>}
      {kind === '基礎' && <p className="muted small">基礎體溫：早上醒來、還沒起床活動前量。不標顏色，看趨勢用。</p>}
      {list.length === 0 ? (
        <p className="muted center-text">還沒有{kind}體溫紀錄</p>
      ) : (
        <>
          <TempTrend list={list} kind={kind} />
        </>
      )}
    </div>
  );
}

function TempTrend({ list, kind }: { list: Temperature[]; kind: TempKind }) {
  const [range, setRange] = useState(kind === '基礎' ? 90 : 30);
  const pts = list.filter((x) => x.time >= sinceOf(range)).map((x) => ({ time: x.time, value: x.celsius }));
  return (
    <section className="card">
      <div className="chart-head">
        <h2>趨勢</h2>
        <RangeSeg value={range} onChange={setRange} />
      </div>
      <TrendChart
        points={pts}
        unit="°C"
        format={(v) => v.toFixed(decimals(kind))}
        refs={
          kind === '一般'
            ? [
                { value: 37.5, label: '37.5 微燒' },
                { value: 38, label: '38 發燒' },
              ]
            : undefined
        }
      />
    </section>
  );
}

function TempForm(props: { api: HealthApi; snap: HealthSnapshot; nav: Nav; rec: Temperature | null; initialKind: TempKind; initialTime?: number }) {
  const { api, snap, nav, rec } = props;
  const [time, setTime] = useTimeInput(rec?.time ?? props.initialTime);
  const [note, setNote] = useState(rec?.note ?? '');
  const [kind, setKind] = useState<TempKind>(rec?.kind ?? props.initialKind);
  const [site, setSite] = useState<TempSite | null>(rec ? rec.site : snap.settings.tempSite[props.initialKind]);
  /** 使用者自己選過部位後，換種類就不再換成預設部位 */
  const [pickedSite, setPickedSite] = useState(!!rec);
  const [c, setC] = useState(rec ? rec.celsius.toFixed(decimals(rec.kind)) : '');
  const v = parseNum(c);
  const judge = v != null && v > 0 ? judgeTemp(kind, v) : null;

  return (
    <div className="body-form">
      <VitalFormShell
        title={rec ? '修改體溫' : '記一筆體溫'}
        api={api}
        editing={!!rec}
        time={time}
        setTime={setTime}
        note={note}
        setNote={setNote}
        onClose={nav.closeForm}
        onSave={async (ms, n) => {
          const input = { kind, site, celsius: parseNum(c) ?? NaN };
          const ok = await api.run((st) => (rec ? st.updateTemp(rec, input, ms, n) : st.addTemp(input, ms, n)).then(() => true));
          if (ok) api.showToast({ kind: 'info', text: rec ? '已修改' : `已記錄${kind}體溫 ${input.celsius} °C` });
          return !!ok;
        }}
        onDelete={async () => !!(await api.run((st) => st.deleteVital('healthTemperature', rec!).then(() => true)))}
      >
        <div className="field">
          種類
          <Choice
            options={TEMP_KINDS}
            value={kind}
            onChange={(k) => {
              setKind(k);
              if (!pickedSite) setSite(snap.settings.tempSite[k]);
            }}
          />
        </div>
        <div className="field">
          部位
          <Choice
            options={TEMP_SITES}
            value={site}
            onChange={(s) => {
              setSite(s);
              setPickedSite(true);
            }}
          />
        </div>
        <NumField label="體溫" unit="°C" step={kind === '基礎' ? 0.01 : 0.1} value={c} onChange={setC} autoFocus={!rec} hint={judge && <Badge judge={judge} />} />
      </VitalFormShell>
      <p className="muted small">
        {kind === '一般' ? '37.5 °C 以上微燒、38 °C 以上發燒。' : '基礎體溫記到小數第 2 位。'}預設部位可以在設定改。
      </p>
    </div>
  );
}
