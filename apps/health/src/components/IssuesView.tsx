import type { HealthIssue, HealthSnapshot } from '@life/db';
import type { HealthApi } from '../useHealth';

const show = (v: unknown) => (v === undefined || v === null || v === '' ? '（空白）' : String(v));
const TABLE_NAME: Record<string, string> = {
  healthBodyMeasurements: '身體量測',
  healthOccasionalMeasurements: '偶爾量測',
  healthBloodPressure: '血壓',
  healthBloodGlucose: '血糖',
  healthTemperature: '體溫',
};

export function IssuesView({ api, snap, onDone }: { api: HealthApi; snap: HealthSnapshot; onDone: () => void }) {
  const url = api.fileUrl('health');
  if (snap.issues.length === 0) {
    return (
      <div className="center">
        <p>✅ 沒有需要補齊的資料</p>
        <button className="primary" onClick={onDone}>
          回總覽
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
