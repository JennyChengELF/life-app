import { useState } from 'react';
import type { Account, MoneySnapshot } from '@life/db';
import { accountBalance, emptyForm, fmtMoney, personBalances } from '@life/db';
import type { Editing } from '../App';

/** 帳戶顯示的金額：信用卡顯示「未繳」 */
function BalanceText({ acc, bal }: { acc: Account; bal: number | null }) {
  if (bal == null) return <span className="muted small">沒設期初餘額</span>;
  if (acc.type === '信用卡') return <span className="num">{bal < 0 ? `未繳 ${fmtMoney(-bal, acc.currency)}` : fmtMoney(bal, acc.currency)}</span>;
  return <span className={`num ${bal < 0 ? 'amt-out' : ''}`}>{fmtMoney(bal, acc.currency)}</span>;
}

/** 合計：依幣別分開列（2026-11-18 確認：第一版不換算）；信用卡欠款扣掉 */
function totals(list: { acc: Account; bal: number | null }[]) {
  const m = new Map<string, number>();
  for (const { acc, bal } of list) if (bal != null) m.set(acc.currency, (m.get(acc.currency) ?? 0) + bal);
  return [...m].map(([c, n]) => fmtMoney(n, c)).join(' ／ ');
}

export function AccountsView({ snap, onEdit, goSettings }: { snap: MoneySnapshot; onEdit: (e: Editing) => void; goSettings: () => void }) {
  const [by, setBy] = useState<'org' | 'type'>('org');
  const [showArchived, setShowArchived] = useState(false);
  const rows = snap.accounts
    .filter((a) => showArchived || !a.archived)
    .map((acc) => ({ acc, bal: accountBalance(acc, snap.txns) }));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const g = by === 'org' ? (r.acc.org ?? (r.acc.type === '現金' ? '💵 現金' : '（沒有機構）')) : r.acc.type;
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }
  const people = personBalances(snap.txns, snap.accounts).filter((b) => b.net !== 0);

  return (
    <>
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>帳戶</h2>
          <div className="seg">
            <button className={by === 'org' ? 'active' : ''} onClick={() => setBy('org')}>
              依機構
            </button>
            <button className={by === 'type' ? 'active' : ''} onClick={() => setBy('type')}>
              依類型
            </button>
          </div>
        </div>
        {!snap.accounts.length && (
          <p className="muted">
            還沒有帳戶。<button className="link" onClick={goSettings}>到設定新增帳戶</button>
          </p>
        )}
        {[...groups].map(([g, list]) => (
          <div className="grp" key={g}>
            <div className="grp-head">
              <span>{g}</span>
              <span className="grp-total">{list.length > 1 ? totals(list) : ''}</span>
            </div>
            {list.map(({ acc, bal }) => (
              <div key={acc.id} className={`acc-row ${acc.archived ? 'archived' : ''}`} onClick={goSettings} title="到設定修改">
                <span className="acc-name">
                  {acc.name}
                  <small>{by === 'org' ? acc.type : (acc.org ?? '')}</small>
                </span>
                <BalanceText acc={acc} bal={bal} />
              </div>
            ))}
          </div>
        ))}
        {snap.accounts.some((a) => a.archived) && (
          <label className="check small muted">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            顯示停用的帳戶
          </label>
        )}
      </section>

      <section className="card">
        <h2>誰欠誰</h2>
        {people.length === 0 ? (
          <p className="muted">目前沒有欠款</p>
        ) : (
          people.map((b) => (
            <div className="person-row" key={`${b.person}-${b.currency}`}>
              <span className="grow">
                {b.net > 0 ? (
                  <>
                    <b>{b.person}</b> 欠我 <span className="num amt-in">{fmtMoney(b.net, b.currency)}</span>
                  </>
                ) : (
                  <>
                    我欠 <b>{b.person}</b> <span className="num amt-out">{fmtMoney(-b.net, b.currency)}</span>
                  </>
                )}
                {b.loan !== 0 && b.split !== 0 && (
                  <span className="muted small">
                    {' '}
                    （分帳 {fmtMoney(b.split, b.currency, false)}、借款 {fmtMoney(b.loan, b.currency, false)}，還款另計）
                  </span>
                )}
              </span>
              <button
                onClick={() =>
                  onEdit({ form: { ...emptyForm('還款'), person: b.person, sub: b.net > 0 ? '他還我' : '我還他', amount: Math.abs(b.net) } })
                }
              >
                還款
              </button>
              <button
                onClick={() =>
                  onEdit({
                    form: {
                      ...emptyForm('不用還了'),
                      person: b.person,
                      sub: b.net > 0 ? '他還我' : '我還他',
                      amount: Math.abs(b.net),
                      currency: b.currency === 'TWD' ? null : b.currency,
                    },
                  })
                }
              >
                不用還了
              </button>
            </div>
          ))
        )}
        <div className="add-bar">
          <button onClick={() => onEdit({ form: emptyForm('借款') })}>記借款</button>
          <button onClick={() => onEdit({ form: emptyForm('還款') })}>記還款</button>
        </div>
      </section>
    </>
  );
}
