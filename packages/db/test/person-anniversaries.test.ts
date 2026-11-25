import { describe, expect, it } from 'vitest';
import { CalendarStore, expandPersonAnniversaries, HubStore, LocalBackend, memoryStorage, personAnniversaryOccurrences, personAnniversaryValues, readPersonAnniversaries } from '../src';

describe('人物紀念日', () => {
  it('國曆、農曆各自出現，只有已知出生年的生日顯示年齡', () => {
    const settings = readPersonAnniversaries({
      solarBirthday: '1983/10/12', lunarBirthday: '09/12',
      solarMemorial: '2020/11/03', lunarMemorial: '12/12',
    });
    const occurrences = personAnniversaryOccurrences(settings, '測試人物', '2026-10-01', '2027-01-20');
    expect(occurrences.map(({ date, title }) => [date, title])).toEqual([
      ['2026-10-12', '測試人物國曆生日（滿 43 歲）'],
      ['2026-10-21', '測試人物農曆生日'],
      ['2026-11-03', '測試人物國曆祭日'],
      ['2027-01-19', '測試人物農曆祭日'],
    ]);
  });

  it('有同名閏月就選閏月，沒有時可選普通月或不顯示', () => {
    const settings = readPersonAnniversaries({ lunarBirthday: '6/1', lunarBirthdayLeap: 'fallback' });
    const dates = (start: string, end: string) => personAnniversaryOccurrences(settings, '測試人物', start, end).map((row) => row.date);
    expect(dates('2025-01-01', '2025-12-31')).toEqual(['2025-07-25']);
    expect(dates('2026-01-01', '2026-12-31')).toEqual(['2026-07-14']);
    settings.lunarBirthdayLeap = 'only';
    expect(dates('2026-01-01', '2026-12-31')).toEqual([]);
    settings.lunarBirthdayLeap = 'regular';
    expect(dates('2025-01-01', '2025-12-31')).toEqual(['2025-06-25']);
  });

  it('農曆跨國曆年仍按農曆年算歲數，沒有該日的年分跳過', () => {
    const settings = readPersonAnniversaries({ lunarBirthday: '1983/12/12', solarBirthday: '02/29' });
    const entries = personAnniversaryOccurrences(settings, '測試人物', '2027-01-01', '2027-12-31');
    expect(entries).toMatchObject([{ date: '2027-01-19', title: '測試人物農曆生日（滿 43 歲）' }]);
    expect(() => personAnniversaryValues(readPersonAnniversaries({ solarBirthday: '2025/02/29' }))).toThrow('國曆生日');
  });

  it('綜合寫入人物表，行事曆唯讀顯示，不再聯繫後保留日期但不顯示', async () => {
    const backend = new LocalBackend(memoryStorage());
    const hub = new HubStore(backend);
    const calendar = new CalendarStore(backend);
    const id = await calendar.addPerson('測試人物');
    const settings = readPersonAnniversaries({ solarBirthday: '10/12' });
    await hub.savePersonAnniversaryProfile(id, settings);
    const events = expandPersonAnniversaries(await calendar.load(), '2026-10-01', '2026-10-31');
    expect(events).toMatchObject([{ peopleIds: [id], systemSource: 'personAnniversary', startDate: '2026-10-12', timeType: 'allDay' }]);
    await expect(calendar.deleteEvent(events[0])).rejects.toThrow('系統行程');
    await hub.savePersonAnniversaryProfile(id, { ...settings, noLongerInContact: true });
    expect(expandPersonAnniversaries(await calendar.load(), '2026-10-01', '2026-10-31')).toEqual([]);
    expect((await hub.loadPersonAnniversaryProfiles())[0].settings.dates.solarBirthday).toBe('10/12');
  });
});
