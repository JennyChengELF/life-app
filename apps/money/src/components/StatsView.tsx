import { useState } from 'react';
import type { MoneySnapshot } from '@life/db';
import { categoryBreakdown, fmtMoney, monthlyTotals, monthStats, txnReportCurrency, txnMyNet } from '@life/db';
import { MonthNav } from './common';

const pct = (x: number) => `${(x * 100).toFixed(x >= 0.1 ? 0 : 1)}%`;

/**
 * 分類佔比（2026-11-18 使用者要求）：每個分類的金額、佔比；點一下展開子分類（子分類的佔比是佔上一層的）
 */
function Breakdown({ byPath, currency, parent = null, depth = 0 }: { byPath: Map<string, number>; currency: string; parent?: string | null; depth?: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const items = categoryBreakdown(byPath, parent);
  const max = Math.max(1, ...items.map((i) => i.amount));
  return (
    <ul className={`dist ${depth ? 'sub' : ''}`}>
      {items.map((i) => (
        <li key={i.path + i.name}>
          <button
            className={`dist-row ${i.hasChildren ? 'can-open' : ''}`}
            onClick={() => i.hasChildren && setOpen(open === i.path ? null : i.path)}
            disabled={!i.hasChildren}
          >
            <span className="dist-name">
              {i.hasChildren ? (open === i.path ? '▼ ' : '▶ ') : ''}
              {i.name}
            </span>
            <span className="dist-bar">
              <i style={{ width: `${(i.amount / max) * 100}%` }} />
            </span>
            <span className="dist-pct">{pct(i.share)}</span>
            <span className="dist-num">{fmtMoney(i.amount, currency, false)}</span>
          </button>
          {open === i.path && <Breakdown byPath={byPath} currency={currency} parent={i.path} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

function YearNav({ year, setYear }: { year: string; setYear: (y: string) => void }) {
  return (
    <div className="month-nav">
      <button className="link" onClick={() => setYear(String(Number(year) - 1))} aria-label="前一年">
        ◀
      </button>
      <span className="date-label">{year} 年</span>
      <button className="link" onClick={() => setYear(String(Number(year) + 1))} aria-label="後一年">
        ▶
      </button>
    </div>
  );
}

function DailyBars({ snap, month, currency }: { snap: MoneySnapshot; month: string; currency: string }) {
  const sums = new Map<string, { expense: number; income: number }>();
  for (const txn of snap.txns) {
    if (!txn.date.startsWith(month) || txnReportCurrency(txn, snap.accounts) !== currency) continue;
    const row = sums.get(txn.date) ?? { expense: 0, income: 0 };
    const { expense, income } = txnMyNet(txn, true);
    sums.set(txn.date, { expense: row.expense + expense, income: row.income + income });
  }
  const rows = [...sums.keys()].sort().map((date) => ({ date, ...sums.get(date)! }));
  const max = Math.max(1, ...rows.flatMap((row) => [row.expense, row.income]));
  if (!rows.length) return null;
  return <><h2>每日收支</h2><ul className="daily-bars">{rows.map((row) => <li key={row.date}><span>{Number(row.date.slice(8))} 日</span><span className="month-bars"><i className="out" style={{ width: `${row.expense / max * 100}%` }} /><i className="in" style={{ width: `${row.income / max * 100}%` }} /></span><span className="num">{fmtMoney(row.expense, currency, false)} / {fmtMoney(row.income, currency, false)}</span></li>)}</ul><p className="hint">上排是支出，下排是收入。</p></>;
}

export function StatsView({ snap, initialMonth }: { snap: MoneySnapshot; initialMonth: string }) {
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const [month, setMonth] = useState(initialMonth);
  const [year, setYear] = useState(initialMonth.slice(0, 4));
  const prefix = mode === 'month' ? month : year;
  const stats = monthStats(snap.txns, snap.categories, snap.accounts, prefix);
  const hasInvest = snap.categories.some((c) => c.isInvest);
  const months = mode === 'year' ? monthlyTotals(snap.txns, snap.categories, snap.accounts, year) : [];
  const maxMonth = Math.max(1, ...months.map((m) => Math.max(m.expense, m.income)));

  return (
    <section className="card">
      <div className="ledger-head">
        {mode === 'month' ? (
          <MonthNav month={month} setMonth={(m) => (setMonth(m), setYear(m.slice(0, 4)))} />
        ) : (
          <YearNav year={year} setYear={setYear} />
        )}
        <div className="seg">
          <button className={mode === 'month' ? 'active' : ''} onClick={() => setMode('month')}>
            月
          </button>
          <button className={mode === 'year' ? 'active' : ''} onClick={() => setMode('year')}>
            年
          </button>
        </div>
      </div>

      {stats.length === 0 && <p className="muted center-text">{mode === 'month' ? '這個月' : '這一年'}還沒有收支</p>}
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
            <div className="stat-tile">
              <div className="stat-label">差額</div>
              <div className={`stat-value ${s.income - s.expense < 0 ? 'amt-out' : 'amt-in'}`}>{fmtMoney(s.income - s.expense, s.currency)}</div>
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

          {mode === 'month' && <DailyBars snap={snap} month={month} currency={s.currency} />}

          {s.currency === 'TWD' && mode === 'year' && (
            <>
              <h2>每月</h2>
              <ul className="months">
                {months.map((m) => (
                  <li key={m.month}>
                    <button
                      className="month-row"
                      onClick={() => {
                        setMonth(m.month);
                        setMode('month');
                      }}
                      title="看這個月"
                    >
                      <span>{Number(m.month.slice(5))} 月</span>
                      <span className="month-bars">
                        <i className="out" style={{ width: `${(m.expense / maxMonth) * 100}%` }} />
                        <i className="in" style={{ width: `${(m.income / maxMonth) * 100}%` }} />
                      </span>
                      <span className="num amt-out">{fmtMoney(m.expense, 'TWD', false)}</span>
                      <span className="num amt-in">{fmtMoney(m.income, 'TWD', false)}</span>
                      <span className={`num ${m.income - m.expense < 0 ? 'amt-out' : 'amt-in'}`}>{fmtMoney(m.income - m.expense, 'TWD', false)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="hint">上排紅色是支出、下排綠色是收入；點一個月看那個月的明細。</p>
            </>
          )}

          {s.expense !== 0 && (
            <>
              <h2>支出分類</h2>
              <Breakdown byPath={s.expenseByPath} currency={s.currency} />
            </>
          )}
          {s.income !== 0 && (
            <>
              <h2>收入分類</h2>
              <Breakdown byPath={s.incomeByPath} currency={s.currency} />
            </>
          )}
        </div>
      ))}
      <p className="hint">點有 ▶ 的分類可以展開，子分類的 % 是佔上一層的比例。</p>
      {!hasInvest && <p className="hint">在「更多 → 分類」把投資相關的分類設成「投資類」，這裡就會另外顯示實際收支。</p>}
    </section>
  );
}
