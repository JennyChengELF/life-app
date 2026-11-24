/**
 * 台灣政府行政機關辦公日曆的特殊日期。
 *
 * 來源：行政院人事行政總處「中華民國政府行政機關辦公日曆表」及政府資料開放平臺。
 * https://data.gov.tw/dataset/14718
 * （2026-11-24 使用者決定：依台灣實際辦公日判斷；週末紅字，補班日不標紅。）
 *
 * 一般週六、週日不逐日列在這裡；只保存具名稱的假日、平日放假與週末補班。
 */
export type TaiwanDayType = 'workday' | 'holiday';
export type TaiwanDaySource = 'official' | 'inferred' | 'provisional';

export interface TaiwanDayInfo {
  date: string;
  type: TaiwanDayType;
  source: TaiwanDaySource;
  /** 一般週末沒有名稱；國定假日、補假、補班才有。 */
  title: string | null;
  special: boolean;
}

type SpecialDay = readonly [date: string, type: TaiwanDayType, title: string];

export const TAIWAN_OFFICIAL_FIRST_YEAR = 2018;
export const TAIWAN_OFFICIAL_LAST_YEAR = 2027;
export const TAIWAN_CALENDAR_GROUP_SOURCE = 'taiwanOfficeCalendar';
export const TAIWAN_CALENDAR_GROUP_NAME = '台灣休假與補班';

const SPECIAL_DAYS: SpecialDay[] = [
  ['2018-01-01','holiday','中華民國開國紀念日'], ['2018-02-15','holiday','農曆除夕'], ['2018-02-16','holiday','春節'], ['2018-02-17','holiday','春節'], ['2018-02-18','holiday','春節'], ['2018-02-19','holiday','春節補假'], ['2018-02-20','holiday','春節補假'], ['2018-02-28','holiday','和平紀念日'], ['2018-03-31','workday','補班日'], ['2018-04-04','holiday','兒童節'], ['2018-04-05','holiday','民族掃墓節（清明節）'], ['2018-04-06','holiday','調整放假日'], ['2018-06-18','holiday','端午節'], ['2018-09-24','holiday','中秋節'], ['2018-10-10','holiday','國慶日'], ['2018-12-22','workday','補班日'], ['2018-12-31','holiday','調整放假日'],
  ['2019-01-01','holiday','中華民國開國紀念日'], ['2019-01-19','workday','補班日'], ['2019-02-04','holiday','農曆除夕'], ['2019-02-05','holiday','春節'], ['2019-02-06','holiday','春節'], ['2019-02-07','holiday','春節'], ['2019-02-08','holiday','調整放假日'], ['2019-02-23','workday','補班日'], ['2019-02-28','holiday','和平紀念日'], ['2019-03-01','holiday','調整放假日'], ['2019-04-04','holiday','兒童節'], ['2019-04-05','holiday','民族掃墓節（清明節）'], ['2019-06-07','holiday','端午節'], ['2019-09-13','holiday','中秋節'], ['2019-10-05','workday','補班日'], ['2019-10-10','holiday','國慶日'], ['2019-10-11','holiday','調整放假日'],
  ['2020-01-01','holiday','中華民國開國紀念日'], ['2020-01-23','holiday','調整放假日'], ['2020-01-24','holiday','農曆除夕'], ['2020-01-25','holiday','春節'], ['2020-01-26','holiday','春節'], ['2020-01-27','holiday','春節'], ['2020-01-28','holiday','春節補假'], ['2020-01-29','holiday','春節補假'], ['2020-02-15','workday','補班日'], ['2020-02-28','holiday','和平紀念日'], ['2020-04-02','holiday','兒童節補假'], ['2020-04-03','holiday','調整放假日'], ['2020-04-04','holiday','兒童節、民族掃墓節（清明節）'], ['2020-06-20','workday','補班日'], ['2020-06-25','holiday','端午節'], ['2020-06-26','holiday','調整放假日'], ['2020-09-26','workday','補班日'], ['2020-10-01','holiday','中秋節'], ['2020-10-02','holiday','調整放假日'], ['2020-10-09','holiday','國慶日補假'], ['2020-10-10','holiday','國慶日'],
  ['2021-01-01','holiday','中華民國開國紀念日'], ['2021-02-10','holiday','調整放假日'], ['2021-02-11','holiday','農曆除夕'], ['2021-02-12','holiday','春節'], ['2021-02-13','holiday','春節'], ['2021-02-14','holiday','春節'], ['2021-02-15','holiday','春節補假'], ['2021-02-16','holiday','春節補假'], ['2021-02-20','workday','補班日'], ['2021-02-28','holiday','和平紀念日'], ['2021-03-01','holiday','和平紀念日補假'], ['2021-04-02','holiday','兒童節補假'], ['2021-04-04','holiday','兒童節、民族掃墓節（清明節）'], ['2021-04-05','holiday','民族掃墓節補假'], ['2021-06-14','holiday','端午節'], ['2021-09-11','workday','補班日'], ['2021-09-20','holiday','調整放假日'], ['2021-09-21','holiday','中秋節'], ['2021-10-10','holiday','國慶日'], ['2021-10-11','holiday','國慶日補假'], ['2021-12-31','holiday','中華民國開國紀念日補假'],
  ['2022-01-01','holiday','中華民國開國紀念日'], ['2022-01-22','workday','補班日'], ['2022-01-31','holiday','農曆除夕'], ['2022-02-01','holiday','春節'], ['2022-02-02','holiday','春節'], ['2022-02-03','holiday','春節'], ['2022-02-04','holiday','調整放假日'], ['2022-02-28','holiday','和平紀念日'], ['2022-04-04','holiday','兒童節'], ['2022-04-05','holiday','民族掃墓節（清明節）'], ['2022-06-03','holiday','端午節'], ['2022-09-09','holiday','中秋節補假'], ['2022-09-10','holiday','中秋節'], ['2022-10-10','holiday','國慶日'],
  ['2023-01-01','holiday','中華民國開國紀念日'], ['2023-01-02','holiday','中華民國開國紀念日補假'], ['2023-01-07','workday','補班日'], ['2023-01-20','holiday','調整放假日'], ['2023-01-21','holiday','農曆除夕'], ['2023-01-22','holiday','春節'], ['2023-01-23','holiday','春節'], ['2023-01-24','holiday','春節'], ['2023-01-25','holiday','農曆除夕補假'], ['2023-01-26','holiday','春節補假'], ['2023-01-27','holiday','調整放假日'], ['2023-02-04','workday','補班日'], ['2023-02-18','workday','補班日'], ['2023-02-27','holiday','調整放假日'], ['2023-02-28','holiday','和平紀念日'], ['2023-03-25','workday','補班日'], ['2023-04-03','holiday','調整放假日'], ['2023-04-04','holiday','兒童節'], ['2023-04-05','holiday','民族掃墓節（清明節）'], ['2023-06-17','workday','補班日'], ['2023-06-22','holiday','端午節'], ['2023-06-23','holiday','調整放假日'], ['2023-09-23','workday','補班日'], ['2023-09-29','holiday','中秋節'], ['2023-10-09','holiday','調整放假日'], ['2023-10-10','holiday','國慶日'],
  ['2024-01-01','holiday','中華民國開國紀念日'], ['2024-02-08','holiday','調整放假日'], ['2024-02-09','holiday','農曆除夕'], ['2024-02-10','holiday','春節'], ['2024-02-11','holiday','春節'], ['2024-02-12','holiday','春節'], ['2024-02-13','holiday','春節補假'], ['2024-02-14','holiday','春節補假'], ['2024-02-17','workday','補班日'], ['2024-02-28','holiday','和平紀念日'], ['2024-04-04','holiday','兒童節及民族掃墓節'], ['2024-04-05','holiday','兒童節與民族掃墓節補假'], ['2024-06-10','holiday','端午節'], ['2024-09-17','holiday','中秋節'], ['2024-10-10','holiday','國慶日'],
  ['2025-01-01','holiday','中華民國開國紀念日'], ['2025-01-27','holiday','調整放假日'], ['2025-01-28','holiday','農曆除夕'], ['2025-01-29','holiday','春節'], ['2025-01-30','holiday','春節'], ['2025-01-31','holiday','春節'], ['2025-02-08','workday','補班日'], ['2025-02-28','holiday','和平紀念日'], ['2025-04-03','holiday','兒童節與民族掃墓節補假'], ['2025-04-04','holiday','兒童節及民族掃墓節'], ['2025-05-30','holiday','端午節補假'], ['2025-05-31','holiday','端午節'], ['2025-09-28','holiday','教師節'], ['2025-09-29','holiday','教師節補假'], ['2025-10-06','holiday','中秋節'], ['2025-10-10','holiday','國慶日'], ['2025-10-24','holiday','光復暨金門古寧頭大捷紀念日補假'], ['2025-10-25','holiday','臺灣光復暨金門古寧頭大捷紀念日'], ['2025-12-25','holiday','行憲紀念日'],
  ['2026-01-01','holiday','中華民國開國紀念日'], ['2026-02-16','holiday','除夕'], ['2026-02-17','holiday','春節'], ['2026-02-18','holiday','春節'], ['2026-02-19','holiday','春節'], ['2026-02-20','holiday','小年夜補假'], ['2026-02-27','holiday','和平紀念日補假'], ['2026-02-28','holiday','和平紀念日'], ['2026-04-03','holiday','兒童節補假'], ['2026-04-04','holiday','兒童節'], ['2026-04-05','holiday','民族掃墓節'], ['2026-04-06','holiday','民族掃墓節補假'], ['2026-05-01','holiday','勞動節'], ['2026-06-19','holiday','端午節'], ['2026-09-25','holiday','中秋節'], ['2026-09-28','holiday','教師節'], ['2026-10-09','holiday','國慶日補假'], ['2026-10-10','holiday','國慶日'], ['2026-10-25','holiday','光復節'], ['2026-10-26','holiday','台灣光復節補假'], ['2026-12-25','holiday','行憲紀念日'],
  ['2027-01-01','holiday','中華民國開國紀念日'], ['2027-02-04','holiday','小年夜'], ['2027-02-05','holiday','除夕'], ['2027-02-06','holiday','春節'], ['2027-02-07','holiday','春節'], ['2027-02-08','holiday','春節'], ['2027-02-09','holiday','春節補假'], ['2027-02-10','holiday','春節補假'], ['2027-02-28','holiday','和平紀念日'], ['2027-03-01','holiday','和平紀念日補假'], ['2027-04-04','holiday','兒童節'], ['2027-04-05','holiday','民族掃墓節'], ['2027-04-06','holiday','兒童節補假'], ['2027-04-30','holiday','勞動節補假'], ['2027-05-01','holiday','勞動節'], ['2027-06-09','holiday','端午節'], ['2027-09-15','holiday','中秋節'], ['2027-09-28','holiday','教師節'], ['2027-10-10','holiday','國慶日'], ['2027-10-11','holiday','國慶日補假'], ['2027-10-25','holiday','臺灣光復暨金門古寧頭大捷紀念日'], ['2027-12-24','holiday','行憲紀念日補假'], ['2027-12-25','holiday','行憲紀念日'], ['2027-12-31','holiday','中華民國開國紀念日補假'],
];

const specialByDate = new Map(SPECIAL_DAYS.map(([date, type, title]) => [date, { type, title }] as const));
let officialFirstYear = TAIWAN_OFFICIAL_FIRST_YEAR;
let officialLastYear = TAIWAN_OFFICIAL_LAST_YEAR;

export interface TaiwanCalendarResource {
  version: string;
  firstYear: number;
  lastYear: number;
  days: { date: string; type: TaiwanDayType; title: string }[];
}

/** 部署時下載的較新官方資料覆蓋內建日期；內建資料仍作為離線備援。 */
export function installTaiwanCalendarResource(resource: TaiwanCalendarResource) {
  if (!resource || !Array.isArray(resource.days) || !Number.isInteger(resource.firstYear) || !Number.isInteger(resource.lastYear)) throw new Error('台灣辦公日曆資料格式不正確');
  for (const day of resource.days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !['workday', 'holiday'].includes(day.type) || !day.title?.trim()) continue;
    specialByDate.set(day.date, { type: day.type, title: day.title.trim() });
  }
  officialFirstYear = Math.min(officialFirstYear, resource.firstYear);
  officialLastYear = Math.max(officialLastYear, resource.lastYear);
}

function weekend(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

export function taiwanDayInfo(date: string): TaiwanDayInfo {
  const year = Number(date.slice(0, 4));
  const source: TaiwanDaySource = year < officialFirstYear ? 'inferred' : year > officialLastYear ? 'provisional' : 'official';
  const special = specialByDate.get(date);
  if (special) return { date, source: 'official', type: special.type, title: special.title, special: true };
  return { date, source, type: weekend(date) ? 'holiday' : 'workday', title: null, special: false };
}

/** 只有國定假日、補假、調整放假與補班才成為行程；一般週末只標紅字。 */
export function taiwanSpecialDays(): TaiwanDayInfo[] {
  return [...specialByDate.entries()].map(([date, value]) => ({ date, ...value, source: 'official' as const, special: true }));
}
