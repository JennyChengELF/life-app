import { useState } from 'react';
import type { Account, AccountType, Category, MoneySnapshot } from '@life/db';
import { ACCOUNT_TYPES } from '@life/db';
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
  expiryDate: null,
  monthlyCheck: true,
  archived: false,
  note: null,
});

function AccountForm({ api, snap, acc, onDone }: { api: MoneyApi; snap: MoneySnapshot; acc?: Account; onDone: () => void }) {
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

function CategoryRow({ api, c }: { api: MoneyApi; c: Category }) {
  return (
    <div className={`list-row ${c.archived ? 'archived' : ''}`}>
      <span className="grow">
        {c.path} {c.isInvest && <span className="tag">投資類</span>} {c.archived && <span className="muted small">（停用）</span>}
      </span>
      <button
        onClick={() => {
          const p = prompt('新的名稱（三層用「 / 」分開；底下的分類會一起改）', c.path);
          if (p && p.trim() !== c.path) api.run((s) => s.updateCategory(c, { path: p }));
        }}
      >
        改名
      </button>
      <button onClick={() => api.run((s) => s.updateCategory(c, { isInvest: !c.isInvest }))}>{c.isInvest ? '取消投資類' : '設成投資類'}</button>
      <button onClick={() => api.run((s) => s.updateCategory(c, { archived: !c.archived }))}>{c.archived ? '恢復' : '停用'}</button>
    </div>
  );
}

export function SettingsView({ api, snap }: { api: MoneyApi; snap: MoneySnapshot }) {
  const [editAcc, setEditAcc] = useState<Account | 'new' | null>(null);
  const url = api.fileUrl();
  const addCat = (kind: '支出' | '收入') => {
    const p = prompt(`新增${kind}分類（三層用「 / 」分開，例：食 / 三餐 / 早餐）`);
    if (p?.trim()) api.run((s) => s.addCategory(p, kind));
  };

  return (
    <div className="settings">
      <section className="card">
        <h2>帳戶</h2>
        {snap.accounts.map((a) =>
          editAcc !== 'new' && editAcc?.id === a.id ? (
            <AccountForm key={a.id} api={api} snap={snap} acc={a} onDone={() => setEditAcc(null)} />
          ) : (
            <div className={`list-row ${a.archived ? 'archived' : ''}`} key={a.id}>
              <span className="grow">
                {a.name}{' '}
                <span className="muted small">
                  {a.type}
                  {a.currency !== 'TWD' ? `・${a.currency}` : ''}
                  {a.org ? `・${a.org}` : ''}
                  {a.archived ? '・停用' : ''}
                </span>
              </span>
              <button onClick={() => setEditAcc(a)}>修改</button>
            </div>
          ),
        )}
        {editAcc === 'new' ? (
          <AccountForm api={api} snap={snap} onDone={() => setEditAcc(null)} />
        ) : (
          <div className="editor-actions">
            <button className="primary" onClick={() => setEditAcc('new')}>
              ＋ 新增帳戶
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>分類</h2>
        {(['支出', '收入'] as const).map((kind) => (
          <details key={kind} open={kind === '支出'}>
            <summary>
              {kind}分類（{snap.categories.filter((c) => c.kind === kind).length}）
            </summary>
            {snap.categories
              .filter((c) => c.kind === kind)
              .map((c) => (
                <CategoryRow key={c.id} api={api} c={c} />
              ))}
            <button className="link small" onClick={() => addCat(kind)}>
              ＋ 新增{kind}分類
            </button>
          </details>
        ))}
        <p className="hint">「投資類」的分類不算進實際收支（例：投資買進、投資賣出、手續費）。</p>
      </section>

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
          <h2>機構</h2>
          {snap.orgs.map((o) => (
            <div className="list-row" key={o.id}>
              <span className="grow">
                {o.name} {o.kind && <span className="muted small">{o.kind}</span>}
              </span>
              <button
                onClick={() => {
                  const n = prompt('新的名稱（帳戶會一起改）', o.name);
                  if (n && n.trim() !== o.name) api.run((s) => s.renameOrg(o, n));
                }}
              >
                改名
              </button>
            </div>
          ))}
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
