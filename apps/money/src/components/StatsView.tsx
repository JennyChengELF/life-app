import type { MoneySnapshot } from '@life/db';
import { fmtMoney, monthStats } from '@life/db';
import { MonthNav } from './common';

function Dist({ items, currency }: { items: { name: string; amount: number }[]; currency: string }) {
  const max = Math.max(1, ...items.map((i) => i.amount));
  return (
    <ul className="dist">
      {items.map((i) => (
        <li key={i.name}>
          <span>{i.name}</span>
          <span className="dist-bar">
            <i style={{ width: `${(i.amount / max) * 100}%` }} />
          </span>
          <span className="dist-num">{fmtMoney(i.amount, currency, false)}</span>
        </li>
      ))}
    </ul>
  );
}

export function StatsView({ snap, month, setMonth }: { snap: MoneySnapshot; month: string; setMonth: (m: string) => void }) {
  const stats = monthStats(snap.txns, snap.categories, snap.accounts, month);
  const hasInvest = snap.categories.some((c) => c.isInvest);
  return (
    <section className="card">
      <MonthNav month={month} setMonth={setMonth} />
      {stats.length === 0 && <p className="muted center-text">這個月還沒有收支</p>}
      {stats.map((s) => (
        <div key={s.currency}>
          {s.currency !== 'TWD' && <h2>{s.currency}（還沒換算新台幣）</h2>}
          <div className="stat-grid">
            <div className="stat-tile">
              <div className="stat-label">總支出</div>
              <div className="stat-value amt-out">{fmtMoney(s.expense, s.currency)}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">總收入</div>
              <div className="stat-value amt-in">{fmtMoney(s.income, s.currency)}</div>
            </div>
            {hasInvest && (
              <>
                <div className="stat-tile">
                  <div className="stat-label">實際支出（不含投資類）</div>
                  <div className="stat-value amt-out">{fmtMoney(s.realExpense, s.currency)}</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-label">實際收入（不含投資類）</div>
                  <div className="stat-value amt-in">{fmtMoney(s.realIncome, s.currency)}</div>
                </div>
              </>
            )}
          </div>
          {s.expenseByTop.length > 0 && (
            <>
              <h2>支出分類</h2>
              <Dist items={s.expenseByTop} currency={s.currency} />
            </>
          )}
          {s.incomeByTop.length > 0 && (
            <>
              <h2>收入分類</h2>
              <Dist items={s.incomeByTop} currency={s.currency} />
            </>
          )}
        </div>
      ))}
      {!hasInvest && <p className="hint">在「設定 → 分類」把投資相關的分類標成「投資類」，這裡就會另外顯示實際收支。</p>}
    </section>
  );
}
