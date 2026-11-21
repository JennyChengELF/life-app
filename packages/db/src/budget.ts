/**
 * 預算（信封袋）的計算。規則見 規劃.md 記帳段落（2026-11-18 確認）：
 * - 沒用完的留到下個月、超支從下個月扣（可用 = 累計，不另外存餘額）
 * - 預算可用 = 最新一次「期初」（重新整理預算）＋ 之後的分配 ＋ 放進預算的收入 − 扣預算的支出
 * - 支出可以不選預算（不擋存檔），預算頁提醒補填
 * - 第一版只算新台幣（外幣換算之後再做）
 */
import type { Allocation, Budget, Line, MoneySnapshot, Txn, TxnInput } from './money';
import { isRecordOnlyTxn, personBalances, txnCurrency } from './money';
import { addDays, startOfDay, toDateKey } from './time';

const monthStart = (m: string) => `${m}-01`;
export function prevMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const monthEnd = (m: string) => addDays(monthStart(nextMonth(m)), -1);
export function nextMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 某個預算在某天以前（含）最新一次的期初 */
export function budgetBaseline(allocations: Allocation[], budget: string, upTo: string): Allocation | null {
  let best: Allocation | null = null;
  for (const a of allocations) {
    if (a.kind !== '期初' || a.budget !== budget || !a.date || a.date > upTo) continue;
    if (!best || a.date > best.date! || (a.date === best.date && a.rowNumber > best.rowNumber)) best = a;
  }
  return best;
}

/**
 * 某一天「開始時」各預算原本可用的金額。
 * 月分配視為月初放入；若期初在月中，該月分配已包含在期初金額裡。
 */
export function budgetStartAmounts(snap: MoneySnapshot, date: string): { budget: string; amount: number }[] {
  const before = addDays(date, -1);
  const beforeMonth = before.slice(0, 7);
  const lines = twdLines(snap);
  return snap.budgets.map((budget) => {
    const sameDay = budgetBaseline(snap.allocations, budget.name, date);
    if (sameDay?.date === date) return { budget: budget.name, amount: sameDay.amount };
    const base = budgetBaseline(snap.allocations, budget.name, before);
    const since = base?.date ?? '0000-00-00';
    let amount = base?.amount ?? 0;
    for (const a of snap.allocations) {
      if (a.budget !== budget.name || a.kind === '期初' || a.month > beforeMonth || monthStart(a.month) < since) continue;
      amount += a.amount;
    }
    for (const x of lines) {
      if (x.line.budget !== budget.name || x.txn.date < since || x.txn.date > before) continue;
      amount += x.line.kind === '收入' ? x.line.amount : -x.line.amount;
    }
    return { budget: budget.name, amount };
  });
}

/** 補登早於最新期初的交易時，這些預算只會重算舊月份，不會改動新預算。 */
export function backfillBudgetNames(snap: MoneySnapshot, tx: Pick<TxnInput, 'time' | 'lines'>): string[] {
  const date = toDateKey(tx.time);
  return [...new Set(tx.lines.map((line) => line.budget).filter((name): name is string => !!name))].filter((name) => {
    const latest = budgetBaseline(snap.allocations, name, '9999-12-31');
    return !!latest?.date && date < latest.date;
  });
}

/** 新台幣的支出 / 收入明細（含交易） */
function twdLines(snap: MoneySnapshot): { txn: Txn; line: Line }[] {
  const out: { txn: Txn; line: Line }[] = [];
  for (const t of snap.txns) {
    if (txnCurrency(t, snap.accounts) !== 'TWD' || isRecordOnlyTxn(t)) continue;
    for (const l of t.lines) if (l.kind === '支出' || l.kind === '收入') out.push({ txn: t, line: l });
  }
  return out;
}

export interface BudgetMonthRow {
  budget: Budget;
  /** 上月結餘（期初在這個月的話 = 期初金額） */
  carry: number;
  /** 本月分配（每月＋追加＋年終） */
  allocated: number;
  /** 本月放進這個預算的收入 */
  income: number;
  /** 本月支出（退款是負的） */
  used: number;
  /** 可用 = 結餘 ＋ 分配 ＋ 收入 − 支出 */
  available: number;
  /** 這個預算從哪天開始算（最新一次期初） */
  since: string | null;
  /** 本月扣這個預算的明細（新 → 舊） */
  lines: { txn: Txn; line: Line }[];
  /** 本月的分配紀錄 */
  allocs: Allocation[];
}

export interface BudgetMonth {
  month: string;
  rows: BudgetMonthRow[];
  /** 本月預算確認過了（有「每月」的分配） */
  confirmed: boolean;
  /** 待分配 = 比較用的收入（沒放進預算的）− 本月分配合計 */
  unallocated: number;
  /** 比較用的收入（上個月或本月，看設定） */
  incomeBase: number;
  incomeMonth: string;
  /** 本月沒選預算的支出 */
  missing: { txn: Txn; line: Line }[];
}

export function budgetMonth(snap: MoneySnapshot, month: string): BudgetMonth {
  const ms = monthStart(month);
  const me = monthEnd(month);
  const lines = twdLines(snap);
  const rows: BudgetMonthRow[] = snap.budgets.map((b) => {
    const base = budgetBaseline(snap.allocations, b.name, me);
    const since = base?.date ?? '0000-00-00';
    let carry = base?.amount ?? 0;
    let allocated = 0;
    let income = 0;
    let used = 0;
    const mine: { txn: Txn; line: Line }[] = [];
    const allocs: Allocation[] = [];
    for (const a of snap.allocations) {
      if (a.budget !== b.name || a.kind === '期初') continue;
      // 期初在月中：那個月的分配已經算在期初裡
      if (monthStart(a.month) < since) continue;
      if (a.month < month) carry += a.amount;
      else if (a.month === month) {
        allocated += a.amount;
        allocs.push(a);
      }
    }
    for (const x of lines) {
      if (x.line.budget !== b.name || x.txn.date < since || x.txn.date > me) continue;
      const sign = x.line.kind === '收入' ? 1 : -1;
      if (x.txn.date < ms) carry += sign * x.line.amount;
      else {
        if (x.line.kind === '收入') income += x.line.amount;
        else used += x.line.amount;
        mine.push(x);
      }
    }
    return { budget: b, carry, allocated, income, used, available: carry + allocated + income - used, since: base?.date ?? null, lines: mine, allocs };
  });

  const incomeMonth = snap.settings.incomeCompare === '本月' ? month : prevMonth(month);
  const incomeBase = lines
    .filter((x) => x.line.kind === '收入' && !x.line.budget && x.txn.date.startsWith(incomeMonth))
    .reduce((a, x) => a + x.line.amount, 0);
  const allocatedAll = snap.allocations.filter((a) => a.month === month && a.kind !== '期初').reduce((s, a) => s + a.amount, 0);
  return {
    month,
    rows,
    confirmed: snap.allocations.some((a) => a.month === month && a.kind === '每月'),
    unallocated: incomeBase - allocatedAll,
    incomeBase,
    incomeMonth,
    missing: lines.filter((x) => x.line.kind === '支出' && !x.line.budget && x.txn.date.startsWith(month)),
  };
}

/** 每月預算草稿（2026-11-18 確認）：每月預算、沒停用的，先帶基本金額 */
export function budgetDraft(snap: MoneySnapshot): { budget: string; basic: number; ideal: number; amount: number }[] {
  return snap.budgets
    .filter((b) => b.monthly && !b.archived)
    .map((b) => ({ budget: b.name, basic: b.basic ?? 0, ideal: b.ideal ?? 0, amount: b.basic ?? 0 }));
}

/**
 * 今年還差多少到理想（2026-11-18 確認：領年終時補）：
 * 每個確認過的月份「當時的理想金額」加總 − 今年放進去的（每月＋追加＋年終）；小於 0 算 0
 */
export function yearGaps(snap: MoneySnapshot, year: string): { budget: string; gap: number }[] {
  return snap.budgets
    .filter((b) => !b.archived)
    .map((b) => {
      let ideal = 0;
      let put = 0;
      for (const a of snap.allocations) {
        if (a.budget !== b.name || !a.month.startsWith(year) || a.kind === '期初') continue;
        if (a.kind === '每月') ideal += a.ideal ?? 0;
        put += a.amount;
      }
      return { budget: b.name, gap: Math.max(0, ideal - put) };
    })
    .filter((x) => x.gap > 0);
}

/** 記帳時自動帶入的預算：分類的預設預算 → 這個分類上次用的預算 */
export function defaultBudgetFor(snap: MoneySnapshot, category: string | null): string | null {
  if (!category) return null;
  const c = snap.categories.find((x) => x.path === category);
  if (c?.defaultBudget && snap.budgets.some((b) => b.name === c.defaultBudget && !b.archived)) return c.defaultBudget;
  for (const t of snap.txns) for (const l of t.lines) if (l.category === category && l.budget) return l.budget;
  return null;
}

/** 借出未還（新台幣）：預算頁最上面顯示（2026-11-18 確認：不另設「借貸用」預算） */
export function loansOutstanding(snap: MoneySnapshot): { total: number; people: number } {
  const b = personBalances(snap.txns, snap.accounts).filter((x) => x.currency === 'TWD' && x.net > 0);
  return { total: b.reduce((s, x) => s + x.net, 0), people: b.length };
}

/**
 * 首頁提醒：有人欠我、而且從「開始欠」到現在超過 N 天（N 在設定）。
 * 開始欠 = 這個人的淨額最近一次從 ≤ 0 變成 > 0 的那天
 */
export function loanReminders(snap: MoneySnapshot, now = Date.now()): { person: string; currency: string; amount: number; days: number }[] {
  const running = new Map<string, { net: number; since: string | null }>();
  const asc = [...snap.txns].sort((a, b) => a.time - b.time);
  for (const t of asc) {
    const cur = txnCurrency(t, snap.accounts);
    for (const l of t.lines) {
      if (!l.person) continue;
      const sign = l.kind === '他欠我' || l.kind === '我還他' ? 1 : l.kind === '我欠他' || l.kind === '他還我' ? -1 : 0;
      if (!sign) continue;
      const key = `${l.person}\u0000${cur}`;
      const r = running.get(key) ?? { net: 0, since: null };
      const before = r.net;
      r.net += sign * l.amount;
      if (before <= 0.004 && r.net > 0.004) r.since = t.date;
      if (r.net <= 0.004) r.since = null;
      running.set(key, r);
    }
  }
  const out: { person: string; currency: string; amount: number; days: number }[] = [];
  for (const [key, r] of running) {
    if (!r.since || r.net <= 0.004) continue;
    const days = Math.floor((now - startOfDay(r.since)) / 86400000);
    if (days < snap.settings.loanRemindDays) continue;
    const [person, currency] = key.split('\u0000');
    out.push({ person, currency, amount: r.net, days });
  }
  return out.sort((a, b) => b.days - a.days);
}
