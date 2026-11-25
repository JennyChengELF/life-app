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
import { startOfDay, toDateKey } from './time';
import { addSharedTag, loadSharedTags, readTagIds, writeTagIds, type SharedTag } from './shared-tags';

// ───────────── 選項 ─────────────

export const ACCOUNT_TYPES = ['現金', '銀行', '定存', '信用卡', '電子支付', '儲值卡', '禮券', '回饋點數'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const DIRECTIONS = ['出', '入', '轉帳'] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const LINE_KINDS = ['支出', '收入', '他欠我', '我欠他', '他還我', '我還他', '調整'] as const;
export type LineKind = (typeof LINE_KINDS)[number];
export const CATEGORY_KINDS = ['支出', '收入'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];
/** 和人物有關的明細 */
export const PERSON_KINDS: LineKind[] = ['他欠我', '我欠他', '他還我', '我還他'];
/** 機構類別（2026-11-18 確認） */
export const ORG_KINDS = ['商店', '餐飲', '銀行', '證券', '保險', '電子支付', '醫療', '公司', '政府', '其他'] as const;

/**
 * 第一次使用時放的預設分類（2026-11-18 使用者決定：支出只放 食、衣、住、行、育、樂、投資；收入保留 4 個）。
 * 只在第一次打開時放；之後可匯入舊試算表的分類、自己改。
 */
export const DEFAULT_CATEGORIES: { path: string; kind: CategoryKind; isInvest?: boolean }[] = [
  { path: '食', kind: '支出' },
  { path: '衣', kind: '支出' },
  { path: '住', kind: '支出' },
  { path: '行', kind: '支出' },
  { path: '育', kind: '支出' },
  { path: '樂', kind: '支出' },
  { path: '投資', kind: '支出', isInvest: true },
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
  /** 卡號 / 帳號後幾碼（2026-11-18 使用者要求） */
  last4: string | null;
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
  budget?: string | null;
  note?: string | null;
}

export interface Line extends RowRef, Required<LineInput> {
  transaction: string;
  sort: number | null;
}

/** 一筆銀行扣款分配到哪張信用卡、哪一期帳單。 */
export interface CardPaymentInput {
  account: string | null;
  statement: string | null;
  amount: number | null;
}

export interface CardPayment extends RowRef {
  transaction: string;
  account: string;
  statement: string;
  amount: number;
  sort: number | null;
}

export type TwdStatus = 'pending' | 'estimated' | 'final';

export interface PaymentInput {
  account: string | null;
  amount: number | null;
}

export interface Payment extends RowRef {
  account: string;
  amount: number;
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
  tagIds: string[];
  lines: LineInput[];
  origCurrency?: string | null;
  twdAmount?: number | null;
  twdStatus?: TwdStatus | null;
  rewardFor?: string | null;
  payments?: PaymentInput[];
  /** 同一家發卡機構的多卡／多期繳款分配；有值時不用 toAccount。 */
  cardPayments?: CardPaymentInput[];
  /** 繳卡費的轉帳：繳哪一期帳單（帳單 id）；undefined = 不改 */
  statement?: string | null;
}

export interface Txn extends RowRef, Omit<TxnInput, 'lines' | 'statement' | 'cardPayments' | 'payments'> {
  date: string;
  /** 入帳日（對帳時填） */
  postedDate: string | null;
  /** 繳卡費的轉帳：繳哪一期帳單（帳單 id） */
  statement: string | null;
  createdVia: string | null;
  lines: Line[];
  cardPayments: CardPayment[];
  payments?: Payment[];
}

export interface MoneyIssue {
  table: TableName;
  rowNumber: number;
  id: string | null;
  raw: Record<string, unknown>;
  problems: string[];
  /** 交易沒有明細時：「在 APP 裡補完」用的表單（金額、帳戶、店家都帶好） */
  draft?: EntryForm;
  /**
   * 整批補齊（2026-11-19 使用者決定）：沒有交易的明細（金額看得懂才有）。
   * group = 明細上填的交易代號（找不到那筆交易）；null = 沒填
   */
  orphan?: { group: string | null; line: LineInput };
  /** 整批補齊：只缺分類的交易（勾多筆、選同一個分類一次補完） */
  needsCategory?: '支出' | '收入';
}

/** 整批補齊時填的交易資料 */
export interface OrphanHead {
  time: number;
  /** 帳戶；朋友幫我付時是 null */
  account: string | null;
  paidBy: string | null;
  store: string | null;
  branch?: string | null;
  note: string | null;
}

/**
 * 勾選的明細合成一筆交易（2026-11-19 使用者決定：合成一筆）。
 * 支出或收入、金額都由明細算；朋友幫我付時補一行和他之間的欠款，讓明細平衡。
 */
export function orphanTxn(lines: LineInput[], head: OrphanHead): TxnInput {
  const base = {
    time: head.time,
    store: head.store?.trim() || null,
    branch: head.store?.trim() ? head.branch?.trim() || null : null,
    statementText: null,
    note: head.note?.trim() || null,
    tagIds: [],
    toAccount: null,
    toAmount: null,
    currency: null,
  };
  const { out, adjust } = lineBalance(lines);
  if (head.paidBy) {
    const extra: LineInput[] = same(out, 0) ? [] : [{ kind: out > 0 ? '我欠他' : '他欠我', amount: Math.abs(out), person: head.paidBy }];
    return { ...base, direction: null, account: null, amount: null, paidBy: head.paidBy, lines: [...lines, ...extra] };
  }
  const dir: Direction = out + adjust >= 0 ? '出' : '入';
  return { ...base, direction: dir, account: head.account, amount: dir === '出' ? out + adjust : -out + adjust, paidBy: null, lines };
}

export interface Budget extends RowRef {
  name: string;
  ideal: number | null;
  basic: number | null;
  /** 每月預算（false = 不是每月都放，例：年度保險費） */
  monthly: boolean;
  goal: number | null;
  archived: boolean;
  sort: number | null;
  note: string | null;
}

/** 預算分配的種類：期初 = 「重新整理預算」那天開始時的金額 */
export const ALLOC_KINDS = ['每月', '追加', '年終', '期初'] as const;
export type AllocKind = (typeof ALLOC_KINDS)[number];

export interface Allocation extends RowRef {
  month: string;
  budget: string;
  kind: AllocKind;
  amount: number;
  /** 期初：從哪一天開始算 */
  date: string | null;
  /** 每月：當時的理想金額 */
  ideal: number | null;
  note: string | null;
}

export interface Deposit extends RowRef {
  account: string;
  principal: number;
  rate: number | null;
  startDate: string;
  maturityDate: string;
  termMonths: number | null;
  fromAccount: string | null;
  endedDate: string | null;
  note: string | null;
}

/** 帳單（2026-11-18 確認：帳戶＋結帳日 = 一期） */
export interface Statement extends RowRef {
  account: string;
  closeDate: string;
  dueDate: string | null;
  amountDue: number | null;
  doneAt: number | null;
  note: string | null;
}

/** 手動取消配對（不讓 APP 自動配對）的記號 */
export const NO_MATCH = '不配對';

/** 帳單明細：帳單上的一行（金額照帳單的正負） */
export interface StatementItem extends RowRef {
  account: string;
  closeDate: string;
  date: string | null;
  postedDate: string | null;
  description: string | null;
  amount: number;
  origCurrency: string | null;
  origAmount: number | null;
  /** 配對到的交易 id；[NO_MATCH] = 使用者取消配對 */
  matched: string[];
}

/** 盤點：某帳戶某一天結束時的實際餘額（信用卡是未繳金額，正數 = 欠款） */
export interface BalanceCheck extends RowRef {
  account: string;
  date: string;
  actual: number;
  bookSnapshot: number | null;
  note: string | null;
}

export interface MoneySettings {
  /** 「超過收入」和哪個月的收入比（2026-11-18 確認是設定值） */
  incomeCompare: '上個月' | '本月';
  /** 借出超過幾天沒還，首頁提醒 */
  loanRemindDays: number;
}
export const DEFAULT_MONEY_SETTINGS: MoneySettings = { incomeCompare: '上個月', loanRemindDays: 30 };

export interface MoneySnapshot {
  loadedAt: number;
  accounts: Account[];
  categories: Category[];
  people: Person[];
  orgs: Org[];
  sharedTags: SharedTag[];
  /** 新 → 舊 */
  txns: Txn[];
  budgets: Budget[];
  /** 定存單（依到期日排，進行中的在前） */
  deposits: Deposit[];
  allocations: Allocation[];
  /** 帳單（依結帳日，舊 → 新） */
  statements: Statement[];
  statementItems: StatementItem[];
  /** 盤點（舊 → 新） */
  balanceChecks: BalanceCheck[];
  settings: MoneySettings;
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

/** 預估定存利息：本金 × 年利率 × 天數 / 365（四捨五入到幣別單位） */
export function estimateInterest(dep: Pick<Deposit, 'principal' | 'rate' | 'startDate' | 'maturityDate'>, currency = 'TWD'): number {
  if (!dep.rate) return 0;
  const days = Math.round((startOfDay(dep.maturityDate) - startOfDay(dep.startDate)) / 86400000);
  return roundMoney((dep.principal * dep.rate * days) / 36500, currency);
}

/** 'YYYY-MM-DD' 加幾個月（月底對不到時用那個月最後一天） */
export function addMonthsToDate(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const last = new Date(y, m - 1 + months + 1, 0).getDate();
  return toDateKey(new Date(y, m - 1 + months, Math.min(d, last)).getTime());
}

/** 某年某月的第幾天（月底對不到時用那個月最後一天）→ 'YYYY-MM-DD'；month 是 1–12，可超出（自動跨年） */
export function dayOfMonth(year: number, month: number, day: number): string {
  const last = new Date(year, month, 0).getDate();
  return toDateKey(new Date(year, month - 1, Math.min(day, last)).getTime());
}

/** 那個月的最後一天 */
export const monthEnd = (date: string) => {
  const [y, m] = date.split('-').map(Number);
  return dayOfMonth(y, m, 31);
};

/**
 * 預設對帳哪一期（2026-11-18 確認）：信用卡 = 最近一次已經過的結帳日；其他帳戶 = 上個月最後一天
 */
export function defaultCloseDate(acc: Pick<Account, 'type' | 'closingDay'>, today: string): string {
  const [y, m] = today.split('-').map(Number);
  if (acc.type === '信用卡' && acc.closingDay) {
    const thisMonth = dayOfMonth(y, m, acc.closingDay);
    return thisMonth <= today ? thisMonth : dayOfMonth(y, m - 1, acc.closingDay);
  }
  return dayOfMonth(y, m - 1, 31);
}

/** 繳款期限（2026-11-18 確認：依繳款日算）：結帳日之後第一個繳款日；沒設繳款日 → null */
export function dueDateFor(acc: Pick<Account, 'type' | 'dueDay'>, closeDate: string): string | null {
  if (acc.type !== '信用卡' || !acc.dueDay) return null;
  const [y, m] = closeDate.split('-').map(Number);
  const same = dayOfMonth(y, m, acc.dueDay);
  return same > closeDate ? same : dayOfMonth(y, m + 1, acc.dueDay);
}

/** 快到期（N 天內）或已到期還沒處理的定存單 */
export function depositsDue(deposits: Deposit[], today: string, days = 7): Deposit[] {
  const limit = toDateKey(startOfDay(today) + days * 86400000);
  return deposits.filter((d) => !d.endedDate && d.maturityDate <= limit);
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

/**
 * 常用分類：最近 90 天使用次數最多的完整分類路徑；支出、收入分開。
 * 次數相同時最近使用的排前面，只計次數、不看金額。（2026-11-21 使用者決定）
 */
export function frequentCategories(txns: Txn[], kind: CategoryKind, n = 5, now = Date.now(), days = 90): string[] {
  const since = now - days * 86400000;
  const stats = new Map<string, { count: number; last: number }>();
  for (const txn of txns) {
    if (txn.time < since || txn.time > now) continue;
    for (const line of txn.lines) {
      if (line.kind !== kind || !line.category) continue;
      const current = stats.get(line.category) ?? { count: 0, last: -Infinity };
      current.count += 1;
      current.last = Math.max(current.last, txn.time);
      stats.set(line.category, current);
    }
  }
  return [...stats]
    .sort(([pathA, a], [pathB, b]) => b.count - a.count || b.last - a.last || pathA.localeCompare(pathB, 'zh-Hant'))
    .slice(0, n)
    .map(([path]) => path);
}

/** APP 自動產生的備註（分期、手續費、定存、盤點）不算常用文字 */
const AUTO_NOTE = /國外交易服務費|^開定存|^定存|^盤點調整/;

/**
 * 分類的常用備註（2026-11-18 使用者要求，自動學）：以前在這個分類寫過的備註（整筆的備註＋這個分類那一行明細的備註），用最多次的在前面（一樣多次的，最近用的在前）。
 * 備註用「、」分開的各算一個（點常用文字時是用「、」接在後面）；分期的「1/6 期：」去掉。
 * 這個分類不到 min 個時，補上一層分類（含底下其他子分類）的。
 */
export function noteSuggestions(txns: Txn[], categories: string[], n = 8, min = 5): string[] {
  const collect = (match: (path: string) => boolean) => {
    const m = new Map<string, { count: number; last: number }>();
    for (const t of txns) {
      const hit = t.lines.filter((l) => l.category && match(l.category));
      if (!hit.length) continue;
      // 這一行明細自己的備註排在整筆備註前面（次數一樣時比較相關）
      const notes = [...hit.map((l) => l.note), t.note].filter((x): x is string => !!x);
      const parts = new Set(notes.flatMap((n) => n.replace(/^\d+\/\d+ 期：?/, '').split('、').map((x) => x.trim())));
      for (const part of parts) {
        if (!part || AUTO_NOTE.test(part)) continue;
        const x = m.get(part) ?? { count: 0, last: 0 };
        x.count++;
        x.last = Math.max(x.last, t.time);
        m.set(part, x);
      }
    }
    return [...m].sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last).map(([k]) => k);
  };
  const cats = [...new Set(categories.filter(Boolean).map(normPath))];
  if (!cats.length) return [];
  const out = collect((p) => cats.includes(p));
  if (out.length < min) {
    const ups = cats.map(parentPath).filter((p): p is string => !!p);
    if (ups.length) for (const x of collect((p) => ups.some((u) => p === u || p.startsWith(`${u} / `)))) if (!out.includes(x)) out.push(x);
  }
  return out.slice(0, n);
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
    last4: str(v.last4),
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

function toBudget(r: TableRow): Budget {
  const v = r.values;
  return {
    rowNumber: r.rowNumber,
    id: String(v.id ?? ''),
    name: str(v.name)!,
    ideal: num(v.ideal),
    basic: num(v.basic),
    monthly: v.monthly !== false,
    goal: num(v.goal),
    archived: v.archived === true,
    sort: num(v.sort),
    note: str(v.note),
  };
}

function toAllocation(r: TableRow): Allocation {
  const v = r.values;
  return {
    rowNumber: r.rowNumber,
    id: String(v.id ?? ''),
    month: str(v.month)!,
    budget: str(v.budget)!,
    kind: str(v.kind) as AllocKind,
    amount: num(v.amount)!,
    date: str(v.date),
    ideal: num(v.ideal),
    note: str(v.note),
  };
}

function parseMoneySettings(rows: TableRow[]): MoneySettings {
  const kv = new Map<string, unknown>();
  for (const r of rows) {
    const k = str(r.values.key);
    if (k && !kv.has(k)) kv.set(k, r.values.value);
  }
  const cmp = str(kv.get('money.incomeCompare'));
  const days = Number(kv.get('money.loanRemindDays'));
  return {
    incomeCompare: cmp === '本月' ? '本月' : DEFAULT_MONEY_SETTINGS.incomeCompare,
    loanRemindDays: Number.isInteger(days) && days >= 1 && days <= 365 ? days : DEFAULT_MONEY_SETTINGS.loanRemindDays,
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
    budget: str(v.budget),
    note: str(v.note),
    sort: num(v.sort),
  };
}

function toCardPayment(r: TableRow): CardPayment {
  const v = r.values;
  return {
    rowNumber: r.rowNumber,
    id: String(v.id ?? ''),
    transaction: str(v.transaction)!,
    account: str(v.account)!,
    statement: str(v.statement)!,
    amount: num(v.amount)!,
    sort: num(v.sort),
  };
}

function toTxn(r: TableRow, lines: Line[], cardPayments: CardPayment[] = [], payments: Payment[] = []): Txn {
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
    tagIds: readTagIds(v.tagIds),
    createdVia: str(v.createdVia),
    postedDate: str(v.postedDate),
    statement: str(v.statement),
    origCurrency: str(v.origCurrency)?.toUpperCase() ?? null,
    twdAmount: num(v.twdAmount),
    twdStatus: str(v.twdStatus) as TwdStatus | null,
    rewardFor: str(v.rewardFor),
    lines,
    cardPayments,
    payments,
  };
}

/** 檢查用的參照資料 */
export interface MoneyRefs {
  accounts: (Pick<Account, 'name' | 'currency'> & Partial<Pick<Account, 'type' | 'org'>>)[];
  categories: Pick<Category, 'path' | 'kind'>[];
  people: Pick<Person, 'name'>[];
  statements?: Pick<Statement, 'id' | 'account'>[];
}

/** 帳戶顯示名稱：有後幾碼就加在後面（例：大戶卡（5009）） */
export const accountLabel = (a: Pick<Account, 'name' | 'last4'>) => (a.last4 ? `${a.name}（${a.last4}）` : a.name);

/** 這筆交易的幣別：有帳戶看帳戶，沒帳戶看交易自己填的（空白 = TWD） */
export function txnCurrency(t: Pick<TxnInput, 'account' | 'currency' | 'origCurrency'>, accounts: Pick<Account, 'name' | 'currency'>[]): string {
  const a = t.account ? accounts.find((x) => x.name === t.account) : null;
  return t.origCurrency ?? a?.currency ?? t.currency ?? 'TWD';
}

/** （2026-11-25 使用者決定：匯率由原幣金額與台幣金額計算。） */
export function twdRate(t: Pick<TxnInput, 'origCurrency' | 'amount' | 'twdAmount'>): number | null {
  return t.origCurrency && t.amount && t.twdAmount != null && Number.isFinite(t.twdAmount) ? t.twdAmount / t.amount : null;
}

export function txnReportCurrency(t: Txn, accounts: Pick<Account, 'name' | 'currency'>[]): string {
  return twdRate(t) != null ? 'TWD' : txnCurrency(t, accounts);
}

/** 換算後的明細以交易順序分配四捨五入差額，保留原幣明細。 */
export function txnReportLines(t: Txn): Line[] {
  const rate = twdRate(t);
  if (rate == null) return t.lines;
  let total = 0;
  return t.lines.map((line) => {
    const sign = ['收入', '我欠他', '他還我'].includes(line.kind) ? -1 : 1;
    const before = roundMoney(total * rate);
    total += line.amount * sign;
    return { ...line, amount: sign * (roundMoney(total * rate) - before) };
  });
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

/**
 * 檢查一筆交易（含明細）；回傳問題（中文），空陣列 = 沒問題。
 * allowNoCategory：明細沒選分類也可以（2026-11-19 使用者要求：整批補齊時先讓我過，回到記帳再補；
 * 試算表讀進來的也一樣）。在 APP 裡記一筆、修改時還是要選。
 */
export function checkTxn(t: Omit<TxnInput, 'tagIds'> & { tagIds?: string[] }, refs: MoneyRefs, opts: { allowNoCategory?: boolean } = {}): string[] {
  const p: string[] = [];
  if (!Number.isFinite(t.time)) p.push('沒有填時間');
  const accName = (n: string | null) => n != null && refs.accounts.some((a) => a.name === n);
  const cur = txnCurrency(t, refs.accounts);
  const intOk = (n: number) => currencyDigits(cur) > 0 || Number.isInteger(n);
  const accCur = refs.accounts.find((a) => a.name === t.account)?.currency ?? cur;
  const payments = t.payments ?? [];

  if (t.origCurrency) {
    if (!/^[A-Z]{3}$/.test(t.origCurrency) || t.origCurrency === 'TWD') p.push('原始幣別請填三個英文字母（例：JPY、USD）');
    if (t.direction !== '出' && t.direction !== '入') p.push('原幣金額適用於支出與收入');
    if (accCur !== 'TWD' && accCur !== cur) p.push('請選新台幣或與原始幣別相同的帳戶');
    if (t.twdAmount != null && (!Number.isInteger(t.twdAmount) || t.twdAmount <= 0 || !t.amount)) p.push('換算台幣金額請填正整數，原幣淨額須大於 0');
    if (t.twdAmount == null ? t.twdStatus != null && t.twdStatus !== 'pending' : t.twdStatus !== 'estimated' && t.twdStatus !== 'final') {
      p.push('請確認台幣金額是尚未換算、預估或實際金額');
    }
  } else if (t.twdAmount != null || t.twdStatus) p.push('請先填原始幣別');

  if (t.rewardFor && (t.direction !== '入' || !t.lines.length || t.lines.some((l) => l.kind !== '收入' || l.amount <= 0))) p.push('回饋請記為一筆正金額的收入');

  // （2026-11-25 使用者決定：付款與消費明細平行，付款加總需等於帳戶實際增減。）
  if (payments.length) {
    if (t.direction !== '出' && t.direction !== '入') p.push('付款明細適用於支出與收入');
    if (payments[0].account !== t.account) p.push('第一筆付款明細須與交易帳戶相同');
    const seen = new Set<string>();
    let total = 0;
    for (const x of payments) {
      const account = refs.accounts.find((a) => a.name === x.account);
      if (!account) p.push('每筆付款明細都要選帳戶');
      else if (account.currency !== accCur) p.push(`付款明細的帳戶幣別應為 ${accCur}`);
      if (x.account && seen.has(x.account)) p.push('相同帳戶的付款金額請合併');
      if (x.account) seen.add(x.account);
      if (x.amount == null || !Number.isFinite(x.amount) || x.amount <= 0 || roundMoney(x.amount, accCur) !== x.amount) p.push(`付款明細請填有效的 ${accCur} 正數金額`);
      else total += x.amount;
    }
    const expected = t.origCurrency && accCur === 'TWD' ? t.twdAmount : t.amount;
    if (expected == null || !same(total, expected)) p.push('付款明細加總須等於實際付款或收款金額');
  }

  // 2026-11-21 使用者決定：一般支出／收入可以明確記 0；淨額為 0 時帳戶可留空。
  // 空白金額會在 formToTxn 轉成 NaN，因此仍和「輸入 0」分得出來。
  const zeroRecord =
    t.amount === 0 &&
    (t.direction === '出' || t.direction === '入') &&
    t.lines.length > 0 &&
    t.lines.every((l) => l.kind === '支出' || l.kind === '收入');

  if (t.direction) {
    if (!t.account) {
      if (!zeroRecord) p.push('沒有填帳戶');
    } else if (!accName(t.account)) p.push(`帳戶「${t.account}」不在帳戶清單裡`);
    // 退款用負數記（2026-11-18）：支出 / 收入的交易金額已經轉成正數，這裡只會是沒填、0、或借還款轉帳填了負數
    if (t.amount == null || Number.isNaN(t.amount) || (t.amount === 0 && !zeroRecord)) p.push('請填金額');
    else if (t.amount < 0) p.push('轉帳、借款、還款的金額請填正數');
    else if (!intOk(t.amount)) p.push(`${cur} 金額請填整數`);
    if (t.paidBy) p.push('朋友先幫我付（paidBy）時不能有帳戶和出 / 入');
  } else {
    if (t.account) p.push('有帳戶時請填 direction（出、入、轉帳）');
    if (t.amount != null) p.push('沒帳戶時金額請空白（金額看明細）');
  }
  if (t.paidBy && !refs.people.some((x) => x.name === t.paidBy)) p.push(`人物「${t.paidBy}」不在人物清單裡`);

  if (t.direction === '轉帳') {
    const from = refs.accounts.find((a) => a.name === t.account);
    const payments = t.cardPayments ?? [];
    if (payments.length) {
      // 2026-11-21 使用者決定：同一筆銀行扣款可分到同一機構的多張卡／多期帳單，也可分次繳。
      if (t.toAccount || t.toAmount != null || t.statement) p.push('多卡繳費不能再填單一轉入帳戶或單一期別');
      const seen = new Set<string>();
      const orgs = new Set<string>();
      let total = 0;
      payments.forEach((x, i) => {
        const at = payments.length > 1 ? `第 ${i + 1} 筆分配：` : '繳款分配：';
        const card = refs.accounts.find((a) => a.name === x.account);
        if (!x.account) p.push(`${at}請選信用卡`);
        else if (!card) p.push(`${at}帳戶「${x.account}」不在帳戶清單裡`);
        else {
          if (card.type && card.type !== '信用卡') p.push(`${at}「${x.account}」不是信用卡帳戶`);
          if (!card.org) p.push(`${at}信用卡「${x.account}」尚未設定發卡機構`);
          else orgs.add(card.org);
          if (from && from.currency !== card.currency) p.push(`${at}多卡繳費目前只支援相同幣別（${from.currency} → ${card.currency}）`);
        }
        if (!x.statement) p.push(`${at}請選帳單期別`);
        else {
          if (seen.has(x.statement)) p.push(`${at}同一期帳單重複選了`);
          seen.add(x.statement);
          const stmt = refs.statements?.find((s) => s.id === x.statement);
          if (stmt && stmt.account !== x.account) p.push(`${at}帳單期別不屬於「${x.account}」`);
          else if (refs.statements && !stmt) p.push(`${at}找不到這一期帳單`);
        }
        if (x.amount == null || !(x.amount > 0)) p.push(`${at}金額請填大於 0 的數字`);
        else if (card && (currencyDigits(card.currency) > 0 || Number.isInteger(x.amount))) total += x.amount;
        else p.push(`${at}${card?.currency ?? cur} 金額請填整數`);
      });
      if (orgs.size > 1) p.push('一筆扣款只能繳同一家發卡機構的信用卡');
      if (t.amount != null && !same(total, t.amount)) p.push(`分配加總 ${fmtMoney(total, cur, false)} 和銀行扣款 ${fmtMoney(t.amount, cur, false)} 對不上`);
    } else {
      if (!t.toAccount) p.push('轉帳請填轉入的帳戶（toAccount）');
      else if (!accName(t.toAccount)) p.push(`帳戶「${t.toAccount}」不在帳戶清單裡`);
      else if (t.toAccount === t.account) p.push('轉出和轉入不能是同一個帳戶');
      if (t.toAmount != null && !(t.toAmount > 0)) p.push('轉入金額請填大於 0 的數字');
      const to = refs.accounts.find((a) => a.name === t.toAccount);
      if (from && to && from.currency !== to.currency && t.toAmount == null) p.push(`不同幣別（${from.currency} → ${to.currency}）請填轉入金額`);
    }
    if (t.lines.length) p.push('轉帳不能有明細');
    return p;
  }
  if (t.toAccount || t.toAmount != null) p.push('只有轉帳才填轉入帳戶 / 轉入金額');

  if (!t.lines.length) {
    p.push('沒有分類：請在這一列的 category 欄填分類（例：樂 / 數位內容），或按「在 APP 裡補完」');
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
    if (!Number.isFinite(l.amount) || (!signed && !(l.amount > 0))) p.push(`${at}${signed ? '請填金額（負數 = 退款、折扣）' : '分帳、借款、還款的金額請填正數'}`);
    else if (!intOk(l.amount)) p.push(`${at}${cur} 金額請填整數`);
    if (l.kind === '支出' || l.kind === '收入') {
      const c = l.category ? refs.categories.find((x) => x.path === normPath(l.category!)) : null;
      if (!l.category) {
        if (!opts.allowNoCategory) p.push(`${at}請選分類`);
      }
      else if (!c) p.push(`${at}分類「${l.category}」不在分類清單裡`);
      else if (c.kind !== l.kind) p.push(`${at}分類「${l.category}」是${c.kind}分類`);
    }
    if (PERSON_KINDS.includes(l.kind)) {
      if (!l.person) p.push(`${at}請選人物`);
      else if (!refs.people.some((x) => x.name === l.person)) p.push(`${at}人物「${l.person}」不在人物清單裡`);
    }
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
export function accountDelta(t: Pick<Txn, 'account' | 'amount' | 'direction' | 'toAccount' | 'toAmount' | 'cardPayments' | 'payments' | 'origCurrency' | 'twdAmount'>, name: string, currency = 'TWD'): number {
  const sign = t.direction === '入' ? 1 : -1;
  if (t.payments?.length) return sign * t.payments.filter((x) => x.account === name).reduce((n, x) => n + x.amount, 0);
  let d = 0;
  if (t.account === name) d += sign * ((t.origCurrency && currency === 'TWD' ? t.twdAmount : t.amount) ?? 0);
  if (t.direction === '轉帳') {
    if (t.cardPayments.length) d += t.cardPayments.filter((x) => x.account === name).reduce((n, x) => n + x.amount, 0);
    else if (t.toAccount === name) d += t.toAmount ?? t.amount ?? 0;
  }
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
    bal += accountDelta(t, acc.name, acc.currency);
  }
  return roundMoney(bal, acc.currency);
}

export interface PersonBalance {
  person: string;
  currency: string;
  /** 正 = 他欠我；負 = 我欠他 */
  net: number;
}

/**
 * 每個人的淨額（依幣別分開；2026-11-19 起借款和代墊不分）。
 * 淨額＝他欠我＋我還他 − 我欠他 − 他還我
 */
export function personBalances(txns: Txn[], accounts: Pick<Account, 'name' | 'currency'>[]): PersonBalance[] {
  const map = new Map<string, PersonBalance>();
  for (const t of txns) {
    const cur = txnCurrency(t, accounts);
    for (const l of t.lines) {
      if (!l.person || !PERSON_KINDS.includes(l.kind)) continue;
      const key = `${l.person}\u0000${cur}`;
      const b = map.get(key) ?? { person: l.person, currency: cur, net: 0 };
      const sign = l.kind === '他欠我' || l.kind === '我還他' ? 1 : -1;
      b.net += sign * l.amount;
      map.set(key, b);
    }
  }
  return [...map.values()].map((b) => ({ ...b, net: roundMoney(b.net, b.currency) }));
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
    if (!t.date.startsWith(month) || isRecordOnlyTxn(t)) continue;
    const cur = txnReportCurrency(t, accounts);
    for (const l of txnReportLines(t)) {
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
/** 2026-11-19 拿掉「借款」：借錢改用支出 / 收入的人物明細記 */
export const ENTRY_MODES = ['支出', '收入', '轉帳', '還款'] as const;
export type EntryMode = (typeof ENTRY_MODES)[number] | '不用還了' | '調整' | '其他';

export interface EntryForm {
  mode: EntryMode;
  time: number;
  /** 支出 / 收入 / 還款的帳戶；轉帳的轉出帳戶 */
  account: string | null;
  /** 支出：朋友先幫我付（有值時沒有帳戶） */
  paidBy: string | null;
  /** 沒帳戶時的幣別 */
  currency: string | null;
  origCurrency?: string | null;
  twdAmount?: number | null;
  twdStatus?: TwdStatus | null;
  rewardFor?: string | null;
  payments?: PaymentInput[];
  /** 我的部分：分類＋金額（支出 / 收入可拆成好幾筆） */
  cats: { category: string | null; amount: number | null; note?: string | null; budget?: string | null }[];
  /**
   * 同一筆裡方向相反的分類明細：支出畫面是折抵／收入，收入畫面是扣除／支出。
   * （2026-11-21 使用者決定：不另設混合模式，帳戶只依收入與支出的淨額增減。）
   */
  counterCats: { category: string | null; amount: number | null; note?: string | null; budget?: string | null }[];
  /**
   * 選人物的明細（2026-11-19）：支出 = 他欠我（代墊、借給他）；收入 = 我欠他（向他借）。
   * 不算收支、不扣預算、不選分類，可以填備註。
   */
  shares: { person: string | null; amount: number | null; note?: string | null }[];
  /** 還款、不用還了的對象 */
  person: string | null;
  /** 還款：他還我 / 我還他；不用還了：他欠我的不收了 / 我欠他的不用還了 */
  sub: '他還我' | '我還他' | null;
  /** 還款、轉帳的金額 */
  amount: number | null;
  toAccount: string | null;
  toAmount: number | null;
  /** 多張卡繳費時選的發卡機構（只供畫面使用，不另存交易欄位）。 */
  cardPaymentOrg: string | null;
  /** 多張卡／多期帳單的繳款分配。 */
  cardPayments: CardPaymentInput[];
  store: string | null;
  branch: string | null;
  statementText: string | null;
  note: string | null;
  tagIds: string[];
  /** 轉帳到信用卡：繳哪一期（帳單 id） */
  statement?: string | null;
}

export const emptyForm = (mode: EntryForm['mode'] = '支出', time = Date.now()): EntryForm => ({
  mode,
  time,
  account: null,
  paidBy: null,
  currency: null,
  cats: [{ category: null, amount: null }],
  counterCats: [],
  shares: [],
  person: null,
  sub: mode === '還款' ? '他還我' : null,
  amount: null,
  toAccount: null,
  toAmount: null,
  cardPaymentOrg: null,
  cardPayments: [],
  store: null,
  branch: null,
  statementText: null,
  note: null,
  tagIds: [],
});

const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

/** 支出 / 收入畫面的帳戶實際增減＝主要分類＋人物部分−反向分類（朋友先付時只有我的部分） */
export const formTotal = (f: EntryForm) =>
  sum(f.cats.map((c) => c.amount)) + (f.paidBy ? 0 : sum(f.shares.map((s) => s.amount)) - sum(f.counterCats.map((c) => c.amount)));

/** 多卡繳費的銀行實際扣款＝所有勾選期別的分配加總。 */
export const cardPaymentTotal = (f: Pick<EntryForm, 'cardPayments'>) => sum(f.cardPayments.map((x) => x.amount));

/** 表單 → 要存的交易（不檢查；存之前用 checkTxn 檢查） */
export function formToTxn(f: EntryForm): TxnInput {
  const base = { time: f.time, store: f.store?.trim() || null, branch: f.store?.trim() ? f.branch?.trim() || null : null, statementText: f.statementText?.trim() || null, note: f.note?.trim() || null, tagIds: f.tagIds, toAccount: null, toAmount: null, paidBy: null, currency: null };
  const origCurrency = f.origCurrency?.trim().toUpperCase();
  const exchange = origCurrency && origCurrency !== 'TWD'
    ? { origCurrency, twdAmount: f.twdAmount ?? null, twdStatus: f.twdAmount == null ? 'pending' as const : f.twdStatus ?? null }
    : {};
  const payments = f.payments?.filter((x) => x.account || x.amount != null) ?? [];
  const funding = { ...exchange, payments, account: payments.length ? payments[0].account : f.account };
  const cats = (items: EntryForm['cats'], kind: '支出' | '收入'): LineInput[] =>
    items
      .filter((c) => c.category || c.amount != null)
      .map((c) => ({ kind, amount: c.amount ?? Number.NaN, category: c.category, note: c.note ?? null, budget: c.budget ?? null }));
  const shareLines = (kind: '他欠我' | '我欠他'): LineInput[] =>
    f.shares.filter((s) => s.person || s.amount).map((s) => ({ kind, amount: s.amount ?? 0, person: s.person, note: s.note?.trim() || null }));
  switch (f.mode) {
    case '支出': {
      if (f.paidBy) {
        const mine = cats(f.cats, '支出');
        return {
          ...base,
          direction: null,
          account: null,
          amount: null,
          paidBy: f.paidBy,
          currency: f.currency,
          // 朋友先付的退款（我的部分是負的）→ 變成他欠我
          lines: [...mine, { kind: sum(mine.map((l) => l.amount)) < 0 ? '他欠我' : '我欠他', amount: Math.abs(sum(mine.map((l) => l.amount))), person: f.paidBy }],
        };
      }
      // 加總是負的（退款）→ 錢回到帳戶
      const total = formTotal(f);
      return {
        ...base,
        ...funding,
        direction: total < 0 ? '入' : '出',
        amount: Math.abs(total),
        lines: [...cats(f.cats, '支出'), ...cats(f.counterCats, '收入'), ...shareLines('他欠我')],
      };
    }
    case '收入': {
      const total = formTotal(f);
      return {
        ...base,
        ...funding,
        direction: total < 0 ? '出' : '入',
        rewardFor: f.rewardFor,
        amount: Math.abs(total),
        lines: [...cats(f.cats, '收入'), ...cats(f.counterCats, '支出'), ...shareLines('我欠他')],
      };
    }
    case '轉帳': {
      const payments = f.cardPayments.filter((x) => x.account || x.statement || x.amount != null);
      return payments.length
        ? { ...base, direction: '轉帳', account: f.account, amount: cardPaymentTotal({ cardPayments: payments }), cardPayments: payments, statement: null, lines: [] }
        : { ...base, direction: '轉帳', account: f.account, amount: f.amount, toAccount: f.toAccount, toAmount: f.toAmount, statement: f.statement ?? null, lines: [] };
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
          { kind: heOwes ? '支出' : '收入', amount, category: f.cats[0]?.category ?? null, budget: f.cats[0]?.budget ?? null },
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
    origCurrency: null,
    twdAmount: null,
    twdStatus: null,
    payments: [],
    rewardFor: null,
    store: bank,
    branch: null,
    statementText: null,
    note: [purchase.store, '國外交易服務費'].filter(Boolean).join(' '),
    lines: final,
  };
}

export const FEE_CATEGORY_NAME = '國外交易手續費';

/** 這筆本身是不是手續費（每一行的分類都是「…／國外交易手續費」） */
export const isFeeTxn = (t: { lines: { category: string | null }[] }) =>
  t.lines.length > 0 && t.lines.every((l) => !!l.category && lastName(l.category) === FEE_CATEGORY_NAME);

/**
 * 找這筆消費已經記過的手續費（2026-11-18 確認：修改舊資料時可以補記，已記過的不再重複記）。
 * 手續費是另一筆交易、沒有連結，用「同一個時間、同一個帳戶、分類是…／國外交易手續費」判斷。
 */
export function findFeeTxn(txns: Txn[], purchase: Txn): Txn | null {
  return txns.find((t) => t.id !== purchase.id && t.time === purchase.time && t.account === purchase.account && isFeeTxn(t)) ?? null;
}

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

/**
 * 分期（2026-11-18 確認）：一筆拆成 N 筆，每個月同一天（月底對不到就用那個月最後一天），
 * 備註加「1/6 期」；每個明細各自平分，除不盡的零頭放在第 1 期。每一期算在那個月的預算。
 */
export function installmentTxns(tx: TxnInput, n: number, accounts: Pick<Account, 'name' | 'currency'>[]): TxnInput[] {
  if (!Number.isInteger(n) || n < 2 || n > 60) throw new Error('分期期數請填 2–60');
  if (tx.origCurrency || tx.payments?.length) throw new Error('分期請使用單一帳戶幣別與付款帳戶');
  const cur = txnCurrency(tx, accounts);
  const parts = tx.lines.map((l) => splitEven(l.amount, n, 0, cur));
  const date = toDateKey(tx.time);
  const timeOfDay = tx.time - startOfDay(date);
  return Array.from({ length: n }, (_, k) => {
    const lines = tx.lines.map((l, i) => ({ ...l, amount: parts[i][k] }));
    const total = lineBalance(lines).out;
    return {
      ...tx,
      time: startOfDay(addMonthsToDate(date, k)) + timeOfDay,
      direction: total < 0 ? '入' : '出',
      amount: Math.abs(total),
      note: `${k + 1}/${n} 期${tx.note ? `：${tx.note}` : ''}`,
      lines,
    } as TxnInput;
  });
}

/** 交易 → 表單（看不出是哪一種的 → mode「其他」，畫面只能刪除或到試算表改） */
export function txnToForm(t: Txn): EntryForm {
  const f: EntryForm = { ...emptyForm('其他', t.time), store: t.store, branch: t.branch, statementText: t.statementText, note: t.note, tagIds: t.tagIds, account: t.account, currency: t.currency, cats: [] };
  f.origCurrency = t.origCurrency;
  f.twdAmount = t.twdAmount;
  f.twdStatus = t.twdStatus;
  f.rewardFor = t.rewardFor;
  f.payments = t.payments?.map(({ account, amount }) => ({ account, amount }));
  const L = t.lines;
  const only = (...kinds: LineKind[]) => L.length > 0 && L.every((l) => kinds.includes(l.kind));
  const has = (kind: LineKind) => L.some((l) => l.kind === kind);
  const catsOf = (kind: LineKind) => L.filter((l) => l.kind === kind).map((l) => ({ category: l.category, amount: l.amount, note: l.note, budget: l.budget }));
  if (t.direction === '轉帳') {
    return {
      ...f,
      mode: '轉帳',
      amount: t.amount,
      toAccount: t.toAccount,
      toAmount: t.toAmount,
      statement: t.statement,
      cardPayments: t.cardPayments.map((x) => ({ account: x.account, statement: x.statement, amount: x.amount })),
      cardPaymentOrg: null,
    };
  }
  const sharesOf = (kind: LineKind) => L.filter((l) => l.kind === kind).map((l) => ({ person: l.person, amount: l.amount, note: l.note }));
  // 支出＋選人物的明細（代墊、借給別人；只有人物也可以）
  if (t.direction === '出' && only('支出', '他欠我')) return { ...f, mode: '支出', cats: catsOf('支出'), shares: sharesOf('他欠我') };
  // 收入＋選人物的明細（向別人借）
  if (t.direction === '入' && only('收入', '我欠他')) return { ...f, mode: '收入', cats: catsOf('收入'), shares: sharesOf('我欠他') };
  // 同一筆同時有支出和收入：依帳戶實際方向回到原本的支出／收入畫面。
  if (has('支出') && has('收入') && has('他欠我') && only('支出', '收入', '他欠我')) {
    return { ...f, mode: '支出', cats: catsOf('支出'), counterCats: catsOf('收入'), shares: sharesOf('他欠我') };
  }
  if (has('收入') && has('支出') && has('我欠他') && only('收入', '支出', '我欠他')) {
    return { ...f, mode: '收入', cats: catsOf('收入'), counterCats: catsOf('支出'), shares: sharesOf('我欠他') };
  }
  if (t.direction === '出' && has('支出') && has('收入') && only('支出', '收入')) {
    return { ...f, mode: '支出', cats: catsOf('支出'), counterCats: catsOf('收入') };
  }
  if (t.direction === '入' && has('收入') && has('支出') && only('收入', '支出')) {
    return { ...f, mode: '收入', cats: catsOf('收入'), counterCats: catsOf('支出') };
  }
  if (!t.direction && t.paidBy && only('支出', '我欠他') && L.filter((l) => l.kind === '我欠他').length === 1) {
    const debt = L.find((l) => l.kind === '我欠他')!;
    const mine = catsOf('支出');
    if (debt.person === t.paidBy && same(debt.amount, sum(mine.map((c) => c.amount)))) return { ...f, mode: '支出', paidBy: t.paidBy, cats: mine };
  }
  // 退款（負的支出）、負的收入
  if (t.direction === '入' && only('支出')) return { ...f, mode: '支出', cats: catsOf('支出') };
  if (t.direction === '出' && only('收入')) return { ...f, mode: '收入', cats: catsOf('收入') };
  if (L.length === 1) {
    const l = L[0];
    if (t.direction === '入' && l.kind === '他還我') return { ...f, mode: '還款', sub: '他還我', person: l.person, amount: l.amount };
    if (t.direction === '出' && l.kind === '我還他') return { ...f, mode: '還款', sub: '我還他', person: l.person, amount: l.amount };
  }
  if (!t.direction && L.length === 2) {
    const exp = L.find((l) => l.kind === '支出');
    const inc = L.find((l) => l.kind === '收入');
    const back = L.find((l) => l.kind === '他還我');
    const pay = L.find((l) => l.kind === '我還他');
    if (exp && back && same(exp.amount, back.amount)) return { ...f, mode: '不用還了', sub: '他還我', person: back.person, amount: back.amount, cats: [{ category: exp.category, amount: exp.amount, budget: exp.budget }] };
    if (inc && pay && same(inc.amount, pay.amount)) return { ...f, mode: '不用還了', sub: '我還他', person: pay.person, amount: pay.amount, cats: [{ category: inc.category, amount: inc.amount, budget: inc.budget }] };
  }
  if (only('調整')) return { ...f, mode: '調整', amount: t.amount };
  return f;
}

const SYSTEM_TXN_NOTE = /^(?:\d+\/\d+ 期|開定存|定存利息|定存到期解約|盤點調整)/;

/** 系統產生或 APP 無法完整重建的交易不提供複製。（2026-11-21 使用者決定） */
export function canCopyTxn(t: Txn): boolean {
  const form = txnToForm(t);
  const editable = ENTRY_MODES.includes(form.mode as (typeof ENTRY_MODES)[number]) || form.mode === '不用還了';
  if (!editable || isFeeTxn(t) || t.cardPayments.length) return false;
  if (t.lines.some((line) => line.kind === '調整')) return false;
  return !SYSTEM_TXN_NOTE.test(t.note?.trim() ?? '');
}

/**
 * 既有交易 → 尚未儲存的新交易草稿。
 * 保留使用者輸入內容；清除交易編號（由新存檔產生）、帳單／對帳狀態、標籤及系統附屬關係。
 */
export function copyTxnForm(t: Txn, time: number): EntryForm {
  if (!canCopyTxn(t)) throw new Error('這筆是系統產生的交易，不能複製');
  const f = txnToForm(t);
  // 多筆外幣付款金額取自原入帳，複製時回到單一帳戶、等待新的台幣金額。
  return { ...f, time, statement: null, statementText: null, tagIds: [], rewardFor: null,
    ...(f.origCurrency ? { twdAmount: null, twdStatus: 'pending' as const, payments: [] } : {}) };
}

/** 一筆交易的標題（例：食 / 三餐、轉帳 → 悠遊卡、借給 小明） */
/** 明細有沒選分類的（支出 / 收入）：記帳列表提醒補 */
export const txnMissingCategory = (t: Pick<Txn, 'lines'>) => t.lines.some((l) => (l.kind === '支出' || l.kind === '收入') && !l.category);

export function txnTitle(t: Txn): string {
  const f = txnToForm(t);
  switch (f.mode) {
    case '支出':
    case '收入': {
      // 只有人物（借給別人 / 向別人借）
      if (!f.cats.length && f.shares.length) {
        const names = [...new Set(f.shares.map((s) => s.person ?? ''))].join('、');
        return f.mode === '支出' ? `${names} 欠我` : `我欠 ${names}`;
      }
      const cats = [...new Set(f.cats.map((c) => c.category ?? ''))];
      return cats.length > 1 ? `${cats[0]} 等 ${cats.length} 類` : cats[0] || f.mode;
    }
    case '轉帳':
      return t.cardPayments.length ? `繳卡費 → ${new Set(t.cardPayments.map((x) => x.account)).size} 張卡` : `轉帳 → ${t.toAccount ?? ''}`;
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

/** 純記錄用的 0 元交易；包含收入／支出互抵為 0，不能含人物、借還款或轉帳。 */
export function isRecordOnlyTxn(t: Pick<Txn, 'amount' | 'lines'>): boolean {
  return t.amount === 0 && t.lines.length > 0 && t.lines.every((l) => l.kind === '支出' || l.kind === '收入');
}

/** 這筆交易「我」的收支（列表顯示用）：支出 − 收入（正 = 花錢） */
export function txnMyNet(t: Txn, converted = false): { expense: number; income: number } {
  if (isRecordOnlyTxn(t)) return { expense: 0, income: 0 };
  let expense = 0;
  let income = 0;
  for (const l of converted ? txnReportLines(t) : t.lines) {
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
    const [accRows, catRows, txRows, lineRows, cardPaymentRows, paymentRows, peopleRows, orgRows, setRows, budgetRows, allocRows, depRows, stmtRows, itemRows, checkRows, sharedTags] = await Promise.all([
      this.b.read('moneyAccounts'),
      this.b.read('moneyCategories'),
      this.b.read('moneyTransactions'),
      this.b.read('moneyLines'),
      this.b.read('moneyCardPayments'),
      this.b.read('moneyPayments'),
      this.b.read('hubPeople'),
      this.b.read('hubOrganizations'),
      this.b.read('moneySettings'),
      this.b.read('moneyBudgets'),
      this.b.read('moneyBudgetAllocations'),
      this.b.read('moneyDeposits'),
      this.b.read('moneyStatements'),
      this.b.read('moneyStatementItems'),
      this.b.read('moneyBalanceChecks'),
      loadSharedTags(this.b, now),
    ]);
    const issues: MoneyIssue[] = [];
    const fixes = new Map<TableName, RowUpdate[]>();
    const fix = (t: TableName, u: RowUpdate) => fixes.set(t, [...(fixes.get(t) ?? []), u]);
    const issue = (table: TableName, r: TableRow, problems: string[], draft?: EntryForm) =>
      issues.push({ table, rowNumber: r.rowNumber, id: str(r.values.id), raw: r.raw, problems, ...(draft ? { draft } : {}) });
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
    const budgets = loadList('moneyBudgets', budgetRows, 'name', '預算名稱', toBudget, (r) =>
      ['ideal', 'basic', 'goal'].filter((k) => r.errors.includes(k)).map((k) => `${k} 請填數字`),
    ).sort(bySort);
    const budgetNames = new Set(budgets.map((b) => b.name));
    const allocations: Allocation[] = [];
    for (const r of allocRows) {
      if (!isLive(r)) continue;
      const p: string[] = [];
      const month = str(r.values.month);
      const kind = str(r.values.kind);
      const budget = str(r.values.budget);
      if (!month || !/^\d{4}-\d{2}$/.test(month)) p.push('month 請填 YYYY-MM（例：2026-11）');
      if (!budget) p.push('沒有填預算');
      else if (!budgetNames.has(budget)) p.push(`預算「${budget}」不在預算清單裡`);
      if (!has(ALLOC_KINDS, kind)) p.push(`kind 請填：${ALLOC_KINDS.join('、')}`);
      if (num(r.values.amount) == null) p.push('金額請填數字');
      if (kind === '期初' && !str(r.values.date)) p.push('期初請填 date（從哪一天開始算）');
      if (p.length) {
        issue('moneyBudgetAllocations', r, p);
        continue;
      }
      ensureId('moneyBudgetAllocations', r);
      allocations.push(toAllocation(r));
    }
    const orgs = loadList('hubOrganizations', orgRows, 'name', '機構名稱', toOrg).sort(bySort);

    // 交易：先讀明細，再依交易分組
    const linesByTx = new Map<string, { row: TableRow; line: Line }[]>();
    for (const r of lineRows) {
      if (!isLive(r)) continue;
      const tx = str(r.values.transaction);
      if (r.errors.includes('amount')) {
        issue('moneyLines', r, [...(tx ? [] : ['沒有填 transaction（屬於哪筆交易）']), '金額格式看不懂']);
        continue;
      }
      if (!tx) {
        issue('moneyLines', r, ['沒有填 transaction（屬於哪筆交易）']);
        issues[issues.length - 1].orphan = { group: null, line: toLine(r) };
        continue;
      }
      ensureId('moneyLines', r);
      linesByTx.set(tx, [...(linesByTx.get(tx) ?? []), { row: r, line: toLine(r) }]);
    }
    const cardPaymentsByTx = new Map<string, { row: TableRow; payment: CardPayment }[]>();
    for (const r of cardPaymentRows) {
      if (!isLive(r)) continue;
      const v = r.values;
      const tx = str(v.transaction);
      const account = str(v.account);
      const statement = str(v.statement);
      const amount = num(v.amount);
      const p: string[] = [];
      if (!tx) p.push('沒有填 transaction（銀行扣款交易）');
      const card = account ? accounts.find((a) => a.name === account) : null;
      if (!account) p.push('沒有填信用卡帳戶');
      else if (!card) p.push(`帳戶「${account}」不在帳戶清單裡`);
      else if (card.type !== '信用卡') p.push(`帳戶「${account}」不是信用卡`);
      if (!statement) p.push('沒有填 statement（帳單期別）');
      if (amount == null || !(amount > 0)) p.push(r.errors.includes('amount') ? '金額格式看不懂' : '金額請填大於 0 的數字');
      if (p.length) {
        issue('moneyCardPayments', r, p);
        continue;
      }
      ensureId('moneyCardPayments', r);
      cardPaymentsByTx.set(tx!, [...(cardPaymentsByTx.get(tx!) ?? []), { row: r, payment: toCardPayment(r) }]);
    }
    const paymentsByTx = new Map<string, { row: TableRow; payment: Payment }[]>();
    for (const r of paymentRows) {
      if (!isLive(r)) continue;
      const transaction = str(r.values.transaction);
      const account = str(r.values.account);
      const amount = num(r.values.amount);
      if (!transaction || !account || amount == null || amount <= 0) {
        issue('moneyPayments', r, ['付款明細須填交易、帳戶與正數金額']);
      }
      if (!transaction) continue;
      const id = ensureId('moneyPayments', r);
      const payment = { id, rowNumber: r.rowNumber, account: account ?? '', amount: amount ?? NaN, sort: num(r.values.sort) };
      paymentsByTx.set(transaction, [...(paymentsByTx.get(transaction) ?? []), { row: r, payment }]);
    }
    const refs: MoneyRefs = { accounts, categories, people };
    const txns: Txn[] = [];
    const usedTx = new Set<string>();
    // 快速輸入（2026-11-18）：試算表的交易填了 category → 自動建立明細
    const quickLines: RowValues[] = [];
    const quickClear: RowUpdate[] = [];
    for (const r of txRows) {
      if (!isLive(r)) continue;
      if (r.errors.includes('time') || num(r.values.time) == null) {
        issue('moneyTransactions', r, [r.errors.includes('time') ? '時間格式看不懂（例：2026/11/18 12:30）' : '沒有填時間']);
        continue;
      }
      const bad = ['amount', 'toAmount', 'postedDate', 'twdAmount', 'paymentCount'].filter((k) => r.errors.includes(k));
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
      const cardPayments = (cardPaymentsByTx.get(id) ?? []).map((x) => x.payment).sort(bySort);
      const payments = (paymentsByTx.get(id) ?? []).map((x) => x.payment).sort(bySort);
      const t = toTxn(r, lines, cardPayments, payments);
      // 試算表直接填負數 = 退款（2026-11-18 使用者要求）：出 −3065 就是入 3065
      if ((t.direction === '出' || t.direction === '入') && t.amount != null && t.amount < 0) {
        t.direction = t.direction === '出' ? '入' : '出';
        t.amount = -t.amount;
      }
      const dir = str(r.values.direction);
      const quickCat = str(r.values.category) ? normPath(str(r.values.category)!) : null;
      const quickBudget = str(r.values.budget);
      if (!lines.length && quickCat && (t.direction === '出' || t.direction === '入') && t.amount != null && has(DIRECTIONS, dir)) {
        const c = categories.find((x) => x.path === quickCat);
        if (c) {
          // 支出分類：出是正、入（退款）是負；收入分類相反
          const sign = (c.kind === '支出') === (t.direction === '出') ? 1 : -1;
          quickLines.push({
            transaction: id,
            kind: c.kind,
            amount: sign * t.amount,
            category: c.path,
            budget: quickBudget && budgets.some((b) => b.name === quickBudget) ? quickBudget : null,
            sort: 1,
            id: newId(now),
            createdAt: now,
            updatedAt: now,
          });
          quickClear.push({ rowNumber: r.rowNumber, values: { category: null, budget: null, updatedAt: now }, expectId: id });
          continue;
        }
      }
      const p = dir && !has(DIRECTIONS, dir) ? [`direction「${dir}」看不懂（請填：出、入、轉帳）`] : checkTxn(t, refs, { allowNoCategory: true });
      const paymentCount = num(r.values.paymentCount);
      if (paymentCount != null && paymentCount !== payments.length) p.unshift(`付款明細應有 ${paymentCount} 筆，目前有 ${payments.length} 筆`);
      if (quickCat && !categories.some((x) => x.path === quickCat)) p.unshift(`分類「${quickCat}」不在分類清單裡（請在「🏷️ 分類」新增，或改成清單裡的名稱）`);
      if (p.length) {
        // 沒有明細：準備「在 APP 裡補完」的表單（試算表填的負數照原樣 = 退款）
        let draft: EntryForm | undefined;
        if (!lines.length && dir !== '轉帳') {
          const rawAmt = num(r.values.amount);
          draft = {
            ...emptyForm(dir === '入' ? '收入' : '支出', t.time),
            account: t.account,
            origCurrency: t.origCurrency,
            twdAmount: t.twdAmount,
            twdStatus: t.twdStatus,
            rewardFor: t.rewardFor,
            payments: t.payments,
            store: t.store,
            branch: t.branch,
            statementText: t.statementText,
            note: t.note,
            tagIds: t.tagIds,
            cats: [{ category: quickCat && categories.some((x) => x.path === quickCat) ? quickCat : null, amount: rawAmt, budget: quickBudget }],
          };
        }
        issue('moneyTransactions', r, p, draft);
        // 只缺分類（沒有其他問題）→ 可以整批補分類
        if (draft && !t.origCurrency && !t.payments?.length && !t.rewardFor && p.every((m) => m.startsWith('沒有分類') || m.startsWith('分類「'))) issues[issues.length - 1].needsCategory = draft.mode === '收入' ? '收入' : '支出';
        continue;
      }
      txns.push(t);
    }
    // 找不到交易的明細
    for (const [tx, ls] of linesByTx) {
      if (usedTx.has(tx)) continue;
      for (const { row, line } of ls) {
        issue('moneyLines', row, [`找不到交易「${tx}」`]);
        issues[issues.length - 1].orphan = { group: tx, line };
      }
    }
    for (const [tx, xs] of cardPaymentsByTx) {
      if (usedTx.has(tx)) continue;
      for (const { row } of xs) issue('moneyCardPayments', row, [`找不到銀行扣款交易「${tx}」`]);
    }
    for (const [tx, xs] of paymentsByTx) {
      if (usedTx.has(tx)) continue;
      for (const { row } of xs) issue('moneyPayments', row, [`找不到交易「${tx}」`]);
    }

    for (const [t, us] of fixes) await this.b.update(t, us);
    if (quickLines.length) {
      await this.b.append('moneyLines', quickLines);
      await this.b.update('moneyTransactions', quickClear);
      return this.loadNow(now);
    }
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

    // 定存單
    const deposits: Deposit[] = [];
    for (const r of depRows) {
      if (!isLive(r)) continue;
      const v = r.values;
      const p: string[] = [];
      const acc = str(v.account);
      if (!acc) p.push('沒有填定存帳戶');
      else if (!accounts.some((a) => a.name === acc)) p.push(`帳戶「${acc}」不在帳戶清單裡`);
      if (!(num(v.principal)! > 0)) p.push('本金請填大於 0 的數字');
      if (!str(v.startDate)) p.push('沒有填起存日');
      if (!str(v.maturityDate)) p.push('沒有填到期日');
      for (const k of ['rate', 'startDate', 'maturityDate', 'endedDate', 'termMonths']) if (r.errors.includes(k)) p.push(`${k} 格式看不懂`);
      if (p.length) {
        issue('moneyDeposits', r, p);
        continue;
      }
      ensureId('moneyDeposits', r);
      deposits.push({
        rowNumber: r.rowNumber,
        id: String(v.id),
        account: acc!,
        principal: num(v.principal)!,
        rate: num(v.rate),
        startDate: str(v.startDate)!,
        maturityDate: str(v.maturityDate)!,
        termMonths: num(v.termMonths),
        fromAccount: str(v.fromAccount),
        endedDate: str(v.endedDate),
        note: str(v.note),
      });
    }
    deposits.sort((a, b) => Number(!!a.endedDate) - Number(!!b.endedDate) || a.maturityDate.localeCompare(b.maturityDate));

    // 帳單、帳單明細、盤點（2026-11-18 第 3 輪）
    const accNames = new Set(accounts.map((a) => a.name));
    const accProblem = (acc: string | null) => (!acc ? ['沒有填帳戶'] : accNames.has(acc) ? [] : [`帳戶「${acc}」不在帳戶清單裡`]);
    const statements: Statement[] = [];
    for (const r of stmtRows) {
      if (!isLive(r)) continue;
      const v = r.values;
      const acc = str(v.account);
      const close = str(v.closeDate);
      const p = accProblem(acc);
      if (!close) p.push(r.errors.includes('closeDate') ? 'closeDate 格式看不懂' : '沒有填結帳日');
      else if (statements.some((x) => x.account === acc && x.closeDate === close)) p.push(`${acc} ${close} 這一期重複了`);
      for (const k of ['dueDate', 'amountDue']) if (r.errors.includes(k)) p.push(`${k} 格式看不懂`);
      if (p.length) {
        issue('moneyStatements', r, p);
        continue;
      }
      ensureId('moneyStatements', r);
      statements.push({ rowNumber: r.rowNumber, id: String(v.id), account: acc!, closeDate: close!, dueDate: str(v.dueDate), amountDue: num(v.amountDue), doneAt: num(v.doneAt), note: str(v.note) });
    }
    const statementItems: StatementItem[] = [];
    for (const r of itemRows) {
      if (!isLive(r)) continue;
      const v = r.values;
      const acc = str(v.account);
      const p = accProblem(acc);
      if (!str(v.closeDate)) p.push(r.errors.includes('closeDate') ? 'closeDate 格式看不懂' : '沒有填哪一期（closeDate 結帳日）');
      if (num(v.amount) == null) p.push(r.errors.includes('amount') ? '金額格式看不懂' : '沒有填金額');
      for (const k of ['date', 'postedDate', 'origAmount']) if (r.errors.includes(k)) p.push(`${k} 格式看不懂`);
      if (p.length) {
        issue('moneyStatementItems', r, p);
        continue;
      }
      ensureId('moneyStatementItems', r);
      statementItems.push({
        rowNumber: r.rowNumber,
        id: String(v.id),
        account: acc!,
        closeDate: str(v.closeDate)!,
        date: str(v.date),
        postedDate: str(v.postedDate),
        description: str(v.description),
        amount: num(v.amount)!,
        origCurrency: str(v.origCurrency)?.toUpperCase() ?? null,
        origAmount: num(v.origAmount),
        matched: (str(v.matched) ?? '').split(/[,，\s]+/).filter(Boolean),
      });
    }
    // 試算表直接貼的帳單明細：那一期還沒有帳單 → 自動建立
    const newStmts = new Map<string, RowValues>();
    for (const it of statementItems) {
      const key = `${it.account}\u0000${it.closeDate}`;
      if (newStmts.has(key) || statements.some((x) => x.account === it.account && x.closeDate === it.closeDate)) continue;
      const acc = accounts.find((a) => a.name === it.account)!;
      newStmts.set(key, { account: it.account, closeDate: it.closeDate, dueDate: dueDateFor(acc, it.closeDate), id: newId(now), createdAt: now, updatedAt: now });
    }
    for (const [t, us] of fixes) if (t === 'moneyStatements' || t === 'moneyStatementItems') await this.b.update(t, us);
    if (newStmts.size) {
      await this.b.append('moneyStatements', [...newStmts.values()]);
      return this.loadNow(now);
    }
    statements.sort((a, b) => a.closeDate.localeCompare(b.closeDate));
    const balanceChecks: BalanceCheck[] = [];
    for (const r of checkRows) {
      if (!isLive(r)) continue;
      const v = r.values;
      const p = accProblem(str(v.account));
      if (!str(v.date)) p.push(r.errors.includes('date') ? '日期格式看不懂' : '沒有填日期');
      if (num(v.actual) == null) p.push(r.errors.includes('actual') ? '實際餘額格式看不懂' : '沒有填實際餘額');
      if (p.length) {
        issue('moneyBalanceChecks', r, p);
        continue;
      }
      ensureId('moneyBalanceChecks', r);
      balanceChecks.push({ rowNumber: r.rowNumber, id: String(v.id), account: str(v.account)!, date: str(v.date)!, actual: num(v.actual)!, bookSnapshot: num(v.bookSnapshot), note: str(v.note) });
    }
    balanceChecks.sort((a, b) => a.date.localeCompare(b.date) || a.rowNumber - b.rowNumber);
    const late = fixes.get('moneyBalanceChecks');
    if (late) await this.b.update('moneyBalanceChecks', late);

    const snap: MoneySnapshot = { loadedAt: now, accounts, categories, people, orgs, sharedTags, txns, budgets, allocations, deposits, statements, statementItems, balanceChecks, settings: parseMoneySettings(setRows), issues };
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
    const p = checkTxn(input, { ...snap, statements: snap.statements });
    if (p.length) throw new Error(p.join('；'));
    if (input.rewardFor && input.rewardFor !== existing?.rewardFor && !snap.txns.some((t) => t.id === input.rewardFor && t.id !== existing?.id && t.lines.some((l) => l.kind === '支出' && l.amount > 0))) {
      throw new Error('找不到這筆回饋對應的原消費');
    }
    if (input.store && !snap.orgs.some((o) => o.name === input.store)) await this.addOrg(input.store);
    const now = Date.now();
    const cur = txnCurrency(input, snap.accounts);
    const r = (n: number | null) => (n == null ? null : roundMoney(n, cur));
    const multiCard = (input.cardPayments?.length ?? 0) > 0;
    const toCur = input.toAccount ? txnCurrency({ account: input.toAccount, currency: null }, snap.accounts) : cur;
    const txValues: RowValues = {
      time: input.time,
      date: toDateKey(input.time),
      direction: input.direction,
      account: input.account,
      amount: r(input.amount),
      paidBy: input.paidBy,
      currency: input.account ? null : input.currency && input.currency !== 'TWD' ? input.currency : null,
      toAccount: multiCard ? null : input.toAccount,
      toAmount: multiCard || input.toAmount == null ? null : roundMoney(input.toAmount, toCur),
      store: input.store,
      branch: input.branch,
      statementText: input.statementText,
      note: input.note,
      tagIds: writeTagIds(input.tagIds),
      origCurrency: input.origCurrency ?? null,
      twdAmount: input.twdAmount ?? null,
      twdStatus: input.origCurrency ? input.twdStatus ?? 'pending' : null,
      rewardFor: input.rewardFor ?? null,
      paymentCount: input.payments?.length || null,
      updatedAt: now,
    };
    // 繳哪一期：只有轉到信用卡才留
    if (multiCard) txValues.statement = null;
    else if (input.statement !== undefined) {
      const ok = input.direction === '轉帳' && snap.statements.some((s) => s.id === input.statement && s.account === input.toAccount);
      txValues.statement = ok ? input.statement : null;
    }
    const lineValues = (l: LineInput, i: number): RowValues => ({
      kind: l.kind,
      amount: roundMoney(l.amount, cur),
      category: l.category ? normPath(l.category) : null,
      person: l.person ?? null,
      budget: l.budget ?? null,
      note: l.note ?? null,
      sort: i + 1,
      updatedAt: now,
    });
    const paymentValues = (x: CardPaymentInput, i: number): RowValues => ({
      account: x.account,
      statement: x.statement,
      amount: roundMoney(x.amount!, cur),
      sort: i + 1,
      updatedAt: now,
    });
    const payments = input.cardPayments ?? [];
    const funding = input.payments ?? [];
    const fundingValues = (x: PaymentInput, i: number): RowValues => ({ account: x.account, amount: x.amount, sort: i + 1, updatedAt: now });
    const appendFunding = (id: string, start: number) => funding.slice(start).map((x, i) => ({ ...fundingValues(x, start + i), transaction: id, id: newId(now), createdAt: now }));

    if (!existing) {
      const id = newId(now);
      await this.b.append('moneyTransactions', [{ ...txValues, id, createdVia: this.via, createdAt: now }]);
      if (input.lines.length) {
        await this.b.append(
          'moneyLines',
          input.lines.map((l, i) => ({ ...lineValues(l, i), transaction: id, id: newId(now), createdAt: now })),
        );
      }
      if (payments.length) {
        await this.b.append(
          'moneyCardPayments',
          payments.map((x, i) => ({ ...paymentValues(x, i), transaction: id, id: newId(now), createdAt: now })),
        );
      }
      if (funding.length) await this.b.append('moneyPayments', appendFunding(id, 0));
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
    // 「需要補齊」會用舊交易列組成暫時 existing；它沒有完整的巢狀資料。
    const oldPayments = existing.cardPayments ?? [];
    const paymentUpdates: RowUpdate[] = [];
    const paymentAppends: RowValues[] = [];
    payments.forEach((x, i) => {
      const old = oldPayments[i];
      if (old) paymentUpdates.push({ rowNumber: old.rowNumber, values: paymentValues(x, i), expectId: old.id });
      else paymentAppends.push({ ...paymentValues(x, i), transaction: existing.id, id: newId(now), createdAt: now });
    });
    for (const old of oldPayments.slice(payments.length)) paymentUpdates.push({ rowNumber: old.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: old.id });
    if (paymentUpdates.length) await this.b.update('moneyCardPayments', paymentUpdates);
    if (paymentAppends.length) await this.b.append('moneyCardPayments', paymentAppends);
    const oldFunding = existing.payments ?? [];
    if (oldFunding.length) await this.b.update('moneyPayments', oldFunding.map((x, i) => ({
      rowNumber: x.rowNumber,
      values: i < funding.length ? fundingValues(funding[i], i) : { deletedAt: now, updatedAt: now },
      expectId: x.id,
    })));
    if (funding.length > oldFunding.length) await this.b.append('moneyPayments', appendFunding(existing.id, oldFunding.length));
    return existing.id;
  }

  /** 刪除只做標記（交易和明細一起） */
  async deleteTxn(t: Txn) {
    const now = Date.now();
    await this.b.update('moneyTransactions', [{ rowNumber: t.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: t.id }]);
    if (t.payments?.length) await this.b.update('moneyPayments', t.payments.map((x) => ({ rowNumber: x.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: x.id })));
    if (t.lines.length) {
      await this.b.update(
        'moneyLines',
        t.lines.map((l) => ({ rowNumber: l.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: l.id })),
      );
    }
    if (t.cardPayments.length) {
      await this.b.update(
        'moneyCardPayments',
        t.cardPayments.map((x) => ({ rowNumber: x.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: x.id })),
      );
    }
  }

  // ── 帳戶 ──

  async saveAccount(input: Omit<Account, 'rowNumber' | 'id' | 'sort' | 'last4'> & { sort?: number | null; last4?: string | null }, existing?: Account) {
    const snap = await this.fresh();
    const name = input.name.trim();
    if (!name) throw new Error('請填帳戶名稱');
    if (snap.accounts.some((a) => a.name === name && a.id !== existing?.id)) throw new Error(`已經有「${name}」這個帳戶`);
    if (!has(ACCOUNT_TYPES, input.type)) throw new Error('請選帳戶類型');
    const currency = (input.currency.trim() || 'TWD').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('幣別請填 3 個英文字母（例：TWD、USD、JPY）');
    if (existing && existing.currency !== currency && snap.txns.some((t) => t.account === existing.name || t.toAccount === existing.name || t.cardPayments.some((x) => x.account === existing.name) || t.payments?.some((x) => x.account === existing.name))) {
      throw new Error('這個帳戶已經有紀錄，不能改幣別');
    }
    if ((input.openingDate == null) !== (input.openingBalance == null)) throw new Error('期初餘額的日期和金額要一起填（或都不填）');
    if (input.last4 && !/^\d{1,8}$/.test(input.last4.trim())) throw new Error('後幾碼請填數字（例：5009）');
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
      last4: input.last4?.trim() || null,
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
      // 帳單、帳單明細、盤點、定存單也一起改
      const rename = async (table: TableName, list: { rowNumber: number; id: string; account: string }[]) => {
        const xs = list.filter((x) => x.account === from).map((x) => ({ rowNumber: x.rowNumber, values: { account: to, updatedAt: now }, expectId: x.id }));
        if (xs.length) await this.b.update(table, xs);
      };
      await rename('moneyStatements', snap.statements);
      await rename('moneyStatementItems', snap.statementItems);
      await rename('moneyBalanceChecks', snap.balanceChecks);
      await rename('moneyDeposits', snap.deposits);
      await rename('moneyPayments', snap.txns.flatMap((t) => t.payments ?? []));
      const paymentUs = snap.txns
        .flatMap((t) => t.cardPayments)
        .filter((x) => x.account === from)
        .map((x) => ({ rowNumber: x.rowNumber, values: { account: to, updatedAt: now }, expectId: x.id }));
      if (paymentUs.length) await this.b.update('moneyCardPayments', paymentUs);
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

  addTag(name: string) {
    return addSharedTag(this.b, name);
  }

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

  /** 修改機構：改名時帳戶、交易店家與健檢醫院一起改（2026-11-23 使用者決定：健檢醫院使用共用機構） */
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
    const labRows = await this.b.read('healthLabReports');
    const reports = labRows
      .filter((r) => !r.empty && !r.values.deletedAt && r.values.place === o.name)
      .map((r) => ({ rowNumber: r.rowNumber, values: { place: to, updatedAt: now }, expectId: String(r.values.id ?? '') }));
    if (reports.length) await this.b.update('healthLabReports', reports);
  }

  // ── 定存單（2026-11-18 確認：每個幣別一個定存帳戶，裡面放多張定存單） ──

  /** 開定存：記一筆「活存 → 定存」的轉帳，同時建立定存單 */
  async openDeposit(input: { fromAccount: string; account: string; principal: number; rate: number | null; startDate: string; maturityDate: string; termMonths: number | null; note: string | null }) {
    const snap = await this.fresh();
    const dep = snap.accounts.find((a) => a.name === input.account);
    if (!dep || dep.type !== '定存') throw new Error('請選定存帳戶（類型是「定存」的帳戶）');
    if (!(input.principal > 0)) throw new Error('本金請填大於 0 的數字');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.maturityDate)) throw new Error('請填起存日和到期日');
    if (input.maturityDate <= input.startDate) throw new Error('到期日要在起存日之後');
    if (input.rate != null && (!Number.isFinite(input.rate) || input.rate < 0)) throw new Error('利率請填 0 以上的數字');
    await this.saveTxn({
      time: startOfDay(input.startDate) + 9 * 3600000,
      direction: '轉帳',
      account: input.fromAccount,
      amount: input.principal,
      paidBy: null,
      currency: null,
      toAccount: input.account,
      toAmount: null,
      store: dep.org,
      branch: null,
      statementText: null,
      note: input.note ? `開定存：${input.note}` : '開定存',
      tagIds: [],
      lines: [],
    });
    const now = Date.now();
    await this.b.append('moneyDeposits', [
      {
        account: input.account,
        principal: roundMoney(input.principal, dep.currency),
        rate: input.rate,
        startDate: input.startDate,
        maturityDate: input.maturityDate,
        termMonths: input.termMonths,
        fromAccount: input.fromAccount,
        note: input.note?.trim() || null,
        id: newId(now),
        createdAt: now,
        updatedAt: now,
      },
    ]);
  }

  /** 利息記成收入（分類：利息，沒有就用第一個收入分類） */
  private async interestTxn(snap: MoneySnapshot, account: string, interest: number, date: string, dep: Deposit) {
    const cat = snap.categories.find((c) => c.path === '利息' && c.kind === '收入') ?? snap.categories.find((c) => c.kind === '收入' && !c.archived);
    if (!cat) throw new Error('請先建立收入分類（例：利息）');
    const acc = snap.accounts.find((a) => a.name === dep.account);
    await this.saveTxn({
      time: startOfDay(date) + 9 * 3600000,
      direction: '入',
      account,
      amount: interest,
      paidBy: null,
      currency: null,
      toAccount: null,
      toAmount: null,
      store: acc?.org ?? null,
      branch: null,
      statementText: null,
      note: `定存利息（本金 ${dep.principal.toLocaleString()}）`,
      tagIds: [],
      lines: [{ kind: '收入', amount: interest, category: cat.path }],
    });
  }

  /** 解約回活存：本金轉回（轉帳），利息記收入，定存單收進「已結束」 */
  async closeDeposit(dep: Deposit, input: { toAccount: string; interest: number; date: string }) {
    const snap = await this.fresh();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('請選日期');
    if (!Number.isFinite(input.interest) || input.interest < 0) throw new Error('利息請填 0 以上的數字');
    await this.saveTxn({
      time: startOfDay(input.date) + 9 * 3600000,
      direction: '轉帳',
      account: dep.account,
      amount: dep.principal,
      paidBy: null,
      currency: null,
      toAccount: input.toAccount,
      toAmount: null,
      store: snap.accounts.find((a) => a.name === dep.account)?.org ?? null,
      branch: null,
      statementText: null,
      note: '定存到期解約',
      tagIds: [],
      lines: [],
    });
    if (input.interest > 0) await this.interestTxn(snap, input.toAccount, input.interest, input.date, dep);
    await this.b.update('moneyDeposits', [{ rowNumber: dep.rowNumber, values: { endedDate: input.date, updatedAt: Date.now() }, expectId: dep.id }]);
  }

  /** 續存：同一張定存單換新的到期日；利息可以選「一起存進去」（本金增加）或轉到別的帳戶 */
  async renewDeposit(dep: Deposit, input: { maturityDate: string; interest: number; interestTo: 'deposit' | string; rate: number | null }) {
    const snap = await this.fresh();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.maturityDate) || input.maturityDate <= dep.maturityDate) throw new Error('新的到期日要在原本的到期日之後');
    if (!Number.isFinite(input.interest) || input.interest < 0) throw new Error('利息請填 0 以上的數字');
    const toDeposit = input.interestTo === 'deposit';
    if (input.interest > 0) await this.interestTxn(snap, toDeposit ? dep.account : input.interestTo, input.interest, dep.maturityDate, dep);
    const acc = snap.accounts.find((a) => a.name === dep.account);
    await this.b.update('moneyDeposits', [
      {
        rowNumber: dep.rowNumber,
        values: {
          startDate: dep.maturityDate,
          maturityDate: input.maturityDate,
          principal: toDeposit ? roundMoney(dep.principal + input.interest, acc?.currency ?? 'TWD') : dep.principal,
          rate: input.rate,
          updatedAt: Date.now(),
        },
        expectId: dep.id,
      },
    ]);
  }

  /** 修改定存單（只改資料，不動交易） */
  async updateDeposit(dep: Deposit, patch: { rate?: number | null; maturityDate?: string; note?: string | null }) {
    const v: RowValues = { updatedAt: Date.now() };
    if (patch.rate !== undefined) v.rate = patch.rate;
    if (patch.maturityDate !== undefined) v.maturityDate = patch.maturityDate;
    if (patch.note !== undefined) v.note = patch.note?.trim() || null;
    await this.b.update('moneyDeposits', [{ rowNumber: dep.rowNumber, values: v, expectId: dep.id }]);
  }

  // ── 預算 ──

  async saveBudget(input: { name: string; ideal: number | null; basic: number | null; monthly: boolean; goal: number | null; archived: boolean; note: string | null }, existing?: Budget) {
    const snap = await this.fresh();
    const name = input.name.trim();
    if (!name) throw new Error('請填預算名稱');
    if (snap.budgets.some((b) => b.name === name && b.id !== existing?.id)) throw new Error(`已經有「${name}」這個預算`);
    for (const [k, label] of [['ideal', '理想金額'], ['basic', '基本金額'], ['goal', '目標金額']] as const) {
      const n = input[k];
      if (n != null && (!Number.isFinite(n) || n < 0)) throw new Error(`${label}請填 0 以上的數字`);
    }
    const now = Date.now();
    const values: RowValues = {
      name,
      ideal: input.ideal,
      basic: input.basic,
      monthly: input.monthly ? null : false,
      goal: input.goal,
      archived: input.archived || null,
      note: input.note?.trim() || null,
      updatedAt: now,
    };
    if (!existing) {
      const sort = Math.max(0, ...snap.budgets.map((b) => b.sort ?? 0)) + 1;
      await this.b.append('moneyBudgets', [{ ...values, sort, id: newId(now), createdAt: now }]);
      return;
    }
    await this.b.update('moneyBudgets', [{ rowNumber: existing.rowNumber, values, expectId: existing.id }]);
    if (name === existing.name) return;
    // 改名：明細、分類的預設預算、分配一起改
    const from = existing.name;
    const lines: RowUpdate[] = [];
    for (const t of snap.txns) for (const l of t.lines) if (l.budget === from) lines.push({ rowNumber: l.rowNumber, values: { budget: name, updatedAt: now }, expectId: l.id });
    if (lines.length) await this.b.update('moneyLines', lines);
    const cats = snap.categories.filter((c) => c.defaultBudget === from).map((c) => ({ rowNumber: c.rowNumber, values: { defaultBudget: name, updatedAt: now }, expectId: c.id }));
    if (cats.length) await this.b.update('moneyCategories', cats);
    const allocs = snap.allocations.filter((a) => a.budget === from).map((a) => ({ rowNumber: a.rowNumber, values: { budget: name, updatedAt: now }, expectId: a.id }));
    if (allocs.length) await this.b.update('moneyBudgetAllocations', allocs);
  }

  /** 預算上移 / 下移 */
  async moveBudget(b: Budget, delta: -1 | 1) {
    const snap = await this.fresh();
    const list = snap.budgets;
    const i = list.findIndex((x) => x.id === b.id);
    if (i < 0 || !list[i + delta]) return;
    const order = list.map((x) => x.id);
    [order[i], order[i + delta]] = [order[i + delta], order[i]];
    const now = Date.now();
    const us = order
      .map((id, k) => ({ x: list.find((y) => y.id === id)!, k }))
      .filter(({ x, k }) => x.sort !== k + 1)
      .map(({ x, k }) => ({ rowNumber: x.rowNumber, values: { sort: k + 1, updatedAt: now }, expectId: x.id }));
    if (us.length) await this.b.update('moneyBudgets', us);
  }

  /** 分配預算：每月（確認草稿；0 也記，代表這個月確認過）、追加、年終（0 的不記） */
  async allocate(month: string, kind: Exclude<AllocKind, '期初'>, rows: { budget: string; amount: number; note?: string | null }[]) {
    const snap = await this.fresh();
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('月份格式不對');
    if (kind === '每月' && snap.allocations.some((a) => a.month === month && a.kind === '每月')) throw new Error(`${month} 的預算已經確認過了（要再放錢請用「追加」）`);
    const now = Date.now();
    const out: RowValues[] = [];
    for (const r of rows) {
      const b = snap.budgets.find((x) => x.name === r.budget);
      if (!b) throw new Error(`找不到預算「${r.budget}」`);
      if (!Number.isFinite(r.amount)) throw new Error(`「${r.budget}」金額請填數字`);
      if (kind !== '每月' && r.amount === 0) continue;
      out.push({ month, budget: r.budget, kind, amount: Math.round(r.amount), ideal: kind === '每月' ? b.ideal : null, note: r.note ?? null, id: newId(now), createdAt: now, updatedAt: now });
    }
    if (out.length) await this.b.append('moneyBudgetAllocations', out);
  }

  /** 重新整理預算：某一天開始時每個使用中預算的金額；之後只從這天開始算，以最新一次為準。 */
  async setBaseline(date: string, rows: { budget: string; amount: number }[], note?: string | null) {
    const snap = await this.fresh();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('請選日期');
    // 2026-11-21 使用者決定：每次整理要替所有使用中的預算留下期初，即使金額是 0。
    const active = snap.budgets.filter((b) => !b.archived);
    const names = new Set(rows.map((r) => r.budget));
    if (names.size !== rows.length) throw new Error('同一個預算不能重複');
    if (active.some((b) => !names.has(b.name)) || rows.some((r) => !active.some((b) => b.name === r.budget))) {
      throw new Error('重新整理時，每個使用中的預算都要填期初金額');
    }
    const now = Date.now();
    const out = rows.map((r) => {
      if (!Number.isFinite(r.amount)) throw new Error(`「${r.budget}」金額請填數字`);
      return { month: date.slice(0, 7), budget: r.budget, kind: '期初', amount: Math.round(r.amount), date, note: note?.trim() || null, id: newId(now), createdAt: now, updatedAt: now };
    });
    if (out.length) await this.b.append('moneyBudgetAllocations', out);
  }

  async deleteAllocation(a: Allocation) {
    const now = Date.now();
    await this.b.update('moneyBudgetAllocations', [{ rowNumber: a.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: a.id }]);
  }

  /** 分類的預設預算 */
  async setCategoryBudget(c: Category, budget: string | null) {
    await this.b.update('moneyCategories', [{ rowNumber: c.rowNumber, values: { defaultBudget: budget, updatedAt: Date.now() }, expectId: c.id }]);
  }

  /** 只改一筆明細的預算（補填） */
  async setLineBudget(l: Line, budget: string | null) {
    await this.b.update('moneyLines', [{ rowNumber: l.rowNumber, values: { budget, updatedAt: Date.now() }, expectId: l.id }]);
  }

  async saveMoneySettings(s: MoneySettings) {
    if (!Number.isInteger(s.loanRemindDays) || s.loanRemindDays < 1 || s.loanRemindDays > 365) throw new Error('提醒天數請填 1–365');
    const rows = await this.b.read('moneySettings');
    const want: Record<string, string | number> = { 'money.incomeCompare': s.incomeCompare, 'money.loanRemindDays': s.loanRemindDays };
    const updates: RowUpdate[] = [];
    const appends: RowValues[] = [];
    for (const [key, value] of Object.entries(want)) {
      const r = rows.find((x) => str(x.values.key) === key);
      if (r) updates.push({ rowNumber: r.rowNumber, values: { value } });
      else appends.push({ key, value });
    }
    if (updates.length) await this.b.update('moneySettings', updates);
    if (appends.length) await this.b.append('moneySettings', appends);
  }

  // ── 帳單對帳（2026-11-18 第 3 輪） ──

  /** 找到或建立某帳戶某一期的帳單；patch 有給就順便更新 */
  async saveStatement(account: string, closeDate: string, patch: { amountDue?: number | null; dueDate?: string | null; note?: string | null } = {}): Promise<Statement> {
    const snap = await this.fresh();
    const acc = snap.accounts.find((a) => a.name === account);
    if (!acc) throw new Error(`找不到帳戶「${account}」`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(closeDate)) throw new Error('請選結帳日');
    if (patch.amountDue != null && !Number.isFinite(patch.amountDue)) throw new Error('應繳金額請填數字');
    const now = Date.now();
    const v: RowValues = { updatedAt: now };
    if (patch.amountDue !== undefined) v.amountDue = patch.amountDue == null ? null : roundMoney(patch.amountDue, acc.currency);
    if (patch.dueDate !== undefined) v.dueDate = patch.dueDate;
    if (patch.note !== undefined) v.note = patch.note?.trim() || null;
    const old = snap.statements.find((s) => s.account === account && s.closeDate === closeDate);
    if (old) {
      if (Object.keys(v).length > 1) await this.b.update('moneyStatements', [{ rowNumber: old.rowNumber, values: v, expectId: old.id }]);
      return old;
    }
    const id = newId(now);
    await this.b.append('moneyStatements', [{ account, closeDate, dueDate: dueDateFor(acc, closeDate), ...v, id, createdAt: now }]);
    return (await this.fresh()).statements.find((s) => s.id === id)!;
  }

  /** 存入帳單明細（在 APP 貼上的） */
  async addStatementItems(account: string, closeDate: string, rows: Omit<StatementItem, 'rowNumber' | 'id' | 'account' | 'closeDate' | 'matched'>[]) {
    await this.saveStatement(account, closeDate);
    const now = Date.now();
    const cur = (this.last ?? (await this.fresh())).accounts.find((a) => a.name === account)?.currency ?? 'TWD';
    if (!rows.length) return;
    await this.b.append(
      'moneyStatementItems',
      rows.map((r) => ({
        account,
        closeDate,
        date: r.date,
        postedDate: r.postedDate,
        description: r.description,
        amount: roundMoney(r.amount, cur),
        origCurrency: r.origCurrency,
        origAmount: r.origAmount,
        id: newId(now),
        createdAt: now,
        updatedAt: now,
      })),
    );
  }

  /** 刪除帳單明細（清除重貼） */
  async deleteStatementItems(items: StatementItem[]) {
    const now = Date.now();
    if (items.length) await this.b.update('moneyStatementItems', items.map((i) => ({ rowNumber: i.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: i.id })));
  }

  /** 手動配對 / 取消配對（txnIds = [NO_MATCH] 代表這一行不要自動配對；[] = 交給 APP 自動配對） */
  async setItemMatch(item: StatementItem, txnIds: string[]) {
    await this.b.update('moneyStatementItems', [{ rowNumber: item.rowNumber, values: { matched: txnIds.length ? txnIds.join(',') : null, updatedAt: Date.now() }, expectId: item.id }]);
  }

  /**
   * 完成對帳：把配對結果（含 APP 自動配對的）寫進帳單明細；交易填上入帳日；
   * 交易沒有帳單名稱的，填上帳單的說明（之後補登同一個名稱會自動帶入店家，2026-11-18 確認）
   */
  async finishReconcile(stmt: Statement, pairs: { item: StatementItem; txnIds: string[] }[]) {
    const snap = await this.fresh();
    const now = Date.now();
    const itemUs: RowUpdate[] = [];
    const txUs = new Map<string, RowUpdate>();
    for (const { item, txnIds } of pairs) {
      const want = txnIds.join(',');
      if (item.matched.join(',') !== want) itemUs.push({ rowNumber: item.rowNumber, values: { matched: want || null, updatedAt: now }, expectId: item.id });
      for (const id of txnIds) {
        const t = snap.txns.find((x) => x.id === id);
        if (!t) continue;
        const v: RowValues = {};
        const posted = item.postedDate ?? item.date;
        if (posted && t.postedDate !== posted) v.postedDate = posted;
        if (!t.statementText && item.description && txnIds.length === 1) v.statementText = item.description;
        if (Object.keys(v).length) txUs.set(t.id, { rowNumber: t.rowNumber, values: { ...v, updatedAt: now }, expectId: t.id });
      }
    }
    if (itemUs.length) await this.b.update('moneyStatementItems', itemUs);
    if (txUs.size) await this.b.update('moneyTransactions', [...txUs.values()]);
    await this.b.update('moneyStatements', [{ rowNumber: stmt.rowNumber, values: { doneAt: now, updatedAt: now }, expectId: stmt.id }]);
  }

  // ── 盤點（2026-11-18 確認：只輸入實際餘額，有差額也可以先完成；APP 不自動調整） ──

  /** 記一次盤點；bookSnapshot = 這時候 APP 算的餘額（信用卡是未繳金額） */
  async saveBalanceCheck(account: string, date: string, actual: number, note: string | null = null) {
    const snap = await this.fresh();
    const acc = snap.accounts.find((a) => a.name === account);
    if (!acc) throw new Error(`找不到帳戶「${account}」`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('請選日期');
    if (!Number.isFinite(actual)) throw new Error('實際餘額請填數字');
    const bal = accountBalance(acc, snap.txns, date);
    const now = Date.now();
    await this.b.append('moneyBalanceChecks', [
      {
        account,
        date,
        actual: roundMoney(actual, acc.currency),
        bookSnapshot: bal == null ? null : acc.type === '信用卡' ? -bal : bal,
        note: note?.trim() || null,
        id: newId(now),
        createdAt: now,
        updatedAt: now,
      },
    ]);
  }

  async deleteBalanceCheck(c: BalanceCheck) {
    const now = Date.now();
    await this.b.update('moneyBalanceChecks', [{ rowNumber: c.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: c.id }]);
  }

  /**
   * 調整差額（使用者按了才做）：在盤點那天記一筆「調整」，讓 APP 的餘額 = 實際餘額。
   * diff = 實際 − APP（信用卡用未繳金額算：實際欠比較多 → 錢從卡片帳戶「出」）
   */
  async adjustBalance(c: BalanceCheck) {
    const snap = await this.fresh();
    const acc = snap.accounts.find((a) => a.name === c.account);
    if (!acc) throw new Error(`找不到帳戶「${c.account}」`);
    const bal = accountBalance(acc, snap.txns, c.date);
    if (bal == null) throw new Error('這個帳戶沒有期初餘額，不能調整');
    const book = acc.type === '信用卡' ? -bal : bal;
    const diff = roundMoney(c.actual - book, acc.currency);
    if (diff === 0) return;
    const delta = acc.type === '信用卡' ? -diff : diff;
    await this.saveTxn({
      time: startOfDay(c.date) + 23 * 3600000 + 59 * 60000,
      direction: delta > 0 ? '入' : '出',
      account: acc.name,
      amount: Math.abs(delta),
      paidBy: null,
      currency: null,
      toAccount: null,
      toAmount: null,
      store: null,
      branch: null,
      statementText: null,
      note: '盤點調整（找不到原因的差額）',
      tagIds: [],
      lines: [{ kind: '調整', amount: Math.abs(delta) }],
    });
  }

  /** 沒有期初餘額的帳戶：用盤點的金額當期初餘額 */
  async setOpeningFromCheck(account: string, date: string, actual: number) {
    const snap = await this.fresh();
    const acc = snap.accounts.find((a) => a.name === account);
    if (!acc) throw new Error(`找不到帳戶「${account}」`);
    await this.b.update('moneyAccounts', [
      { rowNumber: acc.rowNumber, values: { openingDate: date, openingBalance: roundMoney(actual, acc.currency), updatedAt: Date.now() }, expectId: acc.id },
    ]);
  }

  /** 整批補齊：勾選的明細合成一筆交易，明細接到這筆交易底下（不重建明細） */
  async attachLines(issues: MoneyIssue[], head: OrphanHead): Promise<string> {
    const items = issues.filter((i) => i.orphan);
    if (!items.length) throw new Error('請勾選明細');
    const snap = await this.fresh();
    const input = orphanTxn(
      items.map((i) => i.orphan!.line),
      head,
    );
    const p = checkTxn(input, snap, { allowNoCategory: true });
    if (p.length) throw new Error(p.join('；'));
    if (input.store && !snap.orgs.some((o) => o.name === input.store)) await this.addOrg(input.store);
    const now = Date.now();
    const id = newId(now);
    await this.b.append('moneyTransactions', [
      {
        id,
        time: input.time,
        date: toDateKey(input.time),
        direction: input.direction,
        account: input.account,
        amount: input.amount == null ? null : roundMoney(input.amount, txnCurrency(input, snap.accounts)),
        paidBy: input.paidBy,
        store: input.store,
        branch: input.branch,
        note: input.note,
        createdVia: this.via,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await this.b.update(
      'moneyLines',
      items.map((i, k) => ({ rowNumber: i.rowNumber, values: { transaction: id, sort: k + 1, updatedAt: now, ...(i.id ? {} : { id: newId(now), createdAt: now }) }, expectId: i.id ?? '' })),
    );
    // 朋友幫我付：補上和他之間的欠款
    const extra = input.lines.slice(items.length);
    if (extra.length) {
      await this.b.append(
        'moneyLines',
        extra.map((l, k) => ({ transaction: id, kind: l.kind, amount: l.amount, person: l.person ?? null, sort: items.length + k + 1, id: newId(now), createdAt: now, updatedAt: now })),
      );
    }
    return id;
  }

  /**
   * 整批補分類：只缺分類的交易，用同一個分類（和預算）建立明細。
   * 回傳補不了的（其他問題），其餘照常存。
   */
  async fillCategories(issues: MoneyIssue[], category: string, budget: string | null): Promise<{ issue: MoneyIssue; problems: string[] }[]> {
    const snap = await this.fresh();
    const now = Date.now();
    const txUp: RowUpdate[] = [];
    const lineAdds: RowValues[] = [];
    const failed: { issue: MoneyIssue; problems: string[] }[] = [];
    for (const i of issues) {
      if (!i.draft || !i.id) continue;
      const f: EntryForm = { ...i.draft, cats: [{ ...i.draft.cats[0], category, budget }] };
      const t = formToTxn(f);
      const p = checkTxn(t, snap);
      if (p.length) {
        failed.push({ issue: i, problems: p });
        continue;
      }
      const cur = txnCurrency(t, snap.accounts);
      txUp.push({ rowNumber: i.rowNumber, values: { direction: t.direction, amount: t.amount == null ? null : roundMoney(t.amount, cur), category: null, budget: null, updatedAt: now }, expectId: i.id });
      t.lines.forEach((l, k) =>
        lineAdds.push({ transaction: i.id, kind: l.kind, amount: roundMoney(l.amount, cur), category: l.category ? normPath(l.category) : null, budget: l.budget ?? null, sort: k + 1, id: newId(now), createdAt: now, updatedAt: now }),
      );
    }
    if (txUp.length) await this.b.update('moneyTransactions', txUp);
    if (lineAdds.length) await this.b.append('moneyLines', lineAdds);
    return failed;
  }

  async discardIssue(issue: MoneyIssue) {
    const now = Date.now();
    await this.b.update(issue.table, [{ rowNumber: issue.rowNumber, values: { deletedAt: now, updatedAt: now }, expectId: issue.id ?? '' }]);
  }
}
