import { useState } from 'react';
import type { Account, MoneySnapshot } from '@life/db';
import { bookBalance, checkDiff, fmtMoney, stocktakeAccounts, stocktakeStatus, todayKey } from '@life/db';
import type { MoneyApi } from '../useMoney';
import { AmountInput } from './EntryEditor';

/** 差額文字：0 = 對得上 */
export function DiffText({ diff, currency }: { diff: number | null; currency: string }) {
  if (diff == null) return <span className="muted small">—</span>;
  if (diff === 0) return <span className="ok-text small">✓ 對得上</span>;
  return (
    <span className="warn-text small">
      {diff > 0 ? '多' : '少'} {fmtMoney(Math.abs(diff), currency)}
    </span>
  );
}

/** 盤點預設哪一天：在提醒期間 = 那個月的最後一天；不然 = 今天 */
export const defaultCheckDate = (snap: MoneySnapshot) => stocktakeStatus(snap, todayKey())?.from ?? todayKey();

/** 盤點一個帳戶：只輸入實際餘額（2026-11-18 確認），有差額也可以先存 */
export function CheckForm({ api, snap, acc, date, onDone }: { api: MoneyApi; snap: MoneySnapshot; acc: Account; date: string; onDone?: () => void }) {
  const [actual, setActual] = useState<number | null>(null);
  const book = bookBalance(acc, snap.txns, date);
  const card = acc.type === '信用卡';
  const diff = book != null && actual != null && !Number.isNaN(actual) ? Math.round((actual - book) * 100) / 100 : null;
  const save = async () => {
    if (actual == null || Number.isNaN(actual)) return api.showToast({ kind: 'error', text: '請填實際餘額' });
    const ok = await api.run((s) => s.saveBalanceCheck(acc.name, date, actual).then(() => true));
    if (ok) {
      api.showToast({ kind: 'info', text: diff ? `已盤點；差 ${fmtMoney(Math.abs(diff), acc.currency)}，可以先補登漏記的，找不到原因再調整差額` : '已盤點' });
      setActual(null);
      onDone?.();
    }
  };
  const setOpening = async () => {
    if (actual == null || Number.isNaN(actual)) return api.showToast({ kind: 'error', text: '請填實際餘額' });
    const ok = await api.run((s) => s.setOpeningFromCheck(acc.name, date, actual).then(() => true));
    if (ok) {
      api.showToast({ kind: 'info', text: `已把 ${date.slice(5).replace('-', '/')} 的 ${fmtMoney(actual, acc.currency)} 設成期初餘額` });
      setActual(null);
      onDone?.();
    }
  };
  return (
    <div className="check-form">
      <div className="row wrap">
        <span className="check-book">
          APP 算的：{book == null ? <span className="muted">沒設期初餘額</span> : <b className="num">{fmtMoney(book, acc.currency)}</b>}
        </span>
        <span className="check-input">
          <AmountInput value={actual} onChange={setActual} placeholder={card ? '實際未繳金額' : '實際餘額'} />
        </span>
        {book == null ? (
          <button onClick={setOpening} disabled={api.busy}>
            設成期初餘額
          </button>
        ) : (
          <button className="primary" onClick={save} disabled={api.busy}>
            存
          </button>
        )}
      </div>
      {diff != null && (
        <p className="hint">
          <DiffText diff={diff} currency={acc.currency} />
          {card && diff !== 0 ? '（未繳金額）' : ''}
        </p>
      )}
    </div>
  );
}

/** 月底盤點（2026-11-18 確認）：每個要盤點的帳戶輸入實際餘額 */
export function StocktakeView({ api, snap, onBack, onOpen }: { api: MoneyApi; snap: MoneySnapshot; onBack: () => void; onOpen: (name: string) => void }) {
  const [date, setDate] = useState(() => defaultCheckDate(snap));
  const list = stocktakeAccounts(snap.accounts);
  const others = snap.accounts.filter((a) => !a.archived && !a.monthlyCheck);
  return (
    <section className="card">
      <div className="page-head">
        <button className="link" onClick={onBack}>
          ‹ 帳戶
        </button>
        <h2>🧮 月底盤點</h2>
      </div>
      <label className="field">
        盤點哪一天的餘額（那天結束時）
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </label>
      <p className="hint">
        每個帳戶輸入實際餘額（信用卡填未繳金額）。有差額也可以先存；漏記的照實際日期補登，差額會自動重算。找不到原因再到帳戶裡按「調整差額」。
      </p>
      {list.map((acc) => {
        const c = [...snap.balanceChecks].reverse().find((x) => x.account === acc.name && x.date === date);
        const d = c ? checkDiff(acc, c, snap.txns) : null;
        return (
          <div className="check-row" key={acc.id}>
            <button className="link check-name" onClick={() => onOpen(acc.name)}>
              {acc.name}
              {acc.last4 && <small>（{acc.last4}）</small>}
            </button>
            {c ? (
              <div className="row wrap">
                <span className="num">實際 {fmtMoney(c.actual, acc.currency)}</span>
                <DiffText diff={d!.now} currency={acc.currency} />
                <button className="link small" onClick={() => onOpen(acc.name)}>
                  詳細
                </button>
              </div>
            ) : (
              <CheckForm api={api} snap={snap} acc={acc} date={date} />
            )}
          </div>
        );
      })}
      {others.length > 0 && (
        <p className="hint">
          不用每月盤點的帳戶：{others.map((a) => a.name).join('、')}（要盤點請點帳戶進去；在「修改帳戶」可以改）
        </p>
      )}
    </section>
  );
}
