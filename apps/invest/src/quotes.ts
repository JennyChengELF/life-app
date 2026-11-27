import { fetchReferenceRate, SheetsBackend, todayKey, type InvestAsset, type InvestStore } from '@life/db';

interface Price { quote: number; quoteDate: string; quoteSource: string }
interface FundLookup { key: string; url: string; xpath: string; source: string }
const allowedFunds = new Map([
  ['am.jpmorgan.com', '摩根投信'], ['www.anuefund.com', '鉅亨買基金'], ['www.eastspring.com.tw', '瀚亞投信'],
]);
const timedSignal = () => AbortSignal.timeout(8000);
const normalized = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s\-–－（）()]/g, '');
const dateKey = (year: string, month: string, day: string) => `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

function textQuote(value: string, source: string): Price | null {
  const match = /(?:參考淨值|最新淨值)\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*[（(]?\s*(20\d\d)[/\-](\d{1,2})[/\-](\d{1,2})/.exec(value);
  if (!match) return null;
  return { quote: Number(match[1].replaceAll(',', '')), quoteDate: dateKey(match[2], match[3], match[4]), quoteSource: source };
}

function fundLookup(a: InvestAsset): FundLookup | null {
  if (!a.quoteUrl || !a.currency) return null;
  let url: URL;
  try { url = new URL(a.quoteUrl); } catch { return null; }
  const source = allowedFunds.get(url.hostname);
  if (url.protocol !== 'https:' || !source || url.username || url.password) return null;
  let xpath = '';
  if (url.hostname === 'www.eastspring.com.tw') {
    if (a.name.length < 8 || !/(新臺幣|新台幣|美元|澳幣|歐元|人民幣)/.test(a.name) || /['"]/.test(a.name)) return null;
    xpath = `//tr[starts-with(normalize-space(td[1]),"${a.name}")]/td[2]`;
  } else if (url.hostname === 'www.anuefund.com') {
    if (!/^[A-Z0-9]{12}$/i.test(url.searchParams.get('isincode') ?? '') || url.searchParams.get('ccy') !== a.currency) return null;
    xpath = '//text()[contains(.,"參考淨值") and contains(.,"/")]';
  } else if (url.hostname === 'am.jpmorgan.com') {
    if (!/\/products\/[^/]+-[A-Z0-9]{12}\/?$/i.test(url.pathname)) return null;
    xpath = '//*[normalize-space(text())="最新淨值"]/parent::*';
  }
  return xpath ? { key: JSON.stringify([url.href, a.currency, xpath]), url: url.href, xpath, source } : null;
}

function fundLookupPrice(text: string, source: string) {
  return textQuote(`最新淨值 ${text}`, source) ?? textQuote(text, source);
}

async function fundQuote(a: InvestAsset, lookup: FundLookup): Promise<Price | null> {
  const { url, source } = lookup;
  const response = await fetch(url, { credentials: 'omit', signal: timedSignal(), redirect: 'error' });
  if (!response.ok) return null;
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  // 綁到明確的基金頁或唯一完整級別名稱，避免同名不同幣別的淨值。
  if (source === '瀚亞投信') {
    const name = normalized(a.name);
    if (name.length < 8) return null;
    const rows = [...doc.querySelectorAll('tr')].filter((row) =>
      normalized(row.querySelector('td')?.textContent ?? '').startsWith(name));
    if (rows.length !== 1) return null;
    const cell = rows[0].cells[1]?.textContent?.trim() ?? '';
    const m = /^([\d,]+(?:\.\d+)?)\s+(20\d\d)[/\-](\d{1,2})[/\-](\d{1,2})/.exec(cell);
    return m ? { quote: Number(m[1].replaceAll(',', '')), quoteDate: dateKey(m[2], m[3], m[4]), quoteSource: source } : null;
  }
  return textQuote(doc.body.textContent ?? '', source);
}

async function twQuotes(): Promise<Map<string, Price>> {
  const data = new Map<string, Price>();
  const response = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', {
    credentials: 'omit', signal: timedSignal(),
  });
  if (!response.ok) throw new Error('證交所報價未能取得');
  const list: unknown = await response.json();
  if (!Array.isArray(list)) throw new Error('證交所報價格式有誤');
  for (const row of list) {
    const d = /^(\d{3})(\d{2})(\d{2})$/.exec(String(row.Date ?? ''));
    const full = /^(20\d\d)(\d{2})(\d{2})$/.exec(String(row.Date ?? ''));
    const date = d ? dateKey(String(Number(d[1]) + 1911), d[2], d[3]) : full ? dateKey(full[1], full[2], full[3]) : '';
    const price = Number(String(row.ClosingPrice ?? '').replaceAll(',', ''));
    if (row.Code && price > 0 && date) data.set(String(row.Code), { quote: price, quoteDate: date, quoteSource: '臺灣證券交易所' });
  }
  return data;
}

let lastAttempt = 0;
export async function refreshQuotes(store: InvestStore, assets: InvestAsset[], force = false) {
  if (!force && Date.now() - lastAttempt < 5 * 60 * 1000) return { updated: 0, failed: 0 };
  lastAttempt = Date.now();
  const day = todayKey();
  const tw = assets.some((a) => a.kind === 'stock' && a.market === 'TW')
    ? twQuotes().catch(() => new Map<string, Price>()) : Promise.resolve(new Map<string, Price>());
  const ticker = (a: InvestAsset) => a.market === 'US' ? a.symbol : `${a.market === 'TW' ? 'TPE' : a.market}:${a.symbol}`;
  const stocks = assets.filter((a) => a.kind === 'stock' && ['TW', 'TPE', 'TWO', 'US', 'NASDAQ', 'NYSE', 'NYSEARCA', 'AMEX'].includes(a.market));
  const market = stocks.length && store.backend instanceof SheetsBackend
    ? store.backend.readInvestmentMarketQuotes(stocks.map(ticker)).catch(() => [])
    : Promise.resolve([]);
  const lookups = assets.filter((a) => a.kind !== 'stock').flatMap((a) => {
    const lookup = fundLookup(a);
    return lookup ? [{ a, lookup }] : [];
  });
  const sheets = store.backend instanceof SheetsBackend ? store.backend : null;
  const fundPrices = Promise.all(lookups.map(async ({ a, lookup }) => [a.id, await fundQuote(a, lookup).catch(() => null)] as const))
    .then(async (direct) => {
      const prices = new Map(direct);
      const missing = lookups.filter(({ a }) => !prices.get(a.id));
      if (!sheets || !missing.length) return prices;
      const fallback = await sheets.readInvestmentFundQuotes([...new Map(missing.map(({ lookup }) => [lookup.key, lookup])).values()])
        .catch(() => new Map<string, string>());
      for (const { a, lookup } of missing) {
        const result = fallback.get(lookup.key);
        if (result) prices.set(a.id, fundLookupPrice(result, lookup.source));
      }
      return prices;
    });
  const fx = new Map([...new Set(assets.map((a) => a.currency).filter((currency) => currency && currency !== 'TWD'))]
    .map((currency) => [currency, fetchReferenceRate(currency, day, timedSignal()).catch(() => null)]));
  const results = await Promise.all(assets.map(async (a) => {
    const rate = await fx.get(a.currency);
    const gf = stocks.includes(a) ? (await market).find((r) => r.ticker === ticker(a)) : null;
    const exchange = a.market === 'TW' ? (await tw).get(a.symbol) : null;
    const quote = a.kind !== 'stock' ? (await fundPrices).get(a.id)
      : exchange ?? (gf ? { quote: gf.price, quoteDate: gf.date, quoteSource: 'Google 財經' } : null);
    const price = quote && quote.quoteDate >= a.quoteDate && quote.quoteDate <= day ? quote : null;
    const updatedRate = rate && rate.date >= a.quoteFxDate && (rate.rate !== a.quoteFx || rate.date !== a.quoteFxDate) ? rate : null;
    const updatedPrice = price && (price.quote !== a.quote || price.quoteDate !== a.quoteDate || price.quoteSource !== a.quoteSource) ? price : null;
    return { a, updatedRate, updatedPrice, failed: !quote };
  }));
  const updates = results.filter((r) => r.updatedRate || r.updatedPrice);
  if (updates.length) await store.saveQuotes(updates.map(({ a, updatedRate, updatedPrice }) => ({
    id: a.id,
    ...(updatedPrice ?? {}),
    ...(updatedRate ? { quoteFx: updatedRate.rate, quoteFxDate: updatedRate.date } : {}),
  })));
  return { updated: updates.length, failed: results.filter((r) => r.failed).length };
}
