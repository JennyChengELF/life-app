import type { HealthSnapshot } from '@life/db';
import { compute722, judgeBp, judgeGlucose, judgeTemp, mismatchFields, recentBpAverage } from '@life/db';
import type { HealthApi } from '../useHealth';
import type { Nav } from '../App';
import { fmtDateTime } from '../format';
import { Badge } from './vital';

/** 總覽：每種量測的最新一筆、提醒 */
export function OverviewView({ api, snap, nav }: { api: HealthApi; snap: HealthSnapshot; nav: Nav }) {
  const body = snap.body[snap.body.length - 1];
  const prevBody = snap.body[snap.body.length - 2];
  const bp = snap.bp[snap.bp.length - 1];
  const glu = snap.glucose[snap.glucose.length - 1];
  const temp = snap.temps[snap.temps.length - 1];
  const mismatches = snap.body.filter((m) => mismatchFields(m, snap).length > 0);
  const r722 = compute722(snap.bp, snap.settings.bpPeriods);
  const recent = recentBpAverage(snap.bp, 7);
  const diff = body && prevBody ? Number((body.kg - prevBody.kg).toFixed(1)) : null;

  return (
    <div className="overview">
      <div className="messages">
        {snap.issues.length > 0 && (
          <button className="msg warn" onClick={() => nav.go('issues')}>
            ⚠️ 健康試算表有 {snap.issues.length} 筆資料需要補齊 ›
          </button>
        )}
        {mismatches.length > 0 && (
          <button className="msg warn" onClick={() => nav.edit(mismatches[mismatches.length - 1])}>
            ⚠️ 有 {mismatches.length} 筆身體量測的數值對不起來（BMI 或 % 和 kg） ›
          </button>
        )}
      </div>

      <div className="quick">
        <button onClick={nav.newBody}>
          <span className="q-icon">⚖️</span>記身體
        </button>
        <button onClick={() => nav.vital('bp')}>
          <span className="q-icon">🩸</span>記血壓
        </button>
        <button onClick={() => nav.vital('glucose')}>
          <span className="q-icon">🍬</span>記血糖
        </button>
        <button onClick={() => nav.vital('temp', { rec: null, tempKind: temp?.kind ?? '一般' })}>
          <span className="q-icon">🌡️</span>記體溫
        </button>
      </div>

      <section className="card sum-card" onClick={() => nav.go('body')}>
        <div className="sum-head">
          <h2>⚖️ 體重</h2>
          {body && <span className="muted small">{fmtDateTime(body.time)}</span>}
        </div>
        {body ? (
          <div className="big-num">
            {body.kg.toFixed(1)} <small>kg</small>
            {diff != null && <small> {diff === 0 ? '持平' : `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff).toFixed(1)}`}</small>}
          </div>
        ) : (
          <p className="muted">還沒有紀錄</p>
        )}
      </section>

      <section className="card sum-card" onClick={() => nav.go('bp')}>
        <div className="sum-head">
          <h2>🩸 血壓</h2>
          {bp && <span className="muted small">{fmtDateTime(bp.time)}</span>}
        </div>
        {bp ? (
          <>
            <div className="big-num">
              {bp.systolic}/{bp.diastolic} <small>mmHg{bp.pulse != null && ` · 脈搏 ${bp.pulse}`}</small> <Badge judge={judgeBp(bp.systolic, bp.diastolic)} />
            </div>
            {r722 ? (
              <p className="small">
                722 平均 {r722.all.sys}/{r722.all.dia} <Badge judge={r722.judge} />
              </p>
            ) : (
              recent && (
                <p className="small muted">
                  最近 7 天平均 {recent.sys}/{recent.dia}（{recent.n} 筆）
                </p>
              )
            )}
          </>
        ) : (
          <p className="muted">還沒有紀錄</p>
        )}
      </section>

      <section className="card sum-card" onClick={() => nav.go('glucose')}>
        <div className="sum-head">
          <h2>🍬 血糖</h2>
          {glu && <span className="muted small">{fmtDateTime(glu.time)}</span>}
        </div>
        {glu ? (
          <div className="big-num">
            {glu.mgdl} <small>mg/dL · {glu.timing}</small> <Badge judge={judgeGlucose(glu.timing, glu.mgdl)} />
          </div>
        ) : (
          <p className="muted">還沒有紀錄</p>
        )}
      </section>

      {temp && (
        <section className="card sum-card" onClick={() => nav.go('temp')}>
          <div className="sum-head">
            <h2>🌡️ 體溫</h2>
            <span className="muted small">{fmtDateTime(temp.time)}</span>
          </div>
          <div className="big-num">
            {temp.celsius.toFixed(temp.kind === '基礎' ? 2 : 1)} <small>°C · {temp.kind === '基礎' ? '基礎體溫' : (temp.site ?? '體溫')}</small> <Badge judge={judgeTemp(temp.kind, temp.celsius)} />
          </div>
        </section>
      )}
      {api.busy && <p className="muted small center-text">更新中⋯⋯</p>}
      <p className="muted small center-text">數值僅供記錄參考，不能取代醫療建議。</p>
    </div>
  );
}
