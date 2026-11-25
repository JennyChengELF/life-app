/**
 * 記帳第 3 輪：帳單對帳、月底盤點（2026-11-18 確認，見 規劃.md 記帳段落）。
 * 這裡只放計算（不讀寫試算表）；讀寫在 MoneyStore。
 * - 一期帳單 = 帳戶＋結帳日；期間是「上一期結帳日的隔天 ~ 這期結帳日」
 * - 金額照帳單的正負：信用卡刷卡正、退款負；銀行存入正、支出負
 * - 自動配對：金額相同且日期相差 3 天內；帳單有、記帳沒有 → 補登；記帳有、帳單沒有 → 留到下一期
 * - 哪些交易已經對過帳，看帳單明細的 matched（不另外存在交易上）
 */
import type { Account, BalanceCheck, EntryForm, MoneySnapshot, Statement, StatementItem, Txn } from './money';
import { accountBalance, accountDelta, addMonthsToDate, emptyForm, lastCategoryOfStore, monthEnd, NO_MATCH, roundMoney } from './money';
import { addDays, startOfDay } from './time';

const same = (a: number, b: number) => Math.abs(a - b) < 0.005;
const dayDiff = (a: string, b: string) => Math.round(Math.abs(startOfDay(a) - startOfDay(b)) / 86400000);

/** 可以對帳的帳戶類型（現金、定存、禮券沒有帳單） */
export const RECONCILE_TYPES = ['銀行', '信用卡', '電子支付', '儲值卡'];
export const canReconcile = (acc: Pick<Account, 'type'>) => RECONCILE_TYPES.includes(acc.type);

/** 這筆交易在帳單上的金額（照帳單的正負）；和這個帳戶無關 → 0 */
export function stmtAmount(t: Txn, acc: Pick<Account, 'name' | 'type' | 'currency'>): number {
  const d = accountDelta(t, acc.name, acc.currency);
  return roundMoney(acc.type === '信用卡' ? -d : d, acc.currency);
}

/** 帳單明細比對用的日期：消費日，沒有就用入帳日 */
export const itemDate = (i: Pick<StatementItem, 'date' | 'postedDate'>) => i.date ?? i.postedDate;

/** 這一期從哪天之後開始（不含這天）：上一期的結帳日；第一期 = 結帳日往前一個月 */
export function periodStart(statements: Statement[], account: string, closeDate: string): string {
  const prev = statements.filter((s) => s.account === account && s.closeDate < closeDate).map((s) => s.closeDate);
  return prev.length ? prev.sort().at(-1)! : addMonthsToDate(closeDate, -1);
}

export interface ReconcilePair {
  item: StatementItem;
  txns: Txn[];
  /** APP 自動配對的（還沒寫進試算表） */
  auto: boolean;
}

export interface ReconcileResult {
  /** 這一期的期間（start 不含） */
  start: string;
  pairs: ReconcilePair[];
  /** 帳單有、記帳沒有（含手動取消配對的） */
  itemsOnly: StatementItem[];
  /** 記帳有、帳單沒有（留到下一期） */
  txnsOnly: Txn[];
  /** 還沒配對、可以手動選的交易（含結帳日後 3 天內的） */
  pool: Txn[];
  /** 帳單的一行 → 建議一起配對的幾筆（同一天、加總剛好等於帳單金額） */
  suggestions: Map<string, Txn[][]>;
}

/**
 * 對帳：帳單明細和這個帳戶的交易配對。
 * 交易範圍：這個帳戶第一期開始之後、到結帳日 3 天後，還沒在別期配對過的
 * （「記帳有、帳單沒有」會一直留到之後的期別，直到配對為止）
 */
export function reconcile(snap: Pick<MoneySnapshot, 'txns' | 'statements' | 'statementItems'>, acc: Account, stmt: Pick<Statement, 'id' | 'closeDate'>): ReconcileResult {
  const mine = snap.statements.filter((s) => s.account === acc.name);
  const closeDate = stmt.closeDate;
  const start = periodStart(snap.statements, acc.name, closeDate);
  const floor = [start, ...mine.map((s) => periodStart(snap.statements, acc.name, s.closeDate))].sort()[0];
  const items = snap.statementItems.filter((i) => i.account === acc.name && i.closeDate === closeDate);
  const elsewhere = new Set(snap.statementItems.filter((i) => i.account === acc.name && i.closeDate !== closeDate).flatMap((i) => i.matched));
  const limit = addDays(closeDate, 3);
  const byId = new Map<string, Txn>();
  for (const t of snap.txns) {
    if (t.date <= floor || t.date > limit || elsewhere.has(t.id) || stmtAmount(t, acc) === 0) continue;
    byId.set(t.id, t);
  }
  const used = new Set<string>();
  const pairs: ReconcilePair[] = [];
  const itemsOnly: StatementItem[] = [];
  const waiting: StatementItem[] = [];
  // 已經寫進試算表的配對
  for (const it of items) {
    if (it.matched.includes(NO_MATCH)) {
      itemsOnly.push(it);
      continue;
    }
    const ts = it.matched.map((id) => byId.get(id)).filter((t): t is Txn => !!t && !used.has(t.id));
    if (!ts.length) {
      waiting.push(it);
      continue;
    }
    ts.forEach((t) => used.add(t.id));
    pairs.push({ item: it, txns: ts, auto: false });
  }
  // 自動配對：金額相同、日期相差 3 天內，日期最近的（帳單名稱一樣的優先）
  const sorted = [...waiting].sort((a, b) => (itemDate(a) ?? '').localeCompare(itemDate(b) ?? ''));
  for (const it of sorted) {
    const d = itemDate(it);
    let best: Txn | null = null;
    let bestScore = Infinity;
    for (const t of byId.values()) {
      if (used.has(t.id) || !same(stmtAmount(t, acc), it.amount)) continue;
      const diff = d ? dayDiff(d, t.date) : 0;
      if (diff > 3) continue;
      const score = diff - (it.description && t.statementText === it.description ? 0.5 : 0);
      if (score < bestScore) {
        best = t;
        bestScore = score;
      }
    }
    if (best) {
      used.add(best.id);
      pairs.push({ item: it, txns: [best], auto: true });
    } else itemsOnly.push(it);
  }
  const pool = [...byId.values()].filter((t) => !used.has(t.id)).sort((a, b) => a.time - b.time);
  // 沒合成一筆交易的舊紀錄：同一天、加總剛好等於帳單金額的幾筆（2–4 筆）
  const suggestions = new Map<string, Txn[][]>();
  for (const it of itemsOnly) {
    if (it.matched.includes(NO_MATCH)) continue;
    const d = itemDate(it);
    if (!d) continue;
    const day = pool.filter((t) => t.date === d).slice(0, 12);
    const found = subsetsSumming(day, (t) => stmtAmount(t, acc), it.amount, 4, 3);
    if (found.length) suggestions.set(it.id, found);
  }
  pairs.sort((a, b) => (itemDate(a.item) ?? '').localeCompare(itemDate(b.item) ?? '') || a.item.rowNumber - b.item.rowNumber);
  itemsOnly.sort((a, b) => (itemDate(a) ?? '').localeCompare(itemDate(b) ?? '') || a.rowNumber - b.rowNumber);
  return { start, pairs, itemsOnly, txnsOnly: pool.filter((t) => t.date <= closeDate), pool, suggestions };
}

/** 找加總剛好等於 target 的組合（2 ~ maxSize 筆，最多 maxFound 組） */
function subsetsSumming<T>(list: T[], val: (x: T) => number, target: number, maxSize: number, maxFound: number): T[][] {
  const out: T[][] = [];
  const pick: T[] = [];
  const walk = (from: number, total: number) => {
    if (out.length >= maxFound) return;
    if (pick.length >= 2 && same(total, target)) {
      out.push([...pick]);
      return;
    }
    if (pick.length >= maxSize) return;
    for (let i = from; i < list.length; i++) {
      pick.push(list[i]);
      walk(i + 1, total + val(list[i]));
      pick.pop();
    }
  };
  walk(0, 0);
  return out;
}

// ───────────── 繳卡費 ─────────────

/** 這期繳了多少：包含舊的單卡轉帳，以及銀行一筆扣款拆給多卡／多期的分配。 */
export function statementPaid(stmt: Pick<Statement, 'id' | 'account'>, txns: Txn[]): number {
  return txns.reduce((paid, t) => {
    if (t.direction !== '轉帳') return paid;
    if (t.statement === stmt.id && t.toAccount === stmt.account) paid += t.toAmount ?? t.amount ?? 0;
    paid += t.cardPayments.filter((x) => x.statement === stmt.id && x.account === stmt.account).reduce((n, x) => n + x.amount, 0);
    return paid;
  }, 0);
}

/** 這期繳清了沒（沒填應繳金額時：有繳就算） */
export function isStatementPaid(stmt: Statement, txns: Txn[]): boolean {
  const paid = statementPaid(stmt, txns);
  if (stmt.amountDue == null) return paid > 0;
  return stmt.amountDue <= 0 || paid >= stmt.amountDue - 0.005;
}

/** 還沒繳清的帳單（舊 → 新）；繳卡費時預設選第一個（2026-11-18 確認：最早沒繳的） */
export function unpaidStatements(snap: Pick<MoneySnapshot, 'statements' | 'txns'>, account: string): Statement[] {
  return snap.statements.filter((s) => s.account === account && !isStatementPaid(s, snap.txns));
}

export type CardStatus = '未出帳' | '已出帳未繳' | '已繳';

/** 信用卡每一筆的狀態：還沒在帳單上 → 未出帳；在帳單上 → 看那期繳了沒 */
export function cardTxnStatus(snap: Pick<MoneySnapshot, 'statements' | 'statementItems' | 'txns'>, t: Txn, account: string): CardStatus {
  const it = snap.statementItems.find((i) => i.account === account && i.matched.includes(t.id));
  const stmt = it && snap.statements.find((s) => s.account === account && s.closeDate === it.closeDate);
  if (!stmt) return '未出帳';
  return isStatementPaid(stmt, snap.txns) ? '已繳' : '已出帳未繳';
}

// ───────────── 補登 ─────────────

const normText = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

/** 帳單名稱 → 店家（2026-11-18 確認：配對過一次就記住；用最近一筆同樣帳單名稱的交易） */
export function storeForStatementText(txns: Txn[], text: string | null): string | null {
  if (!text) return null;
  const key = normText(text);
  return txns.find((t) => t.store && t.statementText && normText(t.statementText) === key)?.store ?? null;
}

/** 帳單有、記帳沒有 → 補登的表單（日期、金額、帳單名稱帶好；認得的帳單名稱帶入店家和上次的分類） */
export function itemToForm(snap: Pick<MoneySnapshot, 'txns'>, acc: Pick<Account, 'name' | 'type'>, item: StatementItem): EntryForm {
  const d = itemDate(item);
  // 信用卡：正 = 刷卡（支出）、負 = 退款（負的支出）；其他：負 = 支出、正 = 收入
  const income = acc.type !== '信用卡' && item.amount > 0;
  const amount = acc.type === '信用卡' ? item.amount : Math.abs(item.amount);
  const store = storeForStatementText(snap.txns, item.description);
  const kind = income ? '收入' : '支出';
  const category = store ? lastCategoryOfStore(snap.txns, store, kind) : null;
  return {
    ...emptyForm(kind, d ? startOfDay(d) + 12 * 3600000 : Date.now()),
    account: acc.name,
    store,
    statementText: item.description,
    cats: [{ category, amount }],
  };
}

// ───────────── 貼上帳單明細 ─────────────

export interface ParsedItem {
  date: string | null;
  postedDate: string | null;
  description: string | null;
  amount: number;
  origCurrency: string | null;
  origAmount: number | null;
}

const CURRENCIES = ['USD', 'JPY', 'EUR', 'GBP', 'KRW', 'CNY', 'HKD', 'SGD', 'AUD', 'CAD', 'THB', 'VND', 'MYR', 'NZD', 'CHF', 'PHP', 'IDR', 'TWD', 'NTD'];

/** 「115/11/03」「2026/11/03」「11/03」→ 'YYYY-MM-DD'（沒有年：用結帳日的年，比結帳日晚太多就是去年） */
export function parseStmtDate(s: string, closeDate: string): string | null {
  const t = s.trim();
  let y: number;
  let m: number;
  let d: number;
  let mt = /^(\d{2,4})[/.\-年](\d{1,2})[/.\-月](\d{1,2})日?$/.exec(t);
  if (mt) {
    y = Number(mt[1]);
    if (mt[1].length === 3) y += 1911;
    else if (mt[1].length === 2) y += 2000;
    m = Number(mt[2]);
    d = Number(mt[3]);
  } else if ((mt = /^(\d{1,2})[/.\-月](\d{1,2})日?$/.exec(t))) {
    m = Number(mt[1]);
    d = Number(mt[2]);
    y = Number(closeDate.slice(0, 4));
    const guess = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (guess > addDays(closeDate, 31)) y -= 1;
  } else return null;
  const date = new Date(y, m - 1, d);
  if (date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 金額文字：「1,280」「-320」「320-」「(320)」「NT$1,280」「−320」 */
export function parseStmtNumber(s: string): number | null {
  let t = s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[−－﹣‐]/g, '-')
    .replace(/^(NT\$|NTD|TWD|\$|＄)/i, '')
    .replace(/[,，\s]/g, '')
    .trim();
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?-$/.test(t)) {
    neg = !neg;
    t = t.slice(0, -1);
  }
  if (!/^[-+]?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return neg ? -n : n;
}

type Col = 'date' | 'posted' | 'desc' | 'amount' | 'out' | 'in' | 'skip' | 'origCur' | 'origAmt';

/** 從 Excel / 網頁複製的表格：看標題列決定每一欄是什麼 */
function headerColumns(cells: string[]): Col[] | null {
  const cols = cells.map((c): Col | null => {
    const h = c.replace(/\s/g, '');
    if (!h) return null;
    if (/入帳|記帳日/.test(h)) return 'posted';
    if (/餘額|結餘/.test(h)) return 'skip';
    if (/外幣|原幣/.test(h)) return /幣別/.test(h) ? 'origCur' : 'origAmt';
    if (/幣別/.test(h)) return 'origCur';
    if (/支出|提款|提出|扣款|轉出|付款金額/.test(h)) return 'out';
    if (/存入|存款|轉入|收入/.test(h)) return 'in';
    if (/金額|臺幣|台幣|NT/.test(h)) return 'amount';
    if (/日期|交易日|消費日|日$/.test(h)) return 'date';
    if (/摘要|說明|明細|商店|內容|名稱|備註|交易|特店/.test(h)) return 'desc';
    return null;
  });
  const known = cols.filter(Boolean);
  if (!known.includes('date') || !(known.includes('amount') || known.includes('out') || known.includes('in'))) return null;
  return cols.map((c) => c ?? 'skip');
}

/**
 * 解析貼上的帳單明細（2026-11-18 確認：在 APP 直接貼，從 Excel / 網頁 / PDF 複製幾列）。
 * - 有標題列（Excel / 網頁表格）：照標題決定欄位，支出 / 存入分兩欄也可以
 * - 沒有標題（PDF 複製）：前兩個日期 = 消費日、入帳日；說明後面的第一個數字 = 金額；幣別後面的數字 = 外幣金額
 * 沒有日期或金額的列（標題、小計）略過。
 */
export function parseStatementText(text: string, closeDate: string): { rows: ParsedItem[]; skipped: number } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const rows: ParsedItem[] = [];
  let skipped = 0;
  let cols: Col[] | null = null;
  for (const line of lines) {
    const tabbed = line.includes('\t');
    const cells = tabbed ? line.split('\t').map((c) => c.trim()) : line.trim().split(/\s+/);
    if (tabbed) {
      const h = headerColumns(cells);
      if (h) {
        cols = h;
        continue;
      }
    }
    const row = tabbed && cols ? byColumns(cells, cols, closeDate) : byTokens(cells, closeDate);
    if (row) rows.push(row);
    else skipped++;
  }
  return { rows, skipped };
}

function byColumns(cells: string[], cols: Col[], closeDate: string): ParsedItem | null {
  let date: string | null = null;
  let posted: string | null = null;
  const desc: string[] = [];
  let amount: number | null = null;
  let origCur: string | null = null;
  let origAmt: number | null = null;
  cols.forEach((c, i) => {
    const v = (cells[i] ?? '').trim();
    if (!v) return;
    const n = parseStmtNumber(v);
    if (c === 'date') date ??= parseStmtDate(v, closeDate);
    else if (c === 'posted') posted ??= parseStmtDate(v, closeDate);
    else if (c === 'desc') desc.push(v);
    else if (c === 'amount' && n != null) amount = (amount ?? 0) + n;
    else if (c === 'out' && n != null) amount = (amount ?? 0) - Math.abs(n);
    else if (c === 'in' && n != null) amount = (amount ?? 0) + Math.abs(n);
    else if (c === 'origCur') origCur = v.toUpperCase();
    else if (c === 'origAmt' && n != null) origAmt = n;
  });
  if (!(date || posted) || amount == null || amount === 0) return null;
  return { date: date ?? posted, postedDate: posted, description: desc.join(' ') || null, amount, origCurrency: origCur, origAmount: origAmt };
}

function byTokens(tokens: string[], closeDate: string): ParsedItem | null {
  const dates: string[] = [];
  const desc: string[] = [];
  let amount: number | null = null;
  let origCur: string | null = null;
  let origAmt: number | null = null;
  let afterCur = false;
  for (const tok of tokens) {
    const t = tok.trim();
    if (!t) continue;
    const d = parseStmtDate(t, closeDate);
    if (d) {
      // 外幣折算日之類的第三個日期不要
      if (dates.length < 2 && amount == null) dates.push(d);
      continue;
    }
    if (CURRENCIES.includes(t.toUpperCase()) && t.toUpperCase() !== 'TWD' && t.toUpperCase() !== 'NTD') {
      origCur = t.toUpperCase();
      afterCur = true;
      continue;
    }
    const n = parseStmtNumber(t);
    if (n != null) {
      if (afterCur && origAmt == null) {
        origAmt = n;
        afterCur = false;
      } else if (amount == null && (desc.length || dates.length)) amount = n;
      continue;
    }
    // 兩個英文字母的消費地（TW、JP）放在金額後面的不算說明
    if (amount != null && /^[A-Z]{2}$/.test(t)) continue;
    if (amount == null) desc.push(t);
  }
  if (!dates.length || amount == null || amount === 0) return null;
  return { date: dates[0], postedDate: dates[1] ?? null, description: desc.join(' ') || null, amount, origCurrency: origCur, origAmount: origAmt };
}

// ───────────── 月底盤點 ─────────────

/**
 * 盤點提醒的期間（2026-11-18 確認）：每月最後一天開始，到盤點完或下個月 10 號。
 * 回傳那個月、期間（from = 月底，to = 下個月 10 號）；不在期間 → null
 */
export function stocktakeWindow(today: string): { month: string; from: string; to: string } | null {
  const end = monthEnd(today);
  if (today === end) return { month: today.slice(0, 7), from: end, to: `${addDays(end, 1).slice(0, 7)}-10` };
  if (Number(today.slice(8)) <= 10) {
    const prevEnd = addDays(`${today.slice(0, 7)}-01`, -1);
    return { month: prevEnd.slice(0, 7), from: prevEnd, to: `${today.slice(0, 7)}-10` };
  }
  return null;
}

/** 每月要盤點的帳戶（沒停用、設定要盤點） */
export const stocktakeAccounts = (accounts: Account[]) => accounts.filter((a) => !a.archived && a.monthlyCheck);

/** 這個月的盤點狀態；不在提醒期間 → null */
export function stocktakeStatus(snap: Pick<MoneySnapshot, 'accounts' | 'balanceChecks'>, today: string) {
  const w = stocktakeWindow(today);
  if (!w) return null;
  const list = stocktakeAccounts(snap.accounts);
  const done = (a: Account) => snap.balanceChecks.some((c) => c.account === a.name && c.date >= w.from && c.date <= w.to);
  return { ...w, pending: list.filter((a) => !done(a)), done: list.filter(done) };
}

/** 顯示用的帳上餘額：信用卡是未繳金額（正數 = 欠款） */
export function bookBalance(acc: Account, txns: Txn[], date: string): number | null {
  const bal = accountBalance(acc, txns, date);
  if (bal == null) return null;
  return acc.type === '信用卡' ? roundMoney(-bal, acc.currency) : bal;
}

/** 盤點的差額：原本差多少（盤點當時）、現在差多少（補登之後重算） */
export function checkDiff(acc: Account, c: BalanceCheck, txns: Txn[]): { original: number | null; now: number | null } {
  const book = bookBalance(acc, txns, c.date);
  return {
    original: c.bookSnapshot == null ? null : roundMoney(c.actual - c.bookSnapshot, acc.currency),
    now: book == null ? null : roundMoney(c.actual - book, acc.currency),
  };
}
