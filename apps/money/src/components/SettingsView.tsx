import { useState } from 'react';
import type { Account, AccountType, MoneySnapshot } from '@life/db';
import { ACCOUNT_TYPES, ORG_KINDS } from '@life/db';
import type { MoneyApi } from '../useMoney';
import { amountText, parseAmount } from './common';

type AccountDraft = Omit<Account, 'rowNumber' | 'id' | 'sort'>;
const blankAccount = (): AccountDraft => ({
  name: '',
  type: '現金',
  currency: 'TWD',
  org: null,
  openingDate: null,
  openingBalance: null,
  closingDay: null,
  dueDay: null,
  fxFeeRate: null,
  expiryDate: null,
  monthlyCheck: true,
  archived: false,
  note: null,
});

export function AccountForm({ api, snap, acc, onDone }: { api: MoneyApi; snap: MoneySnapshot; acc?: Account; onDone: () => void }) {
  const [d, setD] = useState<AccountDraft>(() => (acc ? { ...acc } : blankAccount()));
  const [bal, setBal] = useState(amountText(acc?.openingBalance));
  const set = (p: Partial<AccountDraft>) => setD((x) => ({ ...x, ...p }));
  const save = async () => {
    const openingBalance = parseAmount(bal);
    if (Number.isNaN(openingBalance)) return api.showToast({ kind: 'error', text: '期初餘額請填數字' });
    const ok = await api.run((s) => s.saveAccount({ ...d, openingBalance }, acc).then(() => true));
    if (ok) {
      api.showToast({ kind: 'info', text: '已儲存' });
      onDone();
    }
  };
  return (
    <div className="subbox">
      <label className="field">
        名稱
        <input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="例：大戶 台幣活存" />
      </label>
      <div className="row">
        <label className="field" style={{ flex: 2 }}>
          類型
          <select value={d.type} onChange={(e) => set({ type: e.target.value as AccountType })}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: 1 }}>
          幣別
          <input value={d.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} maxLength={3} />
        </label>
      </div>
      <label className="field">
        機構（銀行、電子支付公司⋯⋯；現金可空白）
        <input value={d.org ?? ''} onChange={(e) => set({ org: e.target.value || null })} list="money-orgs" placeholder="例：永豐銀行" />
        <datalist id="money-orgs">
          {snap.orgs.map((o) => (
            <option key={o.id} value={o.name} />
          ))}
        </datalist>
      </label>
      <div className="row">
        <label className="field" style={{ flex: 1 }}>
          期初餘額的日期
          <input type="date" value={d.openingDate ?? ''} onChange={(e) => set({ openingDate: e.target.value || null })} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          {d.type === '信用卡' ? '那天的未繳金額' : '那天結束時的餘額'}
          <input inputMode="decimal" value={bal} onChange={(e) => setBal(e.target.value)} />
        </label>
      </div>
      <p className="hint">期初餘額是計算的起點，那天之後的紀錄才算進去；沒填就不顯示餘額。</p>
      {d.type === '信用卡' && (
        <div className="row">
          <label className="field" style={{ flex: 1 }}>
            結帳日
            <input type="number" min={1} max={31} value={d.closingDay ?? ''} onChange={(e) => set({ closingDay: e.target.value ? Number(e.target.value) : null })} />
          </label>
          <label className="field" style={{ flex: 1 }}>
            繳款日
            <input type="number" min={1} max={31} value={d.dueDay ?? ''} onChange={(e) => set({ dueDay: e.target.value ? Number(e.target.value) : null })} />
          </label>
          <label className="field" style={{ flex: 1 }}>
            國外交易手續費 %
            <input type="number" inputMode="decimal" step={0.1} min={0} placeholder="1.5" value={d.fxFeeRate ?? ''} onChange={(e) => set({ fxFeeRate: e.target.value ? Number(e.target.value) : null })} />
          </label>
        </div>
      )}
      {(d.type === '禮券' || d.type === '儲值卡') && (
        <label className="field">
          到期日（選填）
          <input type="date" value={d.expiryDate ?? ''} onChange={(e) => set({ expiryDate: e.target.value || null })} />
        </label>
      )}
      <label className="field">
        備註
        <input value={d.note ?? ''} onChange={(e) => set({ note: e.target.value || null })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={d.monthlyCheck} onChange={(e) => set({ monthlyCheck: e.target.checked })} />
        每月盤點（盤點功能之後做）
      </label>
      {acc && (
        <label className="check">
          <input type="checkbox" checked={d.archived} onChange={(e) => set({ archived: e.target.checked })} />
          停用（記帳時不出現，舊紀錄保留）
        </label>
      )}
      <div className="editor-actions">
        <button className="primary" onClick={save} disabled={api.busy}>
          儲存
        </button>
        <button onClick={onDone}>取消</button>
      </div>
    </div>
  );
}

function MoneySettingsCard({ api, snap }: { api: MoneyApi; snap: MoneySnapshot }) {
  const [cmp, setCmp] = useState(snap.settings.incomeCompare);
  const [days, setDays] = useState(String(snap.settings.loanRemindDays));
  const changed = cmp !== snap.settings.incomeCompare || days !== String(snap.settings.loanRemindDays);
  return (
    <section className="card">
      <h2>預算與提醒</h2>
      <label className="field">
        「待分配」和哪個月的收入比
        <select value={cmp} onChange={(e) => setCmp(e.target.value as typeof cmp)}>
          <option value="上個月">上個月的收入（月初領薪水）</option>
          <option value="本月">本月的收入（月中、月底領薪水；還沒領時會是負的）</option>
        </select>
      </label>
      <label className="field">
        借出超過幾天沒還，首頁提醒
        <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
      </label>
      <div className="editor-actions">
        <button
          className="primary"
          disabled={!changed || api.busy}
          onClick={async () => {
            const ok = await api.run((s) => s.saveMoneySettings({ incomeCompare: cmp, loanRemindDays: Number(days) }).then(() => true));
            if (ok) api.showToast({ kind: 'info', text: '已儲存' });
          }}
        >
          儲存
        </button>
      </div>
    </section>
  );
}

export function SettingsView({ api, snap, openBudgets }: { api: MoneyApi; snap: MoneySnapshot; openBudgets: () => void }) {
  const url = api.fileUrl();
  return (
    <div className="settings">
      <p className="hint">帳戶在「🏦 帳戶」、分類在「🏷️ 分類」分頁直接修改。</p>
      <section className="card">
        <h2>預算</h2>
        <p className="muted small">{snap.budgets.length} 個預算</p>
        <button className="primary" onClick={openBudgets}>
          預算設定 ›
        </button>
      </section>

      <MoneySettingsCard api={api} snap={snap} />

      <section className="card">
        <h2>人物</h2>
        <p className="hint">分帳、借款的對象。存在「生活APP-綜合」，之後其他 APP 也會用到。</p>
        {snap.people
          .filter((p) => !p.isSelf)
          .map((p) => (
            <div className={`list-row ${p.archived ? 'archived' : ''}`} key={p.id}>
              <span className="grow">
                {p.name} {p.archived && <span className="muted small">（停用）</span>}
              </span>
              <button
                onClick={() => {
                  const n = prompt('新的名稱（用到的紀錄會一起改）', p.name);
                  if (n && n.trim() !== p.name) api.run((s) => s.updatePerson(p, { name: n }));
                }}
              >
                改名
              </button>
              <button onClick={() => api.run((s) => s.updatePerson(p, { archived: !p.archived }))}>{p.archived ? '恢復' : '停用'}</button>
            </div>
          ))}
        <button
          className="link small"
          onClick={() => {
            const n = prompt('新增人物（名稱）');
            if (n?.trim()) api.run((s) => s.addPerson(n));
          }}
        >
          ＋ 新增人物
        </button>
      </section>

      {snap.orgs.length > 0 && (
        <section className="card">
          <h2>店家 / 機構</h2>
          <p className="hint">記帳的店家 / 對象、帳戶的銀行都在這裡（存在「生活APP-綜合」）。記帳時輸入新的店家會自動加進來。</p>
          <details>
            <summary>全部 {snap.orgs.length} 個</summary>
          {snap.orgs.map((o) => (
            <div className="list-row" key={o.id}>
              <span className="grow">
                {o.name}
              </span>
              <label className="check inline small">
                <input type="checkbox" checked={o.foreign} onChange={(e) => api.run((s) => s.updateOrg(o, { foreign: e.target.checked }))} />
                國外
              </label>
              <select className="kind-select" value={o.kind ?? ''} onChange={(e) => api.run((s) => s.updateOrg(o, { kind: e.target.value || null }))}>
                <option value="">類別</option>
                {ORG_KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
                {o.kind && !(ORG_KINDS as readonly string[]).includes(o.kind) && <option>{o.kind}</option>}
              </select>
              <button
                onClick={() => {
                  const n = prompt('新的名稱（帳戶、交易的店家會一起改）', o.name);
                  if (n && n.trim() !== o.name) api.run((s) => s.updateOrg(o, { name: n }));
                }}
              >
                改名
              </button>
            </div>
          ))}
            </details>
      </section>
      )}

      <section className="card">
        <h2>資料</h2>
        {api.mode === 'local' ? (
          <p className="muted">本機測試模式：資料只存在這個瀏覽器。設定好 Google 後會改存到你的 Google 試算表。</p>
        ) : (
          <>
            <p className="muted small">
              資料存在你的 Google 試算表「生活APP-記帳」（人物、機構在「生活APP-綜合」）。建議在 APP 裡記帳；直接在試算表新增的資料，APP 打開時會檢查，有問題的列在「需要補齊」。
            </p>
            <p className="muted small">⚠️ 記帳資料比較私密，建議確認試算表的共用設定是「限制」（只有你能看）。</p>
            {url && (
              <a className="btn" href={url} target="_blank" rel="noreferrer">
                開啟記帳試算表 ↗
              </a>
            )}
            <div>
              <button className="link danger-text" onClick={api.signOut}>
                中斷 Google 連線
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
