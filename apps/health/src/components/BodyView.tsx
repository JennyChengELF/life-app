import { useState } from 'react';
import type { BodyFieldKey, BodyMeasurement, BodyValueCol, BodyValues, HealthSnapshot } from '@life/db';
import { BODY_FIELDS, bmiInfo, bodyField, computeBmi, HEIGHT_CODE, heightAt, PCT_KG_PAIRS, PCT_KG_TOLERANCE, pctKgMismatches, toInputDateTime } from '@life/db';
import type { HealthApi } from '../useHealth';
import type { Nav } from '../App';
import { fieldLabel, parseNum } from '../format';

/** 新增 / 修改一筆身體量測 */
export function BodyView({ api, snap, editing, nav }: { api: HealthApi; snap: HealthSnapshot; editing: BodyMeasurement | null; nav: Nav }) {
  const shown = snap.settings.bodyFields;
  const hidden = BODY_FIELDS.map((f) => f.key).filter((k) => !shown.includes(k));

  const [time, setTime] = useState(toInputDateTime(editing?.time ?? Date.now()));
  const [vals, setVals] = useState<Partial<Record<BodyValueCol, string>>>(() => {
    const init: Partial<Record<BodyValueCol, string>> = {};
    if (editing) for (const f of BODY_FIELDS) init[f.col] = editing[f.col] == null ? '' : String(editing[f.col]);
    return init;
  });
  const [note, setNote] = useState(editing?.note ?? '');
  // 隱藏的項目有值時自動展開
  const [more, setMore] = useState(() => !!editing && hidden.some((k) => editing[bodyField(k).col] != null));

  const timeMs = new Date(time).getTime();
  const kg = parseNum(vals.kg ?? '');
  const height = Number.isFinite(timeMs) ? heightAt(snap, timeMs) : null;
  const autoBmi = height && kg && kg > 0 ? computeBmi(kg, height) : null;

  const save = async () => {
    if (!Number.isFinite(timeMs)) return api.showToast({ kind: 'error', text: '請輸入時間' });
    if (timeMs > Date.now() + 5 * 60000) return api.showToast({ kind: 'error', text: '時間不能是未來' });
    const values: BodyValues = {};
    for (const f of BODY_FIELDS) {
      const n = parseNum(vals[f.col] ?? '');
      if (Number.isNaN(n)) return api.showToast({ kind: 'error', text: `${fieldLabel(f.key)}不是數字` });
      values[f.col] = n;
    }
    if (values.kg == null) return api.showToast({ kind: 'error', text: '請輸入體重' });
    const ok = editing
      ? await api.run((s) => s.updateBody(editing, { ...values, time: timeMs, note }).then(() => true))
      : await api.run((s) => s.addBody({ ...values, kg: values.kg! }, timeMs, note).then(() => true));
    if (ok) {
      api.showToast({ kind: 'info', text: editing ? '已修改' : `已記錄體重 ${values.kg} kg` });
      nav.closeBody();
    }
  };

  const remove = async () => {
    if (!editing || !confirm('確定要刪除這筆紀錄嗎？')) return;
    const ok = await api.run((s) => s.deleteBody(editing).then(() => true));
    if (ok) nav.closeBody();
  };

  const input = (k: BodyFieldKey) => {
    const f = bodyField(k);
    const isBmi = k === 'bmi';
    /** kg 欄位：顯示體重 × % 算出來的值 */
    const pair = PCT_KG_PAIRS.find((p) => p.kg === k);
    return (
      <label key={k} className="field">
        {isBmi ? 'BMI（體重計顯示的）' : fieldLabel(k)}
        {k === 'kg' && <span className="req"> *</span>}
        <div className="input-unit">
          <input
            type="number"
            inputMode="decimal"
            step={f.decimals ? 1 / 10 ** f.decimals : 1}
            value={vals[f.col] ?? ''}
            onChange={(e) => setVals((v) => ({ ...v, [f.col]: e.target.value }))}
            autoFocus={k === 'kg' && !editing}
          />
          {f.unit && !isBmi && <span className="unit">{f.unit}</span>}
        </div>
        {pair && <PctKgHint kg={kg} pct={parseNum(vals[pair.pct] ?? '')} val={parseNum(vals[pair.kg] ?? '')} />}
        {isBmi && (
          <span className="hint">
            {autoBmi != null ? `自動算：${autoBmi.toFixed(1)}（身高 ${height} cm）` : height ? `填體重後自動算（身高 ${height} cm）` : '填了身高就會自動算'}
          </span>
        )}
      </label>
    );
  };

  return (
    <div className="body-form">
      {editing && (
        <>
          <BmiWarning api={api} snap={snap} m={editing} nav={nav} onUseAuto={(v) => setVals((s) => ({ ...s, bmiScale: String(v) }))} />
          <PctKgWarnings api={api} snap={snap} m={editing} onSet={(col, v) => setVals((s) => ({ ...s, [col]: String(v) }))} />
        </>
      )}
      <section className="card">
        <h2>{editing ? '修改身體量測' : '記一筆身體量測'}</h2>
        <label className="field">
          量的時間
          <input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <div className="form-grid">{shown.map(input)}</div>
        {hidden.length > 0 && (
          <>
            <button className="link" onClick={() => setMore(!more)}>
              {more ? '▾ 收起' : `▸ 更多（${hidden.map(fieldLabel).join('、')}）`}
            </button>
            {more && <div className="form-grid">{hidden.map(input)}</div>}
          </>
        )}
        <label className="field">
          備註
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：吃完早餐後量" />
        </label>
        <div className="editor-actions">
          <button className="primary big" onClick={save} disabled={api.busy}>
            儲存
          </button>
          <button onClick={() => nav.closeBody()}>取消</button>
          {editing && (
            <button className="danger" onClick={remove}>
              刪除
            </button>
          )}
        </div>
        <p className="muted small">顯示哪些項目、順序可以在「設定」調整。</p>
      </section>
    </div>
  );
}

/** 體重計 BMI 和用身高算的不同：讓使用者決定改身高 / 改填的 BMI / 不用改 */
function BmiWarning(props: { api: HealthApi; snap: HealthSnapshot; m: BodyMeasurement; nav: Nav; onUseAuto: (v: number) => void }) {
  const { api, snap, nav } = props;
  // 用最新讀到的資料（按「不用改」後要消失）
  const m = snap.body.find((x) => x.id === props.m.id) ?? props.m;
  const b = bmiInfo(m, snap);
  if (!b.mismatch || b.computed == null) return null;
  const heightName = snap.items.find((i) => i.code === HEIGHT_CODE)?.name ?? '身高';
  return (
    <section className="card warn-card">
      <h2>⚠️ BMI 不一樣</h2>
      <p>
        體重計顯示 <b>{b.scale?.toFixed(1)}</b>，用身高 {b.height} cm 算是 <b>{b.computed.toFixed(1)}</b>。
      </p>
      <p className="muted small">可能是身高記錯，或是輸入體重計的數字時打錯。</p>
      <div className="row wrap">
        <button onClick={() => nav.occ(heightName)}>改身高</button>
        <button
          onClick={async () => {
            props.onUseAuto(b.computed!);
            await api.run((s) => s.updateBody(m, { bmiScale: b.computed }));
          }}
        >
          把填的 BMI 改成 {b.computed.toFixed(1)}
        </button>
        <button onClick={() => api.run((s) => s.updateBody(m, { bmiOk: true }))}>不用改</button>
      </div>
    </section>
  );
}

/** 輸入時的提示：體重 × % 算出來是多少 kg */
function PctKgHint({ kg, pct, val }: { kg: number | null; pct: number | null; val: number | null }) {
  if (kg == null || pct == null || !(kg > 0) || Number.isNaN(kg) || Number.isNaN(pct)) return null;
  const calc = Math.round(kg * pct * 10) / 1000;
  const off = val != null && !Number.isNaN(val) && Math.abs(calc - val) >= PCT_KG_TOLERANCE - 1e-9;
  return <span className={off ? 'hint off' : 'hint'}>{off ? '⚠️ ' : ''}體重 × % = {calc.toFixed(1)} kg</span>;
}

/** 體重 × % 和填的 kg 對不起來：讓使用者決定改 kg / 改 % / 不用改 */
function PctKgWarnings(props: { api: HealthApi; snap: HealthSnapshot; m: BodyMeasurement; onSet: (col: BodyValueCol, v: number) => void }) {
  const { api, snap } = props;
  const m = snap.body.find((x) => x.id === props.m.id) ?? props.m;
  return (
    <>
      {pctKgMismatches(m).map(({ pair, pct, kg, kgFromPct, pctFromKg }) => (
        <section key={pair.key} className="card warn-card">
          <h2>⚠️ {pair.label} % 和 kg 對不起來</h2>
          <p>
            體重 {m.kg.toFixed(1)} kg × {pct.toFixed(1)}% = <b>{kgFromPct.toFixed(1)} kg</b>，但填的是 <b>{kg.toFixed(1)} kg</b>。
          </p>
          <p className="muted small">可能是其中一個數字打錯（也可能是體重打錯，可以直接在下面改）。</p>
          <div className="row wrap">
            <button
              onClick={async () => {
                props.onSet(pair.kg, kgFromPct);
                await api.run((s) => s.updateBody(m, { [pair.kg]: kgFromPct }));
              }}
            >
              把 kg 改成 {kgFromPct.toFixed(1)}
            </button>
            <button
              onClick={async () => {
                props.onSet(pair.pct, pctFromKg);
                await api.run((s) => s.updateBody(m, { [pair.pct]: pctFromKg }));
              }}
            >
              把 % 改成 {pctFromKg.toFixed(1)}
            </button>
            <button onClick={() => api.run((s) => s.updateBody(m, { [pair.ok]: true }))}>不用改</button>
          </div>
        </section>
      ))}
    </>
  );
}
