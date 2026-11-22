import type { HealthIssue, HealthSnapshot } from '@life/db';
import { mismatchFields } from '@life/db';
import type { HealthApi } from '../useHealth';
import type { Nav } from '../App';

const show = (v: unknown) => (v === undefined || v === null || v === '' ? '（空白）' : String(v));
const TABLE_NAME: Record<string, string> = {
  healthBodyMeasurements: '身體量測',
  healthOccasionalMeasurements: '身體尺寸',
  healthBloodPressure: '血壓',
  healthBloodGlucose: '血糖',
  healthTemperature: '體溫',
  healthLabReports: '健檢報告',
  healthLabResults: '檢驗結果',
};

export function IssuesView({ api, snap, nav, onDone }: { api: HealthApi; snap: HealthSnapshot; nav: Nav; onDone: () => void }) {
  const url = api.fileUrl('health');
  const mismatches = snap.body.filter((measurement) => mismatchFields(measurement, snap).length > 0);
  if (snap.issues.length === 0 && mismatches.length === 0) {
    return (
      <div className="center">
        <p>✅ 沒有需要補齊的資料</p>
        <button className="primary" onClick={onDone}>
          返回更多
        </button>
      </div>
    );
  }
  return (
    <div className="issues">
      <p className="muted">
        下面是在試算表直接輸入、但格式看不懂或缺內容的資料。請到試算表修改，再按右上角 ⟳ 重新整理；或按「不要這筆」標記刪除。
      </p>
      {url && (
        <a className="btn" href={url} target="_blank" rel="noreferrer">
          開啟健康試算表 ↗
        </a>
      )}
      {snap.issues.map((i) => (
        <IssueCard key={`${i.table}-${i.rowNumber}`} issue={i} api={api} />
      ))}
      {mismatches.map((measurement) => <section className="card" key={measurement.id}><h2>身體量測數值需要確認</h2><p className="muted small">{measurement.date.replace(/-/g, '/')}・{measurement.timing}</p><ul className="problems">{mismatchFields(measurement, snap).map((field) => <li key={field}>{field} 的百分比、公斤數或 BMI 對不起來</li>)}</ul><button type="button" className="primary" onClick={() => nav.edit(measurement, 'issues')}>查看並處理</button></section>)}
    </div>
  );
}

function IssueCard({ issue, api }: { issue: HealthIssue; api: HealthApi }) {
  const filled = Object.entries(issue.raw).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return (
    <section className="card">
      <h2>
        {TABLE_NAME[issue.table] ?? issue.table}（{issue.table}）第 {issue.rowNumber} 列
      </h2>
      <p className="small">原本內容：{filled.length ? filled.map(([k, v]) => `${k} = ${show(v)}`).join('、') : '（空白）'}</p>
      <ul className="problems">
        {issue.problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <button className="danger" onClick={() => confirm('確定不要這一列嗎？') && api.run((s) => s.discardIssue(issue))}>
        不要這筆
      </button>
    </section>
  );
}
