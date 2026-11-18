import type { MoneyIssue, MoneySnapshot } from '@life/db';
import { serialToMs, toSheetDateTime } from '@life/db';
import type { MoneyApi } from '../useMoney';

const TABLE_LABEL: Record<string, string> = { moneyTransactions: '交易', moneyLines: '明細', moneyAccounts: '帳戶', moneyCategories: '分類', hubPeople: '人物', hubOrganizations: '機構' };
/** 試算表的日期時間是序號（例 46343.71）→ 顯示成看得懂的 */
const TIME_COLS = ['time', 'createdAt', 'updatedAt', 'deletedAt', 'date', 'openingDate', 'expiryDate'];
const show = (k: string, v: unknown) => {
  if (v === undefined || v === null || v === '') return '（空白）';
  if (TIME_COLS.includes(k) && typeof v === 'number' && v > 1) {
    const t = toSheetDateTime(serialToMs(v));
    return k === 'time' || k.endsWith('At') ? t.slice(0, 16) : t.slice(0, 10);
  }
  return String(v);
};

export function IssuesView({ api, snap, onDone, onFix }: { api: MoneyApi; snap: MoneySnapshot; onDone: () => void; onFix: (i: MoneyIssue) => void }) {
  const url = api.fileUrl();
  if (snap.issues.length === 0) {
    return (
      <div className="center">
        <p>✅ 沒有需要補齊的資料</p>
        <button className="primary" onClick={onDone}>
          回記帳
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
          開啟記帳試算表 ↗
        </a>
      )}
      {snap.issues.map((i) => (
        <IssueCard key={`${i.table}-${i.rowNumber}`} issue={i} api={api} onFix={onFix} />
      ))}
    </div>
  );
}

function IssueCard({ issue, api, onFix }: { issue: MoneyIssue; api: MoneyApi; onFix: (i: MoneyIssue) => void }) {
  const filled = Object.entries(issue.raw).filter(([k, v]) => v !== undefined && v !== null && v !== '' && k !== 'createdAt' && k !== 'updatedAt');
  return (
    <section className="card">
      <h2>{TABLE_LABEL[issue.table] ?? issue.table}（{issue.table}）第 {issue.rowNumber} 列</h2>
      <p className="small">原本內容：{filled.length ? filled.map(([k, v]) => `${k} = ${show(k, v)}`).join('、') : '（空白）'}</p>
      <ul className="problems">
        {issue.problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <div className="editor-actions">
        {issue.draft && (
          <button className="primary" onClick={() => onFix(issue)}>
            在 APP 裡補完
          </button>
        )}
        <button className="danger" onClick={() => confirm('確定不要這一列嗎？') && api.run((s) => s.discardIssue(issue))}>
          不要這筆
        </button>
      </div>
    </section>
  );
}
