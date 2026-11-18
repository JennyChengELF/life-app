/**
 * 記帳 APP 的資料存取與規則。資料存在「生活APP-記帳」，人物、機構在「生活APP-綜合」。
 * 規則見 規劃.md 記帳段落、docs/資料庫.md（2026-11-18 確認）：
 * - 交易＝一次付款 / 收款 / 轉帳；明細＝支出、收入、他欠我⋯⋯（統計看明細，對帳看交易）
 * - 金額一律正數，出 / 入另一欄；參照其他表存名稱（改名時一起改）
 * - 選項直接存中文（和排便 APP 一樣，試算表上看得懂）
 */
import type { Backend, RowUpdate, RowValues, TableRow } from './backend';
import { newId } from './ids';
import type { TableName } from './schema';
import { toDateKey } from './time';

// ───────────── 選項 ─────────────

export const ACCOUNT_TYPES = ['現金', '銀行', '定存', '信用卡', '電子支付', '儲值卡', '禮券'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const DIRECTIONS = ['出', '入', '轉帳'] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const LINE_KINDS = ['支出', '收入', '他欠我', '我欠他', '他還我', '我還他', '調整'] as const;
export type LineKind = (typeof LINE_KINDS)[number];
export const DEBT_TYPES = ['分帳', '借款'] as const;
export type DebtType = (typeof DEBT_TYPES)[number];
export const CATEGORY_KINDS = ['支出', '收入'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];
/** 和人物有關的明細 */
export const PERSON_KINDS: LineKind[] = ['他欠我', '我欠他', '他還我', '我還他'];
/** 機構類別（2026-11-18 確認） */
export const ORG_KINDS = ['商店', '餐飲', '銀行', '證券', '保險', '電子支付', '醫療', '公司', '政府', '其他'] as const;

/** 💡 第一次使用時放的預設分類（之後可匯入舊試算表的分類、自己改） */
export const DEFAULT_CATEGORIES: { path: string; kind: CategoryKind }[] = [
  { path: '食', kind: '支出' },
  { path: '食 / 三餐', kind: '支出' },
  { path: '食 / 飲料點心', kind: '支出' },
  { path: '食 / 食材', kind: '支出' },
  { path: '衣', kind: '支出' },
  { path: '住', kind: '支出' },
  { path: '住 / 日用品', kind: '支出' },
  { path: '住 / 水電瓦斯', kind: '支出' },
  { path: '行', kind: '支出' },
  { path: '行 / 大眾交通', kind: '支出' },
  { path: '行 / 計程車', kind: '支出' },
  { path: '育', kind: '支出' },
  { path: '育 / 學習', kind: '支出' },
  { path: '樂', kind: '支出' },
  { path: '樂 / 娛樂', kind: '支出' },
  { path: '醫療', kind: '支出' },
  { path: '人情', kind: '支出' },
  { path: '人情 / 送禮', kind: '支出' },
  { path: '其他支出', kind: '支出' },
  { path: '薪資', kind: '收入' },
  { path: '獎金', kind: '收入' },
  { path: '利息', kind: '收入' },
  { path: '其他收入', kind: '收入' },
];

// ───────────── 型別 ─────────────

interface RowRef {
  rowNumber: number;
  id: string;
}

export interface Account extends RowRef {
  name: string;
  type: AccountType;
  currency: string;
  org: string | null;
  openingDate: string | null;
  openingBalance: number | null;
  closingDay: number | null;
  dueDay: number | null;
  /** 信用卡國外交易手續費率 %（例 1.5；空白 = 預設 1.5） */
  fxFeeRate: number | null;
  expiryDate: string | null;
  monthlyCheck: boolean;
  archived: boolean;
  sort: number | null;
  note: string | null;
}

export interface Category extends RowRef {
  path: string;
  kind: CategoryKind;
  isInvest: boolean;
  defaultBudget: string | null;
  systemKey: string | null;
  archived: boolean;
  sort: number | null;
}

export interface Person extends RowRef {
  name: string;
  isSelf: boolean;
  archived: boolean;
  sort: number | null;
  note: string | null;
}

export interface Org extends RowRef {
  name: string;
  kind: string | null;
  /** 國外的店家 / 機構 */
  foreign: boolean;
  archived: boolean;
  sort: number | null;
  note: string | null;
}

export interface LineInput {
  kind: LineKind;
  amount: number;
  category?: string | null;
  person?: string | null;
  debtType?: DebtType | null;
  budget?: string | null;
  note?: string | null;
}

export interface Line extends RowRef, Required<LineInput> {
  transaction: string;
  sort: number | null;
}

export interface TxnInput {
  time: number;
  direction: Direction | null;
  account: string | null;
  amount: number | null;
  paidBy: string | null;
  /** 只有沒帳戶時才用（有帳戶時看帳戶的幣別） */
  currency: string | null;
  toAccount: string | null;
  toAmount: number | null;
  /** 店家 / 對象（機構名稱） */
  store: string | null;
  branch: string | null;
  /** 帳單上印的文字（對帳用） */
  statementText: string | null;
  note: string | null;
  tags: string[];
  lines: LineInput[];
}

export interface Txn extends RowRef, Omit<TxnInput, 'lines'> {
  date: string;
  createdVia: string | null;
  lines: Line[];
}

export interface MoneyIssue {
  table: TableName;
  rowNumber: number;
  id: string | null;
  raw: Record<string, unknown>;
  problems: string[];
}

export interface MoneySnapshot {
  loadedAt: number;
  accounts: Account[];
  categories: Category[];
  people: Person[];
  orgs: Org[];
  /** 新 → 舊 */
  txns: Txn[];
  issues: MoneyIssue[];
}

// ───────────── 金額、幣別 ─────────────

/** 沒有小數的幣別 */
const NO_DECIMAL = ['TWD', 'JPY', 'KRW', 'VND', 'IDR'];
export const currencyDigits = (c: string) => (NO_DECIMAL.includes(c.toUpperCase()) ? 0 : 2);
export const roundMoney = (n: number, currency = 'TWD') => {
  const f = 10 ** currencyDigits(currency);
  return Math.round(n * f) / f;
};
const SYMBOL: Record<string, string> = { TWD: 'NT$', USD: 'US$', JPY: '¥', KRW: '₩', EUR: '€', CNY: 'CN¥', HKD: 'HK$', GBP: '£' };

/** 1280 → 「NT$ 1,280」；12.9 USD →「US$ 12.90」 */
export function fmtMoney(n: number, currency = 'TWD', withSymbol = true): string {
  const d = currencyDigits(currency);
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sign = n < 0 ? '−' : '';
  if (!withSymbol) return sign + s;
  return `${sign}${SYMBOL[currency.toUpperCase()] ?? currency.toUpperCase()} ${s}`;
}

/** 金額相等（容許小數誤差） */
const same = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * 平分（2026-11-18 確認）：每份取到幣別的最小單位，除不盡的零頭由付錢的人負擔。
 * n：人數（含付錢的人）；payer：付錢的人在第幾個
 */
export function splitEven(total: number, n: number, payer: number, currency = 'TWD'): number[] {
  if (n <= 0) return [];
  const f = 10 ** currencyDigits(currency);
  const units = Math.round(total * f);
  const base = Math.floor(units / n);
  const shares = Array.from({ length: n }, () => base);
  shares[Math.min(Math.max(payer, 0), n - 1)] += units - base * n;
  return shares.map((s) => s / f);
}

// ───────────── 讀取時的整理 ─────────────

const str = (v: unknown) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isLive = (r: TableRow) => !r.empty && r.values.deletedAt == null;
const has = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** 分類：統一成「a / b / c」 */
export function normPath(s: string): string {
  return s
    .split('/')
    .map((x) => x.trim())
    .filter(Boolean)
    .join(' / ');
}
export const topCategory = (path: string) => path.split(' / ')[0];

/**
 * 分類最多幾層（2026-11-18 確認三層）。程式都照「任意層數」寫，要第四層只要改這個數字。
 */
export const MAX_CATEGORY_DEPTH = 3;
export const pathDepth = (path: string) => path.split(' / ').length;
/** 上一層（主分類 → null） */
export const parentPath = (path: string): string | null => {
  const i = path.lastIndexOf(' / ');
  return i < 0 ? null : path.slice(0, i);
};
export const lastName = (path: string) => path.split(' / ').pop()!;
/** 「食 / 三餐 / 早餐」→ [食, 食 / 三餐] */
export function ancestorPaths(path: string): string[] {
  const parts = path.split(' / ');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join(' / '));
}

export function checkCategoryName(name: string): string {
  const n = name.trim();
  if (!n) throw new Error('請填分類名稱');
  if (n.includes('/')) throw new Error('分類名稱不能有「/」（要加下一層請用「＋子分類」）');
  return n;
}

export interface CategoryNode {
  cat: Category;
  name: string;
  depth: number;
  children: CategoryNode[];
  /** 自己或上層停用 */
  hidden: boolean;
}

/** 依支出 / 收入排成樹（同一層照排序） */
export function categoryTree(categories: Category[], kind: CategoryKind): CategoryNode[] {
  const list = categories.filter((c) => c.kind === kind).sort(bySort);
  const build = (parent: string | null, parentHidden: boolean): CategoryNode[] =>
    list
      .filter((c) => parentPath(c.path) === parent)
      .map((c) => {
        const hidden = parentHidden || c.archived;
        return { cat: c, name: lastName(c.path), depth: pathDepth(c.path), hidden, children: build(c.path, hidden) };
      });
  return build(null, false);
}

/** 最近用過的店家（新 → 舊，不重複） */
export function recentStores(txns: Txn[], n = 8): string[] {
  const out: string[] = [];
  for (const t of txns) {
    if (t.store && !out.includes(t.store)) out.push(t.store);
    if (out.length >= n) break;
  }
  return out;
}

/** 這家店上次用的分類（2026-11-18 確認：選店家後自動帶入，可改） */
export function lastCategoryOfStore(txns: Txn[], store: string, kind: CategoryKind): string | null {
  for (const t of txns) {
    if (t.store !== store) continue;
    const l = t.lines.find((x) => x.kind === kind && x.category);
    if (l) return l.category;
  }
  return null;
}

/** 最近用過的分類（新 → 舊，不重複） */
export function recentCategories(txns: Txn[], kind: CategoryKind, n = 5): string[] {
  const out: string[] = [];
  for (const t of txns) {
    for (const l of t.lines) {
      if (l.kind === kind && l.category && !out.includes(l.category)) out.push(l.category);
      if (out.length >= n) return out;
    }
  }
  return out;
}

export function splitTags(v: unknown): string[] {
  const s = str(v);
  if (!s) return [];
  return [...new Set(s.split(/[、,，;；]+/).map((x) => x.trim().replace(/^#/, '')).filter(Boolean))];
}

const bySort = <T extends { sort: number | null; rowNumber: number }>(a: T, b: T) =>
  (a.sort ?? 1e9) - (b.sort ?? 1e9) || a.rowNumber - b.rowNumber;

function toAccount(r: TableRow): Account {
  const v = r.values;
  return {
    rowNumber: r.rowNumber,
    id: String(v.id ?? ''),
    name: str(v.name)!,
    type: str(v.type) as AccountType,
    currency: (str(v.currency) ?? 'TWD').toUpperCase(),
    org: str(v.org),
    openingDate: str(v.openingDate),
    openingBalance: num(v.openingBalance),
    closingDay: num(v.closingDay),
    dueDay: num(v.dueDay),
    fxFeeRate: num(v.fxFeeRate),
    expiryDate: str(v.expiryDate),
    monthlyCheck: v.monthlyCheck !== false,
    archived: v.archived === true,
    sort: num(v.sort),
    note: str(v.note),
  };
}

function toCategory(r: TableRow): Category {
  const v = r.values;
  return {
    rowNumber: r.rowNumber,
    id: String(v.id ?? ''),
    path: normPath(String(v.path)),
    kind: str(v.kind) as CategoryKind,
    isInvest: v.isInvest === true,
    defaultBudget: str(v.defaultBudget),
    systemKey: str(v.systemKey),
    archived: v.archived === true,
    sort: num(v.sort),
  };
}

function toPerson(r: TableRow): Person {
  const v = r.values;
  return {
    rowNumber: r.rowNumber,
    id: String(v.id ?? ''),
    name: str(v.name)!,
    isSelf: v.isSelf === true,
    archived: v.archived === true,
    sort: num(v.sort),
    note: str(v.note),
  };
}

function toOrg(r: TableRow): Org {
  const v = r.values;
  return {
    rowNumber: r.rowNumber,
    id: String(v.id ?? ''),
    name: str(v.name)!,
    kind: str(v.kind),
    foreign: v.foreign === true,
    archived: v.archived === true,
    sort: num(v.sort),
    note: str(v.note),
  };
}

function toLine(r: TableRow): Line {
  const v = r.values;
  const cat = str(v.category);
  return {
    rowNumber: r.rowNumber,
    id: String(v.id ?? ''),
    transaction: str(v.transaction)!,
    kind: str(v.kind) as LineKind,
    amount: num(v.amount)!,
    category: cat ? normPath(cat) : null,
    person: str(v.person),
    debtType: (str(v.debtType) as DebtType | null) ?? null,
    budget: str(v.budget),
    note: str(v.note),
    sort: num(v.sort),
  };
}

function toTxn(r: TableRow, lines: Line[]): Txn {
  const v = r.values;
  return {
    rowNumber: r.rowNumber,
    id: String(v.id),
    time: Number(v.time),
    date: toDateKey(Number(v.time)),
    direction: (str(v.direction) as Direction | null) ?? null,
    account: str(v.account),
    amount: num(v.amount),
    paidBy: str(v.paidBy),
    currency: str(v.currency)?.toUpperCase() ?? null,
    toAccount: str(v.toAccount),
    toAmount: num(v.toAmount),
    store: str(v.store),
    branch: str(v.branch),
    statementText: str(v.statementText),
    note: str(v.note),
    tags: splitTags(v.tags),
    createdVia: str(v.createdVia),
    lines,
  };
}

/** 檢查用的參照資料 */
export interface MoneyRefs {
  accounts: Pick<Account, 'name' | 'currency'>[];
  categories: Pick<Category, 'path' | 'kind'>[];
  people: Pick<Person, 'name'>[];
}

/** 這筆交易的幣別：有帳戶看帳戶，沒帳戶看交易自己填的（空白 = TWD） */
export function txnCurrency(t: Pick<TxnInput, 'account' | 'currency'>, accounts: Pick<Account, 'name' | 'currency'>[]): string {
  const a = t.account ? accounts.find((x) => x.name === t.account) : null;
  return a?.currency ?? t.currency ?? 'TWD';
}

/**
 * 明細加總要對得上交易金額（金額都是正數）：
 * 淨出＝支出＋他欠我＋我還他 −（收入＋我欠他＋他還我）
 * 出：淨出＋調整＝金額；入：−淨出＋調整＝金額；沒帳戶：淨出＝0
 */
export function lineBalance(lines: Pick<LineInput, 'kind' | 'amount'>[]) {
  let out = 0;
  let adjust = 0;
  for (const l of lines) {
    if (l.kind === '支出' || l.kind === '他欠我' || l.kind === '我還他') out += l.amount;
    else if (l.kind === '收入' || l.kind === '我欠他' || l.kind === '他還我') out -= l.amount;
    else adjust += l.amount;
  }
  return { out, adjust };
}

/** 檢查一筆交易（含明細）；回傳問題（中文），空陣列 = 沒問題 */
export function checkTxn(t: Omit<TxnInput, 'tags'> & { tags?: string[] }, refs: MoneyRefs): string[] {
  const p: string[] = [];
  if (!Number.isFinite(t.time)) p.push('沒有填時間');
  const accName = (n: string | null) => n != null && refs.accounts.some((a) => a.name === n);
  const cur = txnCurrency(t, refs.accounts);
  const intOk = (n: number) => currencyDigits(cur) > 0 || Number.isInteger(n);

  if (t.direction) {
    if (!t.account) p.push('沒有填帳戶');
    else if (!accName(t.account)) p.push(`帳戶「${t.account}」不在帳戶清單裡`);
    if (t.amount == null || !(t.amount > 0)) p.push('金額請填大於 0 的數字');
    else if (!intOk(t.amount)) p.push(`${cur} 金額請填整數`);
    if (t.paidBy) p.push('朋友先幫我付（paidBy）時不能有帳戶和出 / 入');
  } else {
    if (t.account) p.push('有帳戶時請填 direction（出、入、轉帳）');
    if (t.amount != null) p.push('沒帳戶時金額請空白（金額看明細）');
  }
  if (t.paidBy && !refs.people.some((x) => x.name === t.paidBy)) p.push(`人物「${t.paidBy}」不在人物清單裡`);

  if (t.direction === '轉帳') {
    if (!t.toAccount) p.push('轉帳請填轉入的帳戶（toAccount）');
    else if (!accName(t.toAccount)) p.push(`帳戶「${t.toAccount}」不在帳戶清單裡`);
    else if (t.toAccount === t.account) p.push('轉出和轉入不能是同一個帳戶');
    if (t.toAmount != null && !(t.toAmount > 0)) p.push('轉入金額請填大於 0 的數字');
    const from = refs.accounts.find((a) => a.name === t.account);
    const to = refs.accounts.find((a) => a.name === t.toAccount);
    if (from && to && from.currency !== to.currency && t.toAmount == null) p.push(`不同幣別（${from.currency} → ${to.currency}）請填轉入金額`);
    if (t.lines.length) p.push('轉帳不能有明細');
    return p;
  }
  if (t.toAccount || t.toAmount != null) p.push('只有轉帳才填轉入帳戶 / 轉入金額');

  if (!t.lines.length) {
    p.push('沒有明細（請在 APP 裡記，或在 moneyLines 加明細）');
    return p;
  }
  t.lines.forEach((l, i) => {
    const at = t.lines.length > 1 ? `第 ${i + 1} 筆明細：` : '明細：';
    if (!has(LINE_KINDS, l.kind)) {
      p.push(`${at}種類「${l.kind ?? ''}」看不懂（請填：${LINE_KINDS.join('、')}）`);
      return;
    }
    // 支出、收入可以是負數（退款、折扣，2026-11-18 使用者決定）；其他明細一律正數
    const signed = l.kind === '支出' || l.kind === '收入';
    if (!Number.isFinite(l.amount) || (signed ? l.amount === 0 : !(l.amount > 0))) p.push(`${at}金額請填${signed ? '不是 0 的數字（負數 = 退款、折扣）' : '大於 0 的數字'}`);
    else if (!intOk(l.amount)) p.push(`${at}${cur} 金額請填整數`);
    if (l.kind === '支出' || l.kind === '收入') {
      const c = l.category ? refs.categories.find((x) => x.path === normPath(l.category!)) : null;
      if (!l.category) p.push(`${at}請選分類`);
      else if (!c) p.push(`${at}分類「${l.category}」不在分類清單裡`);
      else if (c.kind !== l.kind) p.push(`${at}分類「${l.category}」是${c.kind}分類`);
    }
    if (PERSON_KINDS.includes(l.kind)) {
      if (!l.person) p.push(`${at}請選人物`);
      else if (!refs.people.some((x) => x.name === l.person)) p.push(`${at}人物「${l.person}」不在人物清單裡`);
    }
    if ((l.kind === '他欠我' || l.kind === '我欠他') && l.debtType && !has(DEBT_TYPES, l.debtType)) p.push(`${at}請填分帳或借款`);
    if (l.kind === '調整' && !t.direction) p.push(`${at}調整一定要有帳戶`);
  });
  if (p.length) return p;

  const { out, adjust } = lineBalance(t.lines);
  const amt = t.amount ?? 0;
  if (t.direction === '出' && !same(out + adjust, amt)) p.push(`明細加總 ${fmtMoney(out + adjust, cur, false)} 和交易金額 ${fmtMoney(amt, cur, false)} 對不上`);
  if (t.direction === '入' && !same(-out + adjust, amt)) p.push(`明細加總 ${fmtMoney(-out + adjust, cur, false)} 和交易金額 ${fmtMoney(amt, cur, false)} 對不上`);
  if (!t.direction && !same(out, 0)) p.push('沒帳戶的交易：支出＋他欠我＋我還他 要等於 收入＋我欠他＋他還我');
  return p;
}

function checkSimple(r: TableRow, need: string, label: string, names: Set<string>, extra?: (r: TableRow) => string[]): string[] {
  const p: string[] = [];
  const name = str(r.values[need]);
  if (!name) p.push(`沒有填${label}`);
  else if (names.has(need === 'path' ? normPath(name) : name)) p.push(`${label}「${name}」重複了`);
  if (extra) p.push(...extra(r));
  return p;
}

// ───────────── 計算 ─────────────

/** 錢的方向：帳戶的錢 +多 / −少 */
function accountDelta(t: Txn, name: string): number {
  let d = 0;
  if (t.account === name && t.amount != null) d += t.direction === '入' ? t.amount : -t.amount;
  if (t.direction === '轉帳' && t.toAccount === name) d += t.toAmount ?? t.amount ?? 0;
  return d;
}

/**
 * 帳戶餘額（2026-11-18 確認：沒填期初餘額就不顯示）。
 * 回傳帳戶的錢（信用卡是負數 = 欠款）；期初餘額是那天結束時的餘額，之後的交易才算進去。
 */
export function accountBalance(acc: Account, txns: Txn[], upTo?: string): number | null {
  if (!acc.openingDate || acc.openingBalance == null) return null;
  let bal = acc.type === '信用卡' ? -acc.openingBalance : acc.openingBalance;
  for (const t of txns) {
    if (t.date <= acc.openingDate) continue;
    if (upTo && t.date > upTo) continue;
    bal += accountDelta(t, acc.name);
  }
  return roundMoney(bal, acc.currency);
}

export interface PersonBalance {
  person: string;
  currency: string;
  /** 正 = 他欠我；負 = 我欠他 */
  net: number;
  /** 分帳代墊、借款各自的部分（還款依序先抵借款以外的不分；只是方便看） */
  split: number;
  loan: number;
}

/**
 * 每個人的淨額（2026-11-18 確認：分帳和借款合在一起，依幣別分開）。
 * 淨額＝他欠我＋我還他 − 我欠他 − 他還我
 */
export function personBalances(txns: Txn[], accounts: Pick<Account, 'name' | 'currency'>[]): PersonBalance[] {
  const map = new Map<string, PersonBalance>();
  for (const t of txns) {
    const cur = txnCurrency(t, accounts);
    for (const l of t.lines) {
      if (!l.person || !PERSON_KINDS.includes(l.kind)) continue;
      const key = `${l.person}\u0000${cur}`;
      const b = map.get(key) ?? { person: l.person, currency: cur, net: 0, split: 0, loan: 0 };
      const sign = l.kind === '他欠我' || l.kind === '我還他' ? 1 : -1;
      b.net += sign * l.amount;
      if (l.kind === '他欠我' || l.kind === '我欠他') {
        if (l.debtType === '借款') b.loan += sign * l.amount;
        else b.split += sign * l.amount;
      }
      map.set(key, b);
    }
  }
  return [...map.values()].map((b) => ({ ...b, net: roundMoney(b.net, b.currency), split: roundMoney(b.split, b.currency), loan: roundMoney(b.loan, b.currency) }));
}

export interface MonthStats {
  currency: string;
  income: number;
  expense: number;
  /** 實際＝扣掉投資類（2026-11-18 確認：兩組都顯示） */
  realIncome: number;
  realExpense: number;
  /** 第一層分類的支出（大 → 小） */
  expenseByTop: { name: string; amount: number }[];
  incomeByTop: { name: string; amount: number }[];
  /** 每個分類（完整路徑）的金額，展開子分類用（categoryBreakdown） */
  expenseByPath: Map<string, number>;
  incomeByPath: Map<string, number>;
}

export interface BreakdownItem {
  name: string;
  path: string;
  amount: number;
  /** 佔上一層（或總額）的比例 0–1 */
  share: number;
  /** 底下還有分類 */
  hasChildren: boolean;
}

/**
 * 分類佔比（2026-11-18）：某一層（parent = null 是主分類）底下每個分類的金額和佔比。
 * 直接記在上層的（例：只選到「食」）顯示成「（食 本身）」。
 */
export function categoryBreakdown(byPath: Map<string, number>, parent: string | null): BreakdownItem[] {
  const depth = parent ? pathDepth(parent) : 0;
  const m = new Map<string, { amount: number; deeper: boolean }>();
  let own = 0;
  for (const [path, amount] of byPath) {
    if (parent && path !== parent && !path.startsWith(`${parent} / `)) continue;
    if (parent && path === parent) {
      own += amount;
      continue;
    }
    const parts = path.split(' / ');
    const key = parts.slice(0, depth + 1).join(' / ');
    const x = m.get(key) ?? { amount: 0, deeper: false };
    x.amount += amount;
    if (parts.length > depth + 1) x.deeper = true;
    m.set(key, x);
  }
  const total = [...m.values()].reduce((a, x) => a + x.amount, own);
  const items: BreakdownItem[] = [...m].map(([path, x]) => ({ name: lastName(path), path, amount: x.amount, share: total ? x.amount / total : 0, hasChildren: x.deeper }));
  if (own) items.push({ name: `（${lastName(parent!)} 本身）`, path: parent!, amount: own, share: total ? own / total : 0, hasChildren: false });
  return items.sort((a, b) => b.amount - a.amount);
}

/** 一年 12 個月的收支（新台幣；外幣還沒換算不算進來） */
export function monthlyTotals(txns: Txn[], categories: Pick<Category, 'path' | 'isInvest'>[], accounts: Pick<Account, 'name' | 'currency'>[], year: string) {
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}`;
    const s = monthStats(txns, categories, accounts, month).find((x) => x.currency === 'TWD');
    return { month, expense: s?.expense ?? 0, income: s?.income ?? 0, realExpense: s?.realExpense ?? 0, realIncome: s?.realIncome ?? 0 };
  });
}

/** 某個月（'YYYY-MM'）或某一年（'YYYY'）、某一天（'YYYY-MM-DD'）的收支，依幣別分開（外幣換算新台幣之後再做） */
export function monthStats(txns: Txn[], categories: Pick<Category, 'path' | 'isInvest'>[], accounts: Pick<Account, 'name' | 'currency'>[], month: string): MonthStats[] {
  const invest = new Set(categories.filter((c) => c.isInvest).map((c) => c.path));
  const by = new Map<string, MonthStats & { _e: Map<string, number>; _i: Map<string, number> }>();
  for (const t of txns) {
    if (!t.date.startsWith(month)) continue;
    const cur = txnCurrency(t, accounts);
    for (const l of t.lines) {
      if (l.kind !== '支出' && l.kind !== '收入') continue;
      const s = by.get(cur) ?? { currency: cur, income: 0, expense: 0, realIncome: 0, realExpense: 0, expenseByTop: [], incomeByTop: [], expenseByPath: new Map(), incomeByPath: new Map(), _e: new Map(), _i: new Map() };
      const real = !invest.has(l.category ?? '');
      const top = topCategory(l.category ?? '（沒有分類）');
      if (l.kind === '支出') {
        s.expense += l.amount;
        if (real) s.realExpense += l.amount;
        s._e.set(top, (s._e.get(top) ?? 0) + l.amount);
        if (l.category) s.expenseByPath.set(l.category, (s.expenseByPath.get(l.category) ?? 0) + l.amount);
      } else {
        s.income += l.amount;
        if (real) s.realIncome += l.amount;
        s._i.set(top, (s._i.get(top) ?? 0) + l.amount);
        if (l.category) s.incomeByPath.set(l.category, (s.incomeByPath.get(l.category) ?? 0) + l.amount);
      }
      by.set(cur, s);
    }
  }
  const list = (m: Map<string, number>) => [...m].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  return [...by.values()]
    .map(({ _e, _i, ...s }) => ({ ...s, expenseByTop: list(_e), incomeByTop: list(_i) }))
    .sort((a, b) => (a.currency === 'TWD' ? -1 : b.currency === 'TWD' ? 1 : a.currency.localeCompare(b.currency)));
}

// ───────────── 畫面的表單 ↔ 交易 ─────────────

/** 記帳畫面的種類 */
export const ENTRY_MODES = ['支出', '收入', '轉帳', '借款', '還款'] as const;
export type EntryMode = (typeof ENTRY_MODES)[number] | '不用還了' | '調整' | '其他';

export interface EntryForm {
  mode: EntryMode;
  time: number;
  /** 支出 / 收入 / 借款 / 還款的帳戶；轉帳的轉出帳戶 */
  account: string | null;
  /** 支出：朋友先幫我付（有值時沒有帳戶） */
  paidBy: string | null;
  /** 沒帳戶時的幣別 */
  currency: string | null;
  /** 我的部分：分類＋金額（支出 / 收入可拆成好幾筆） */
  cats: { category: string | null; amount: number | null; note?: string | null }[];
  /** 分帳：別人的份額（我付錢時 = 他欠我） */
  shares: { person: string | null; amount: number | null }[];
  /** 借款、還款、不用還了的對象 */
  person: string | null;
  /** 借款：借出（他欠我）/ 借入（我欠他）；還款：他還我 / 我還他；不用還了：他欠我的不收了 / 我欠他的不用還了 */
  sub: '借出' | '借入' | '他還我' | '我還他' | null;
  /** 借款、還款、轉帳的金額 */
  amount: number | null;
  toAccount: string | null;
  toAmount: number | null;
  store: string | null;
  branch: string | null;
  statementText: string | null;
  note: string | null;
  tags: string[];
}

export const emptyForm = (mode: EntryForm['mode'] = '支出', time = Date.now()): EntryForm => ({
  mode,
  time,
  account: null,
  paidBy: null,
  currency: null,
  cats: [{ category: null, amount: null }],
  shares: [],
  person: null,
  sub: mode === '借款' ? '借出' : mode === '還款' ? '他還我' : null,
  amount: null,
  toAccount: null,
  toAmount: null,
  store: null,
  branch: null,
  statementText: null,
  note: null,
  tags: [],
});

const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

/** 支出畫面的總額＝我的部分＋別人的份額 */
export const formTotal = (f: EntryForm) => sum(f.cats.map((c) => c.amount)) + (f.paidBy ? 0 : sum(f.shares.map((s) => s.amount)));

/** 表單 → 要存的交易（不檢查；存之前用 checkTxn 檢查） */
export function formToTxn(f: EntryForm): TxnInput {
  const base = { time: f.time, store: f.store?.trim() || null, branch: f.store?.trim() ? f.branch?.trim() || null : null, statementText: f.statementText?.trim() || null, note: f.note?.trim() || null, tags: f.tags, toAccount: null, toAmount: null, paidBy: null, currency: null };
  const cats = (kind: '支出' | '收入'): LineInput[] =>
    f.cats.filter((c) => c.category || c.amount).map((c) => ({ kind, amount: c.amount ?? 0, category: c.category, note: c.note ?? null }));
  switch (f.mode) {
    case '支出': {
      if (f.paidBy) {
        const mine = cats('支出');
        return {
          ...base,
          direction: null,
          account: null,
          amount: null,
          paidBy: f.paidBy,
          currency: f.currency,
          lines: [...mine, { kind: '我欠他', amount: sum(mine.map((l) => l.amount)), person: f.paidBy, debtType: '分帳' }],
        };
      }
      const shares: LineInput[] = f.shares.filter((s) => s.person || s.amount).map((s) => ({ kind: '他欠我', amount: s.amount ?? 0, person: s.person, debtType: '分帳' }));
      // 加總是負的（退款）→ 錢回到帳戶
      const total = formTotal(f);
      return { ...base, direction: total < 0 ? '入' : '出', account: f.account, amount: Math.abs(total), lines: [...cats('支出'), ...shares] };
    }
    case '收入':
    {
      const total = sum(f.cats.map((c) => c.amount));
      return { ...base, direction: total < 0 ? '出' : '入', account: f.account, amount: Math.abs(total), lines: cats('收入') };
    }
    case '轉帳':
      return { ...base, direction: '轉帳', account: f.account, amount: f.amount, toAccount: f.toAccount, toAmount: f.toAmount, lines: [] };
    case '借款': {
      const out = f.sub !== '借入';
      return {
        ...base,
        direction: out ? '出' : '入',
        account: f.account,
        amount: f.amount,
        lines: [{ kind: out ? '他欠我' : '我欠他', amount: f.amount ?? 0, person: f.person, debtType: '借款' }],
      };
    }
    case '還款': {
      const toMe = f.sub !== '我還他';
      return {
        ...base,
        direction: toMe ? '入' : '出',
        account: f.account,
        amount: f.amount,
        lines: [{ kind: toMe ? '他還我' : '我還他', amount: f.amount ?? 0, person: f.person }],
      };
    }
    case '不用還了': {
      // 他欠我的不收了 → 支出＋他還我；我欠他的不用還 → 收入＋我還他
      const heOwes = f.sub !== '我還他';
      const amount = f.amount ?? 0;
      return {
        ...base,
        direction: null,
        account: null,
        amount: null,
        currency: f.currency,
        lines: [
          { kind: heOwes ? '支出' : '收入', amount, category: f.cats[0]?.category ?? null },
          { kind: heOwes ? '他還我' : '我還他', amount, person: f.person },
        ],
      };
    }
    default:
      throw new Error('這種交易請到試算表修改');
  }
}

/**
 * 國外交易手續費（2026-11-18 確認）：另外記一筆交易，預算、標籤跟著消費，店家記發卡銀行。
 * 分類照使用者在 Notion 的記法：消費分類底下的「國外交易手續費」（見 feeCategoryOf）。
 * 金額依「我的部分」各分類比例分（四捨五入，零頭給最後一筆）；對到同一個手續費分類的合併。
 */
export function feeTxnFrom(purchase: TxnInput, fee: number, bank: string | null): TxnInput {
  const mine = purchase.lines.filter((l) => l.kind === '支出' && l.amount > 0);
  const total = sum(mine.map((l) => l.amount));
  let left = fee;
  const lines: LineInput[] = mine.map((l, i) => {
    const a = i === mine.length - 1 ? left : Math.round((fee * l.amount) / total);
    left -= a;
    return { kind: '支出' as const, amount: a, category: l.category ? feeCategoryOf(l.category) : null, budget: l.budget ?? null, note: null };
  });
  const merged: LineInput[] = [];
  for (const l of lines) {
    const m = merged.find((x) => x.category === l.category && x.budget === l.budget);
    if (m) m.amount += l.amount;
    else if (l.amount > 0) merged.push(l);
  }
  const final = merged.filter((l) => l.amount > 0);
  return {
    ...purchase,
    direction: '出',
    amount: fee,
    store: bank,
    branch: null,
    statementText: null,
    note: [purchase.store, '國外交易服務費'].filter(Boolean).join(' '),
    lines: final,
  };
}

export const FEE_CATEGORY_NAME = '國外交易手續費';

/**
 * 手續費的分類（2026-11-18 使用者決定 B）：「樂 / 數位內容」→「樂 / 數位內容 / 國外交易手續費」；
 * 已經是最底層（例：樂 / 數位內容 / LYSN）→ 放在上一層底下「樂 / 數位內容 / 國外交易手續費」
 */
export function feeCategoryOf(path: string): string {
  if (lastName(path) === FEE_CATEGORY_NAME) return path;
  const base = pathDepth(path) < MAX_CATEGORY_DEPTH ? path : parentPath(path)!;
  return `${base} / ${FEE_CATEGORY_NAME}`;
}

/** 手續費估算：金額 × 費率，四捨五入到整數 */
export const estimateFee = (amount: number, ratePct: number | null) => Math.round((amount * (ratePct ?? 1.5)) / 100);

/** 交易 → 表單（看不出是哪一種的 → mode「其他」，畫面只能刪除或到試算表改） */
export function txnToForm(t: Txn): EntryForm {
  const f: EntryForm = { ...emptyForm('其他', t.time), store: t.store, branch: t.branch, statementText: t.statementText, note: t.note, tags: t.tags, account: t.account, currency: t.currency, cats: [] };
  const L = t.lines;
  const only = (...kinds: LineKind[]) => L.length > 0 && L.every((l) => kinds.includes(l.kind));
  const catsOf = (kind: LineKind) => L.filter((l) => l.kind === kind).map((l) => ({ category: l.category, amount: l.amount, note: l.note }));
  if (t.direction === '轉帳') return { ...f, mode: '轉帳', amount: t.amount, toAccount: t.toAccount, toAmount: t.toAmount };
  if (t.direction === '出' && only('支出', '他欠我') && L.some((l) => l.kind === '支出') && L.every((l) => l.kind !== '他欠我' || l.debtType !== '借款')) {
    return { ...f, mode: '支出', cats: catsOf('支出'), shares: L.filter((l) => l.kind === '他欠我').map((l) => ({ person: l.person, amount: l.amount })) };
  }
  if (!t.direction && t.paidBy && only('支出', '我欠他') && L.filter((l) => l.kind === '我欠他').length === 1) {
    const debt = L.find((l) => l.kind === '我欠他')!;
    const mine = catsOf('支出');
    if (debt.person === t.paidBy && same(debt.amount, sum(mine.map((c) => c.amount)))) return { ...f, mode: '支出', paidBy: t.paidBy, cats: mine };
  }
  if (t.direction === '入' && only('收入')) return { ...f, mode: '收入', cats: catsOf('收入') };
  // 退款（負的支出）、負的收入
  if (t.direction === '入' && only('支出')) return { ...f, mode: '支出', cats: catsOf('支出') };
  if (t.direction === '出' && only('收入')) return { ...f, mode: '收入', cats: catsOf('收入') };
  if (L.length === 1) {
    const l = L[0];
    if (t.direction === '出' && l.kind === '他欠我' && l.debtType === '借款') return { ...f, mode: '借款', sub: '借出', person: l.person, amount: l.amount };
    if (t.direction === '入' && l.kind === '我欠他' && l.debtType === '借款') return { ...f, mode: '借款', sub: '借入', person: l.person, amount: l.amount };
    if (t.direction === '入' && l.kind === '他還我') return { ...f, mode: '還款', sub: '他還我', person: l.person, amount: l.amount };
    if (t.direction === '出' && l.kind === '我還他') return { ...f, mode: '還款', sub: '我還他', person: l.person, amount: l.amount };
  }
  if (!t.direction && L.length === 2) {
    const exp = L.find((l) => l.kind === '支出');
    const inc = L.find((l) => l.kind === '收入');
    const back = L.find((l) => l.kind === '他還我');
    const pay = L.find((l) => l.kind === '我還他');
    if (exp && back && same(exp.amount, back.amount)) return { ...f, mode: '不用還了', sub: '他還我', person: back.person, amount: back.amount, cats: [{ category: exp.category, amount: exp.amount }] };
    if (inc && pay && same(inc.amount, pay.amount)) return { ...f, mode: '不用還了', sub: '我還他', person: pay.person, amount: pay.amount, cats: [{ category: inc.category, amount: inc.amount }] };
  }
  if (only('調整')) return { ...f, mode: '調整', amount: t.amount };
  return f;
}

/** 一筆交易的標題（例：食 / 三餐、轉帳 → 悠遊卡、借給 小明） */
export function txnTitle(t: Txn): string {
  const f = txnToForm(t);
  switch (f.mode) {
    case '支出':
    case '收入': {
      const cats = [...new Set(f.cats.map((c) => c.category ?? ''))];
      return cats.length > 1 ? `${cats[0]} 等 ${cats.length} 類` : cats[0] || f.mode;
    }
    case '轉帳':
      return `轉帳 → ${t.toAccount ?? ''}`;
    case '借款':
      return f.sub === '借入' ? `向 ${f.person} 借` : `借給 ${f.person}`;
    case '還款':
      return f.sub === '我還他' ? `還給 ${f.person}` : `${f.person} 還我`;
    case '不用還了':
      return f.sub === '我還他' ? `欠 ${f.person} 的不用還了` : `${f.person} 欠的不收了`;
    case '調整':
      return '盤點調整';
    default:
      return '交易';
  }
}

/** 這筆交易「我」的收支（列表顯示用）：支出 − 收入（正 = 花錢） */
export function txnMyNet(t: Txn): { expense: number; income: number } {
  let expense = 0;
  let income = 0;
  for (const l of t.lines) {
    if (l.kind === '支出') expense += l.amount;
    if (l.kind === '收入') income += l.amount;
  }
  return { expense, income };
}

// ───────────── 資料存取 ─────────────

const SEEDED_KEY = 'money.seeded';

export class MoneyStore {
  /** 讀取會順便寫入（補齊），一次只跑一個 */
  private loadQueue: Promise<unknown> = Promise.resolve();
  private last: MoneySnapshot | null = null;

  constructor(
    private b: Backend,
    private via = 'money',
  ) {}

  load(now = Date.now()): Promise<MoneySnapshot> {
    const p = this.loadQueue.then(() => this.loadNow(now));
    this.loadQueue = p.catch(() => undefined);
    return p;
  }

  private async loadNow(now: number): Promise<MoneySnapshot> {
    const [accRows, catRows, txRows, lineRows, peopleRows, orgRows, setRows] = await Promise.all([
      this.b.read('moneyAccounts'),
      this.b.read('moneyCategories'),
      this.b.read('moneyTransactions'),
      this.b.read('moneyLines'),
      this.b.read('hubPeople'),
      this.b.read('hubOrganizations'),
      this.b.read('moneySettings'),
    ]);
    const issues: MoneyIssue[] = [];
    const fixes = new Map<TableName, RowUpdate[]>();
    const fix = (t: TableName, u: RowUpdate) => fixes.set(t, [...(fixes.get(t) ?? []), u]);
    const issue = (table: TableName, r: TableRow, problems: string[]) =>
      issues.push({ table, rowNumber: r.rowNumber, id: str(r.values.id), raw: r.raw, problems });
    /** 使用者在試算表新增的列：補 id */
    const ensureId = (table: TableName, r: TableRow, extra: RowValues = {}) => {
      const id = str(r.values.id);
      if (id) return id;
      const fill: RowValues = { id: newId(now), createdAt: now, updatedAt: now, ...extra };
      fix(table, { rowNumber: r.rowNumber, values: fill, expectId: '' });
      Object.assign(r.values, fill);
      return String(fill.id);
    };

    // 名單類：名稱必填、不重複
    const loadList = <T>(table: TableName, rows: TableRow[], key: string, label: string, conv: (r: TableRow) => T, extra?: (r: TableRow) => string[]) => {
      const out: T[] = [];
      const names = new Set<string>();
      for (const r of rows) {
        if (!isLive(r)) continue;
        const p = checkSimple(r, key, label, names, extra);
        if (p.length) {
          issue(table, r, p);
          continue;
        }
        const name = str(r.values[key])!;
        names.add(key === 'path' ? normPath(name) : name);
        ensureId(table, r);
        out.push(conv(r));
      }
      return out;
    };

    const accounts = loadList('moneyAccounts', accRows, 'name', '帳戶名稱', toAccount, (r) => {
      const p: string[] = [];
      if (!has(ACCOUNT_TYPES, str(r.values.type))) p.push(`類型「${str(r.values.type) ?? ''}」看不懂（請填：${ACCOUNT_TYPES.join('、')}）`);
      for (const k of ['openingDate', 'openingBalance', 'closingDay', 'dueDay', 'expiryDate']) if (r.errors.includes(k)) p.push(`${k} 格式看不懂`);
      return p;
    }).sort(bySort);
    const categories = loadList('moneyCategories', catRows, 'path', '分類', toCategory, (r) =>
      has(CATEGORY_KINDS, str(r.values.kind)) ? [] : [`kind 請填 支出 或 收入`],
    ).sort(bySort);
    const people = loadList('hubPeople', peopleRows, 'name', '人物名稱', toPerson).sort(bySort);
    const orgs = loadList('hubOrganizations', orgRows, 'name', '機構名稱', toOrg).sort(bySort);

    // 交易：先讀明細，再依交易分組
    const linesByTx = new Map<string, { row: TableRow; line: Line }[]>();
    for (const r of lineRows) {
      if (!isLive(r)) continue;
      const tx = str(r.values.transaction);
      if (!tx) {
        issue('moneyLines', r, ['沒有填 transaction（屬於哪筆交易）']);
        continue;
      }
      if (r.errors.includes('amount')) {
        issue('moneyLines', r, ['金額格式看不懂']);
        continue;
      }
      ensureId('moneyLines', r);
      linesByTx.set(tx, [...(linesByTx.get(tx) ?? []), { row: r, line: toLine(r) }]);
    }
    const refs: MoneyRefs = { accounts, categories, people };
    const txns: Txn[] = [];
    const usedTx = new Set<string>();
    for (const r of txRows) {
      if (!isLive(r)) continue;
      if (r.errors.includes('time') || num(r.values.time) == null) {
        issue('moneyTransactions', r, [r.errors.includes('time') ? '時間格式看不懂（例：2026/11/18 12:30）' : '沒有填時間']);
        continue;
      }
      const bad = ['amount', 'toAmount'].filter((k) => r.errors.includes(k));
      if (bad.length) {
        issue('moneyTransactions', r, bad.map((k) => `${k} 格式看不懂`));
        continue;
      }
      const date = toDateKey(Number(r.values.time));
      const id = ensureId('moneyTransactions', r, { date, createdVia: str(r.values.createdVia) ?? 'sheet' });
      if (str(r.values.date) !== date && !fixes.get('moneyTransactions')?.some((u) => u.rowNumber === r.rowNumber)) {
        fix('moneyTransactions', { rowNumber: r.rowNumber, values: { date }, expectId: id });
      }
      usedTx.add(id);
      const lines = (linesByTx.get(id) ?? []).map((x) => x.line).sort(bySort);
      const t = toTxn(r, lines);
      const dir = str(r.values.direction);
      const p = dir && !has(DIRECTIONS, dir) ? [`direction「${dir}」看不懂（請填：出、入、轉帳）`] : checkTxn(t, refs);
      if (p.length) {
        issue('moneyTransactions', r, p);
        continue;
      }
      txns.push(t);
    }
    // 找不到交易的明細
    for (const [tx, ls] of linesByTx) {
      if (usedTx.has(tx)) continue;
      for (const { row } of ls) issue('moneyLines', row, [`找不到交易「${tx}」`]);
    }

    for (const [t, us] of fixes) await this.b.update(t, us);
    txns.sort((a, b) => b.time - a.time);

    // 第一次使用：放預設分類（只放一次；使用者刪光也不會再放）
    if (!categories.length && !setRows.some((r) => str(r.values.key) === SEEDED_KEY)) {
      await this.b.append(
        'moneyCategories',
        DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sort: i + 1, id: newId(now), createdAt: now, updatedAt: now })),
      );
      await this.b.append('moneySettings', [{ key: SEEDED_KEY, value: 'TRUE' }]);
      return this.loadNow(now);
    }

    // 只有「食 / 三餐」沒有「食」（試算表直接新增、或舊版預設分類）→ 補上上層分類
    const have = new Set(categories.map((c) => c.path));
    const missing: RowValues[] = [];
    for (const c of categories) {
      for (const a of ancestorPaths(c.path)) {
        if (have.has(a)) continue;
        have.add(a);
        // 排在第一個子分類的位置（分類已依排序排好）
        missing.push({ path: a, kind: c.kind, sort: (c.sort ?? 0) - 0.5, id: newId(now), createdAt: now, updatedAt: now });
      }
    }
    if (missing.length) {
      await this.b.append('moneyCategories', missing);
      return this.loadNow(now);
    }

    // 店家 / 對象不在機構清單裡（試算表直接填、匯入）→ 自動加進機構
    const orgNames = new Set(orgs.map((o) => o.name));
    const newOrgs = [...new Set(txns.map((t) => t.store).filter((x): x is string => !!x && !orgNames.has(x)))];
    if (newOrgs.length) {
      let sort = Math.max(0, ...orgs.map((o) => o.sort ?? 0));
      await this.b.append('hubOrganizations', newOrgs.map((name) => ({ name, sort: ++sort, id: newId(now), createdAt: now, updatedAt: now })));
      return this.loadNow(now);
    }

    const snap: MoneySnapshot = { loadedAt: now, accounts, categories, people, orgs, txns, issues };
    this.last = snap;
    return snap;
  }

  private async fresh(): Promise<MoneySnapshot> {
    return this.load();
  }

  // ── 交易 ──

  /** 新增或修改一筆交易（含明細）。修改時：明細依順序覆蓋，多的標記刪除 */
  async saveTxn(input: TxnInput, existing?: Txn): Promise<string> {
    const snap = await this.fresh();
    const p = checkTxn(input, snap);
    if (p.length) throw new Error(p.join('；'));
    if (input.store && !snap.orgs.some((o) => o.name === input.store)) await this.addOrg(input.store);
    const now = Date.now();
    const cur = txnCurrency(input, snap.accounts);
    const r = (n: number | null) => (n == null ? null : roundMoney(n, cur));
    const toCur = input.toAccount ? txnCurrency({ account: input.toAccount, currency: null }, snap.accounts) : cur;
    const txValues: RowValues = {
      time: input.time,
      date: toDateKey(input.time),
      direction: input.direction,
      account: input.account,
      amount: r(input.amount),
      paidBy: input.paidBy,
      currency: input.account ? null : input.currency && input.currency !== 'TWD' ? input.currency : null,
      toAccount: input.toAccount,
      toAmount: input.toAmount == null ? null : roundMoney(input.toAmount, toCur),
      store: input.store,
      branch: input.branch,
      statementText: input.statementText,
      note: input.note,
      tags: input.tags.length ? input.tags.join('、') : null,
      updatedAt: now,
    };
    const lineValues = (l: LineInput, i: number): RowValues => ({
      kind: l.kind,
      amount: roundMoney(l.amount, cur),
      category: l.category ? normPath(l.category) : null,
      person: l.person ?? null,
      debtType: l.kind === '他欠我' || l.kind === '我欠他' ? (l.debtType ?? '分帳') : null,
      budget: l.budget ?? null,
      note: l.note ?? null,
      sort: i + 1,
      updatedAt: now,
    });

    if (!existing) {
      const id = newId(now);
      await this.b.append('moneyTransactions', [{ ...txValues, id, createdVia: this.via, createdAt: now }]);
      if (input.lines.length) {
        await this.b.append(
          'moneyLines',
          input.lines.map((l, i) => ({ ...lineValues(l, i), transaction: id, id: newId(now), createdAt: now })),
        );
      }
      return id;
    }
    // 修改：先寫交易（確認那一列還是這筆），再更新明細
    await this.b.update('moneyTransactions', [{ rowNumber: existing.rowNumber, values: txValues, expectId: existing.id }]);
    const old = existing.lines;
    const updates: RowUpdate[] = [];
    const appends: RowValues[] = [];
    input.lines.forEach((l, i) => {
      const o = old[i];
      if (o) updates.push({ rowNumber: o.rowNumber, values: lineValues(l, i), expectId: o.id });
      else appends.push({ ...lineValues(l, i), transaction: existing.id, id: newId(now), createdAt: now });
    });
    for (const o of old.slice(input.lines.length)) updates.push({ rowNumber: o.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: o.id });
    if (updates.length) await this.b.update('moneyLines', updates);
    if (appends.length) await this.b.append('moneyLines', appends);
    return existing.id;
  }

  /** 刪除只做標記（交易和明細一起） */
  async deleteTxn(t: Txn) {
    const now = Date.now();
    await this.b.update('moneyTransactions', [{ rowNumber: t.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: t.id }]);
    if (t.lines.length) {
      await this.b.update(
        'moneyLines',
        t.lines.map((l) => ({ rowNumber: l.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: l.id })),
      );
    }
  }

  // ── 帳戶 ──

  async saveAccount(input: Omit<Account, 'rowNumber' | 'id' | 'sort'> & { sort?: number | null }, existing?: Account) {
    const snap = await this.fresh();
    const name = input.name.trim();
    if (!name) throw new Error('請填帳戶名稱');
    if (snap.accounts.some((a) => a.name === name && a.id !== existing?.id)) throw new Error(`已經有「${name}」這個帳戶`);
    if (!has(ACCOUNT_TYPES, input.type)) throw new Error('請選帳戶類型');
    const currency = (input.currency.trim() || 'TWD').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('幣別請填 3 個英文字母（例：TWD、USD、JPY）');
    if (existing && existing.currency !== currency && snap.txns.some((t) => t.account === existing.name || t.toAccount === existing.name)) {
      throw new Error('這個帳戶已經有紀錄，不能改幣別');
    }
    if ((input.openingDate == null) !== (input.openingBalance == null)) throw new Error('期初餘額的日期和金額要一起填（或都不填）');
    for (const [k, label] of [
      ['closingDay', '結帳日'],
      ['dueDay', '繳款日'],
    ] as const) {
      const d = input[k];
      if (d != null && (!Number.isInteger(d) || d < 1 || d > 31)) throw new Error(`${label}請填 1–31`);
    }
    const org = input.org?.trim() || null;
    if (org && !snap.orgs.some((o) => o.name === org)) await this.addOrg(org, input.type === '電子支付' ? '電子支付' : '銀行');
    const now = Date.now();
    const values: RowValues = {
      name,
      type: input.type,
      currency: currency === 'TWD' ? null : currency,
      org,
      openingDate: input.openingDate,
      openingBalance: input.openingBalance == null ? null : roundMoney(input.openingBalance, currency),
      closingDay: input.type === '信用卡' ? input.closingDay : null,
      dueDay: input.type === '信用卡' ? input.dueDay : null,
      fxFeeRate: input.type === '信用卡' ? input.fxFeeRate : null,
      expiryDate: input.expiryDate,
      monthlyCheck: input.monthlyCheck ? null : false,
      archived: input.archived || null,
      note: input.note?.trim() || null,
      updatedAt: now,
    };
    if (!existing) {
      const sort = Math.max(0, ...snap.accounts.map((a) => a.sort ?? 0)) + 1;
      await this.b.append('moneyAccounts', [{ ...values, sort, id: newId(now), createdAt: now }]);
      return;
    }
    await this.b.update('moneyAccounts', [{ rowNumber: existing.rowNumber, values, expectId: existing.id }]);
    if (name !== existing.name) await this.renameInTxns(snap, 'account', existing.name, name);
  }

  /** 改名：交易裡用到的一起改 */
  private async renameInTxns(snap: MoneySnapshot, what: 'account' | 'person' | 'category', from: string, to: string) {
    const now = Date.now();
    if (what === 'account') {
      const us: RowUpdate[] = [];
      for (const t of snap.txns) {
        const v: RowValues = {};
        if (t.account === from) v.account = to;
        if (t.toAccount === from) v.toAccount = to;
        if (Object.keys(v).length) us.push({ rowNumber: t.rowNumber, values: { ...v, updatedAt: now }, expectId: t.id });
      }
      if (us.length) await this.b.update('moneyTransactions', us);
      return;
    }
    if (what === 'person') {
      const us = snap.txns.filter((t) => t.paidBy === from).map((t) => ({ rowNumber: t.rowNumber, values: { paidBy: to, updatedAt: now }, expectId: t.id }));
      if (us.length) await this.b.update('moneyTransactions', us);
    }
    const lineUs: RowUpdate[] = [];
    for (const t of snap.txns) {
      for (const l of t.lines) {
        if (what === 'person' && l.person === from) lineUs.push({ rowNumber: l.rowNumber, values: { person: to, updatedAt: now }, expectId: l.id });
        if (what === 'category' && l.category && (l.category === from || l.category.startsWith(`${from} / `))) {
          lineUs.push({ rowNumber: l.rowNumber, values: { category: to + l.category.slice(from.length), updatedAt: now }, expectId: l.id });
        }
      }
    }
    if (lineUs.length) await this.b.update('moneyLines', lineUs);
  }

  // ── 分類 ──

  /** 確保分類存在（上層要已經存在）；用在自動建立「… / 國外交易手續費」 */
  async ensureCategories(paths: string[], kind: CategoryKind) {
    const snap = await this.fresh();
    const now = Date.now();
    let sort = Math.max(0, ...snap.categories.map((c) => c.sort ?? 0));
    const add = [...new Set(paths.map(normPath))]
      .filter((p) => p && !snap.categories.some((c) => c.path === p))
      .map((p) => ({ path: p, kind: snap.categories.find((c) => c.path === parentPath(p))?.kind ?? kind, sort: ++sort, id: newId(now), createdAt: now, updatedAt: now }));
    if (add.length) await this.b.append('moneyCategories', add);
  }

  /**
   * 新增分類：在某個分類底下（parent）或新增主分類（parent = null），只填這一層的名字。
   * 回傳完整路徑（例：食 / 三餐 / 早餐）。子分類的支出 / 收入跟著上層。
   */
  async addCategory(parent: string | null, name: string, kind: CategoryKind): Promise<string> {
    const snap = await this.fresh();
    const n = checkCategoryName(name);
    const up = parent ? snap.categories.find((c) => c.path === normPath(parent)) : null;
    if (parent && !up) throw new Error(`找不到上層分類「${parent}」`);
    const p = up ? `${up.path} / ${n}` : n;
    if (pathDepth(p) > MAX_CATEGORY_DEPTH) throw new Error(`分類最多 ${MAX_CATEGORY_DEPTH} 層`);
    if (snap.categories.some((c) => c.path === p)) throw new Error(`已經有「${p}」`);
    const now = Date.now();
    const sort = Math.max(0, ...snap.categories.map((c) => c.sort ?? 0)) + 1;
    await this.b.append('moneyCategories', [{ path: p, kind: up?.kind ?? kind, sort, id: newId(now), createdAt: now, updatedAt: now }]);
    return p;
  }

  /** 改名：只改這一層的名字，底下的分類和用到的明細一起改 */
  async renameCategory(c: Category, name: string) {
    const n = checkCategoryName(name);
    const parts = c.path.split(' / ');
    parts[parts.length - 1] = n;
    await this.updateCategory(c, { path: parts.join(' / ') });
  }

  /** 在同一層裡上移（-1）/ 下移（+1）：和旁邊的分類交換排序 */
  async moveCategory(c: Category, delta: -1 | 1) {
    const snap = await this.fresh();
    const siblings = snap.categories.filter((x) => x.kind === c.kind && parentPath(x.path) === parentPath(c.path));
    const i = siblings.findIndex((x) => x.id === c.id);
    const other = siblings[i + delta];
    if (i < 0 || !other) return;
    // 排序可能有空白或重複 → 整層重新編號後交換
    const base = Math.min(...siblings.map((x) => x.sort ?? Infinity).filter(Number.isFinite), 1);
    const order = siblings.map((x) => x.id);
    [order[i], order[i + delta]] = [order[i + delta], order[i]];
    const now = Date.now();
    const us: RowUpdate[] = [];
    order.forEach((id, k) => {
      const x = siblings.find((s) => s.id === id)!;
      if (x.sort !== base + k) us.push({ rowNumber: x.rowNumber, values: { sort: base + k, updatedAt: now }, expectId: x.id });
    });
    if (us.length) await this.b.update('moneyCategories', us);
  }

  /**
   * 修改分類。改名時，底下的分類（例：「食」底下的「食 / 三餐」）和用到的明細一起改。
   */
  async updateCategory(c: Category, patch: { path?: string; isInvest?: boolean; archived?: boolean }) {
    const snap = await this.fresh();
    const now = Date.now();
    const to = patch.path != null ? normPath(patch.path) : c.path;
    if (!to) throw new Error('請填分類名稱');
    if (pathDepth(to) > MAX_CATEGORY_DEPTH) throw new Error(`分類最多 ${MAX_CATEGORY_DEPTH} 層`);
    const us: RowUpdate[] = [];
    const v: RowValues = { updatedAt: now };
    if (patch.isInvest !== undefined) v.isInvest = patch.isInvest || null;
    if (patch.archived !== undefined) v.archived = patch.archived || null;
    if (to !== c.path) {
      const moving = snap.categories.filter((x) => x.path === c.path || x.path.startsWith(`${c.path} / `));
      for (const m of moving) {
        const np = to + m.path.slice(c.path.length);
        if (snap.categories.some((x) => x.path === np && !moving.includes(x))) throw new Error(`已經有「${np}」`);
        if (m.id !== c.id) us.push({ rowNumber: m.rowNumber, values: { path: np, updatedAt: now }, expectId: m.id });
      }
      v.path = to;
    }
    us.unshift({ rowNumber: c.rowNumber, values: v, expectId: c.id });
    await this.b.update('moneyCategories', us);
    if (to !== c.path) await this.renameInTxns(snap, 'category', c.path, to);
  }

  // ── 人物、機構（在綜合 APP 的試算表） ──

  async addPerson(name: string): Promise<string> {
    const snap = await this.fresh();
    const n = name.trim();
    if (!n) throw new Error('請填名稱');
    if (snap.people.some((p) => p.name === n)) return n;
    const now = Date.now();
    const sort = Math.max(0, ...snap.people.map((p) => p.sort ?? 0)) + 1;
    await this.b.append('hubPeople', [{ name: n, sort, id: newId(now), createdAt: now, updatedAt: now }]);
    return n;
  }

  async updatePerson(p: Person, patch: { name?: string; archived?: boolean }) {
    const snap = await this.fresh();
    const now = Date.now();
    const v: RowValues = { updatedAt: now };
    const to = patch.name?.trim();
    if (to !== undefined) {
      if (!to) throw new Error('請填名稱');
      if (snap.people.some((x) => x.name === to && x.id !== p.id)) throw new Error(`已經有「${to}」`);
      v.name = to;
    }
    if (patch.archived !== undefined) v.archived = patch.archived || null;
    await this.b.update('hubPeople', [{ rowNumber: p.rowNumber, values: v, expectId: p.id }]);
    if (to && to !== p.name) await this.renameInTxns(snap, 'person', p.name, to);
  }

  async addOrg(name: string, kind: string | null = null, foreign = false) {
    const snap = this.last ?? (await this.fresh());
    const n = name.trim();
    if (!n || snap.orgs.some((o) => o.name === n)) return;
    const now = Date.now();
    const sort = Math.max(0, ...snap.orgs.map((o) => o.sort ?? 0)) + 1;
    await this.b.append('hubOrganizations', [{ name: n, kind, foreign: foreign || null, sort, id: newId(now), createdAt: now, updatedAt: now }]);
  }

  /** 修改機構：改名時帳戶、交易的店家一起改 */
  async updateOrg(o: Org, patch: { name?: string; kind?: string | null; foreign?: boolean }) {
    const snap = await this.fresh();
    const now = Date.now();
    const v: RowValues = { updatedAt: now };
    const to = patch.name?.trim();
    if (to !== undefined) {
      if (!to) throw new Error('請填名稱');
      if (to !== o.name && snap.orgs.some((x) => x.name === to)) throw new Error(`已經有「${to}」`);
      v.name = to;
    }
    if (patch.kind !== undefined) v.kind = patch.kind || null;
    if (patch.foreign !== undefined) v.foreign = patch.foreign || null;
    await this.b.update('hubOrganizations', [{ rowNumber: o.rowNumber, values: v, expectId: o.id }]);
    if (!to || to === o.name) return;
    const accs = snap.accounts.filter((a) => a.org === o.name).map((a) => ({ rowNumber: a.rowNumber, values: { org: to, updatedAt: now }, expectId: a.id }));
    if (accs.length) await this.b.update('moneyAccounts', accs);
    const txs = snap.txns.filter((t) => t.store === o.name).map((t) => ({ rowNumber: t.rowNumber, values: { store: to, updatedAt: now }, expectId: t.id }));
    if (txs.length) await this.b.update('moneyTransactions', txs);
  }

  async discardIssue(issue: MoneyIssue) {
    const now = Date.now();
    await this.b.update(issue.table, [{ rowNumber: issue.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: issue.id ?? '' }]);
  }
}
