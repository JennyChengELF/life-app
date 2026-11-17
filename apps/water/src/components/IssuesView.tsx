import type { Issue, WaterSnapshot } from '@life/db';
import { decodeCell } from '@life/db';
import type { WaterApi } from '../useWater';
import { LogEditor } from './LogEditor';

const show = (v: unknown) => (v === undefined || v === null || v === '' ? '（空白）' : String(v));

export function IssuesView({ api, snap, onDone }: { api: WaterApi; snap: WaterSnapshot; onDone: () => void }) {
  const all = [...snap.waterIssues, ...snap.weightIssues];

  if (all.length === 0) {
    return (
      <div className="center">
        <p>✅ 沒有需要補齊的資料</p>
        <button className="primary" onClick={onDone}>
          回今天
        </button>
      </div>
    );
  }

  return (
    <div className="issues">
      <p className="muted">
        下面是在試算表直接輸入、但格式看不懂或缺內容的資料。修正後按「儲存」，或按「不要這筆」標記刪除。也可以直接到試算表修改，再按右上角 ⟳ 重新整理。
      </p>
      {all.map((i) => (
        <IssueCard key={`${i.table}-${i.rowNumber}`} issue={i} api={api} />
      ))}
    </div>
  );
}

function IssueCard({ issue, api }: { issue: Issue; api: WaterApi }) {
  const isWater = issue.table === 'waterLogs';
  const unit = isWater ? 'ml' : 'kg';
  // 盡量把看得懂的部分帶進編輯框
  const t = decodeCell('datetime', issue.raw.time);
  const a = decodeCell('number', issue.raw[unit]);
  return (
    <section className="card">
      <h2>
        {isWater ? '喝水試算表' : '健康試算表（體重）'} 第 {issue.rowNumber} 列
      </h2>
      <p className="small">
        原本內容：time = {show(issue.raw.time)}、{unit} = {show(issue.raw[unit])}
      </p>
      <ul className="problems">
        {issue.problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <LogEditor
        time={t.ok ? (t.value as number | null) : null}
        amount={a.ok ? (a.value as number | null) : null}
        unit={unit}
        onSave={(time, amount) => api.run((s) => s.fixIssue(issue, { time, amount }))}
        onDelete={() => api.run((s) => s.discardIssue(issue))}
        deleteLabel="不要這筆"
      />
    </section>
  );
}
