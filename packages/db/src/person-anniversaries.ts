import { recurrenceAddDays } from './calendar-recurrence';
import type { RowValues } from './backend';

export const PERSON_ANNIVERSARY_FIELDS = [
  ['solarBirthday', '國曆生日'],
  ['lunarBirthday', '農曆生日'],
  ['solarMemorial', '國曆祭日'],
  ['lunarMemorial', '農曆祭日'],
] as const;
export type PersonAnniversaryField = typeof PERSON_ANNIVERSARY_FIELDS[number][0];
type LeapRule = 'regular' | 'fallback' | 'only';
export interface PersonAnniversarySettings {
  dates: Record<PersonAnniversaryField, string>;
  lunarBirthdayLeap: LeapRule;
  lunarMemorialLeap: LeapRule;
  noLongerInContact: boolean;
}

const parseLeap = (value: unknown): LeapRule => value === 'only' || value === 'fallback' ? value : 'regular';
export function readPersonAnniversaries(values: RowValues): PersonAnniversarySettings {
  return {
    dates: {
      solarBirthday: String(values.solarBirthday ?? ''),
      lunarBirthday: String(values.lunarBirthday ?? ''),
      solarMemorial: String(values.solarMemorial ?? ''),
      lunarMemorial: String(values.lunarMemorial ?? ''),
    },
    lunarBirthdayLeap: parseLeap(values.lunarBirthdayLeap),
    lunarMemorialLeap: parseLeap(values.lunarMemorialLeap),
    noLongerInContact: values.noLongerInContact === true,
  };
}

const pad = (value: number) => String(value).padStart(2, '0');
function parseDate(value: string, lunar: boolean) {
  const match = /^(?:(\d{4})[-/])?(\d{1,2})[-/](\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const year = match[1] ? Number(match[1]) : null;
  const month = Number(match[2]), day = Number(match[3]);
  if (year !== null && year < 1000 || month < 1 || month > 12 || day < 1) return null;
  if (lunar ? day > 30 : day > new Date(Date.UTC(year ?? 2000, month, 0)).getUTCDate()) return null;
  return { year, month, day };
}

export function personAnniversaryValues(settings: PersonAnniversarySettings): RowValues {
  const values: RowValues = {
    lunarBirthdayLeap: settings.lunarBirthdayLeap === 'regular' ? null : settings.lunarBirthdayLeap,
    lunarMemorialLeap: settings.lunarMemorialLeap === 'regular' ? null : settings.lunarMemorialLeap,
    noLongerInContact: settings.noLongerInContact || null,
  };
  for (const [field, label] of PERSON_ANNIVERSARY_FIELDS) {
    if (!settings.dates[field].trim()) { values[field] = null; continue; }
    const date = parseDate(settings.dates[field], field.startsWith('lunar'));
    if (!date) throw new Error(`${label}請填有效的月/日，或西元年/月/日`);
    values[field] = `${date.year ? `${date.year}/` : ''}${pad(date.month)}/${pad(date.day)}`;
  }
  return values;
}

const lunarYears = new Map<number, Map<string, string>>();
let lunarFormatter: Intl.DateTimeFormat | undefined;
function lunarDates(year: number) {
  const cached = lunarYears.get(year);
  if (cached) return cached;
  const dates = new Map<string, string>();
  lunarFormatter ??= new Intl.DateTimeFormat('en-u-ca-chinese-nu-latn', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric',
  });
  if (lunarFormatter.resolvedOptions().calendar === 'chinese') {
    for (let date = `${year}-01-01`; date <= `${year + 1}-03-01`; date = recurrenceAddDays(date, 1)) {
      const parts = new Map<string, string>(lunarFormatter.formatToParts(new Date(`${date}T04:00:00Z`)).map((part) => [part.type, part.value]));
      if (Number(parts.get('relatedYear')) !== year) continue;
      const month = parts.get('month');
      const day = parts.get('day');
      if (month && day) dates.set(`${month}/${Number(day)}`, date);
    }
  }
  if (lunarYears.size >= 12) lunarYears.delete(lunarYears.keys().next().value!);
  lunarYears.set(year, dates);
  return dates;
}

export function personAnniversaryOccurrences(
  settings: PersonAnniversarySettings,
  nickname: string,
  from: string,
  to: string,
) {
  const entries: { field: PersonAnniversaryField; date: string; title: string; label: string }[] = [];
  if (settings.noLongerInContact || to < from) return entries;
  for (const [field, label] of PERSON_ANNIVERSARY_FIELDS) {
    const lunar = field.startsWith('lunar');
    const date = parseDate(settings.dates[field], lunar);
    if (!date) continue;
    const leapRule = field === 'lunarBirthday' ? settings.lunarBirthdayLeap : settings.lunarMemorialLeap;
    const fromYear = Number(from.slice(0, 4));
    const toYear = Number(to.slice(0, 4));
    for (let year = fromYear - Number(lunar); year <= toYear; year++) {
      if (date.year != null && year < date.year) continue;
      let occurrence: string | undefined;
      if (lunar) {
        const dates = lunarDates(year);
        // 普通月只看普通月。閏月沒有同名閏月時，依選擇落回普通月。
        const useLeap = leapRule !== 'regular' && (leapRule === 'only' || dates.has(`${date.month}bis/1`));
        occurrence = dates.get(`${date.month}${useLeap ? 'bis' : ''}/${date.day}`);
      } else if (date.day <= new Date(Date.UTC(year, date.month, 0)).getUTCDate()) {
        occurrence = `${year}-${pad(date.month)}-${pad(date.day)}`;
      }
      if (!occurrence || occurrence < from || occurrence > to) continue;
      const age = field.endsWith('Birthday') && date.year != null ? `（滿 ${year - date.year} 歲）` : '';
      entries.push({ field, date: occurrence, title: `${nickname}${label}${age}`, label });
    }
  }
  return entries;
}
