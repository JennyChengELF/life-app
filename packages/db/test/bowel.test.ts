import { describe, expect, it } from 'vitest';
import type { BowelLog } from '../src';
import {
  bowelEntries,
  bowelHomeMessage,
  bowelMonth,
  bowelStats,
  BowelStore,
  constipation,
  DEFAULT_BOWEL_SETTINGS,
  diarrhea,
  elapsedText,
  emptyInput,
  insufficient,
  judgeBowel,
  lastPassed,
  LocalBackend,
  memoryStorage,
  parseDateTimeText,
  parseEditHash,
} from '../src';

const at = (s: string) => parseDateTimeText(s)!;

function log(time: string, patch: Partial<BowelLog> = {}): BowelLog {
  return { ...emptyInput(), rowNumber: 2, id: time, time: at(time), date: time.slice(0, 10), createdVia: 'bowel', ...patch };
}

describe('顏色標示', () => {
  it('型態 3–5 正常、1/2/6 注意、7 異常；複選看最嚴重的', () => {
    expect(judgeBowel({ passed: true, types: ['4'], color: null, symptoms: [] })?.level).toBe('ok');
    expect(judgeBowel({ passed: true, types: ['1'], color: null, symptoms: [] })?.level).toBe('warn');
    expect(judgeBowel({ passed: true, types: ['6'], color: null, symptoms: [] })?.level).toBe('warn');
    expect(judgeBowel({ passed: true, types: ['4', '7'], color: null, symptoms: [] })).toMatchObject({ level: 'bad', label: '異常' });
  });
  it('什麼都沒填、只有未觀察 → 不標', () => {
    expect(judgeBowel({ passed: true, types: [], color: null, symptoms: [] })).toBeNull();
    expect(judgeBowel({ passed: true, types: ['未觀察'], color: '未觀察', symptoms: [] })).toBeNull();
  });
  it('綠色注意；黑色、灰白色異常且建議就醫；帶血建議就醫', () => {
    expect(judgeBowel({ passed: true, types: ['4'], color: '綠色', symptoms: [] })?.level).toBe('warn');
    expect(judgeBowel({ passed: true, types: [], color: '黑色', symptoms: [] })).toMatchObject({ level: 'bad', seeDoctor: true });
    expect(judgeBowel({ passed: true, types: [], color: '灰白色', symptoms: [] })).toMatchObject({ level: 'bad', seeDoctor: true });
    expect(judgeBowel({ passed: true, types: ['4'], color: '褐色', symptoms: ['衛生紙有血'] })).toMatchObject({ level: 'bad', seeDoctor: true, reasons: ['帶血'] });
  });
  it('沒排出：只看症狀', () => {
    expect(judgeBowel({ passed: false, types: ['7'], color: '黑色', symptoms: [] })).toBeNull();
    expect(judgeBowel({ passed: false, types: [], color: null, symptoms: ['滴血'] })?.level).toBe('bad');
  });
});

describe('規則', () => {
  it('距離上次排便：只算有排出的', () => {
    const logs = [log('2026-11-16 08:00'), log('2026-11-17 09:00', { passed: false })];
    expect(lastPassed(logs)?.id).toBe('2026-11-16 08:00');
    expect(elapsedText(at('2026-11-17 11:00') - at('2026-11-16 08:00'))).toBe('1 天 3 小時');
    expect(elapsedText(45 * 60000)).toBe('45 分鐘');
    expect(elapsedText(20000)).toBe('剛剛');
  });
  it('便秘：距離上次排出 ≥ 3 天', () => {
    const snap = { logs: [log('2026-11-15 08:00')], settings: DEFAULT_BOWEL_SETTINGS };
    expect(constipation(snap, at('2026-11-18 07:59'))).toBeNull();
    expect(constipation(snap, at('2026-11-18 08:00'))).toEqual({ days: 3 });
    expect(constipation({ logs: [], settings: DEFAULT_BOWEL_SETTINGS })).toBeNull();
  });
  it('腹瀉：一天排出 3 次以上且有 6–7 型', () => {
    const d = '2026-11-18';
    const three = [log(`${d} 08:00`, { types: ['6'] }), log(`${d} 10:00`), log(`${d} 12:00`)];
    expect(diarrhea(three, d)).toEqual({ count: 3 });
    expect(diarrhea(three.slice(0, 2), d)).toBeNull();
    expect(diarrhea([...three.slice(1), log(`${d} 13:00`, { passed: false, types: [] })], d)).toBeNull();
  });
  it('排便不足：沒排出，或只有一次且量少', () => {
    const d = '2026-11-17';
    expect(insufficient([], d)).toBe(true);
    expect(insufficient([log(`${d} 08:00`, { amount: '少量' })], d)).toBe(true);
    expect(insufficient([log(`${d} 08:00`, { amount: '普通' })], d)).toBe(false);
    expect(insufficient([log(`${d} 08:00`)], d)).toBe(false);
    expect(insufficient([log(`${d} 08:00`, { amount: '極少' }), log(`${d} 20:00`, { amount: '極少' })], d)).toBe(false);
  });
  it('首頁訊息：昨天排便較少；今天體重比前一次重 ≥ 0.3kg 加一句', () => {
    const snap = { logs: [log('2026-11-16 08:00')], settings: DEFAULT_BOWEL_SETTINGS };
    const now = at('2026-11-18 09:00');
    const weights = [
      { time: at('2026-11-17 07:00'), kg: 55.0 },
      { time: at('2026-11-18 07:00'), kg: 55.5 },
    ];
    expect(bowelHomeMessage(snap, weights, now)).toEqual({ text: '昨天排便較少，記得多喝水、多吃蔬菜', weightGain: 0.5 });
    expect(bowelHomeMessage(snap, [{ time: at('2026-11-17 07:00'), kg: 55 }, { time: at('2026-11-18 07:00'), kg: 55.2 }], now)?.weightGain).toBeNull();
    // 昨天有正常排便 → 沒有訊息
    expect(bowelHomeMessage({ ...snap, logs: [log('2026-11-17 08:00', { amount: '普通' })] }, weights, now)).toBeNull();
    // 從來沒記過 / 今天才開始記 → 不顯示
    expect(bowelHomeMessage({ ...snap, logs: [] }, weights, now)).toBeNull();
    expect(bowelHomeMessage({ ...snap, logs: [log('2026-11-18 08:00')] }, weights, now)).toBeNull();
  });
  it('統計：次數、天數、型態分布（複選的每個都算，沒排出不算）', () => {
    const logs = [
      log('2026-11-10 08:00', { types: ['4'] }),
      log('2026-11-10 20:00', { types: ['1', '4'] }),
      log('2026-11-12 08:00', { passed: false }),
      log('2026-11-13 08:00'),
    ];
    const s = bowelStats(logs, '2026-11-10', '2026-11-16');
    expect(s).toMatchObject({ count: 3, days: 2, totalDays: 7, notPassed: 1, noType: 1 });
    expect(s.types.find((t) => t.type === '4')?.count).toBe(2);
    expect(s.types.find((t) => t.type === '1')?.count).toBe(1);
  });
  it('月曆：每天最嚴重的；只有沒排出的另外標', () => {
    const days = bowelMonth(
      [log('2026-11-02 08:00', { types: ['4'] }), log('2026-11-02 20:00', { types: ['7'] }), log('2026-11-03 08:00', { passed: false })],
      '2026-11',
    );
    expect(days).toHaveLength(30);
    expect(days[1]).toMatchObject({ date: '2026-11-02', count: 2, level: 'bad' });
    expect(days[2]).toMatchObject({ count: 0, onlyNotPassed: true });
    expect(days[0]).toMatchObject({ count: 0, level: null, onlyNotPassed: false });
  });
});

describe('資料存取', () => {
  it('新增（先給 id）、修改部分欄位、刪除', async () => {
    const b = new LocalBackend(memoryStorage());
    const s = new BowelStore(b);
    const id = await s.addLog({}, at('2026-11-10 08:00'), 'MYID');
    expect(id).toBe('MYID');
    let snap = await s.load();
    expect(snap.logs[0]).toMatchObject({ id: 'MYID', passed: true, types: [], amount: null, date: '2026-11-10' });
    await s.updateLog(snap.logs[0], { types: ['4', '1'], amount: '普通', symptoms: ['腹脹', '腹痛'] });
    snap = await s.load();
    // 依選項順序存
    expect(snap.logs[0]).toMatchObject({ types: ['1', '4'], amount: '普通', symptoms: ['腹痛', '腹脹'] });
    const rows = await b.read('bowelLogs');
    expect(rows[0].values.types).toBe('1、4');
    await s.updateLog(snap.logs[0], { color: '褐色' });
    snap = await s.load();
    expect(snap.logs[0]).toMatchObject({ types: ['1', '4'], amount: '普通', color: '褐色' });
    // 改成沒排出：型態 / 量 / 顏色清掉
    await s.updateLog(snap.logs[0], { passed: false });
    snap = await s.load();
    expect(snap.logs[0]).toMatchObject({ passed: false, types: [], amount: null, color: null, symptoms: ['腹痛', '腹脹'] });
    await s.deleteLog(snap.logs[0]);
    expect((await s.load()).logs).toHaveLength(0);
  });
  it('不在選項裡的值不能存', async () => {
    const s = new BowelStore(new LocalBackend(memoryStorage()));
    await expect(s.addLog({ amount: '超多' as never })).rejects.toThrow('量');
    await expect(s.addLog({}, Date.now() + 3600000)).rejects.toThrow('未來');
  });
  it('試算表直接輸入：補 id、passed 空白算有排出、看不懂的列入需要補齊', async () => {
    const b = new LocalBackend(memoryStorage());
    await b.append('bowelLogs', [
      { time: at('2026-11-18 08:00'), types: '4 光滑長條、1', amount: '普通' },
      { time: at('2026-11-18 09:00'), amount: '很多' },
      { types: '4' },
    ]);
    const snap = await new BowelStore(b).load();
    expect(snap.logs).toHaveLength(1);
    expect(snap.logs[0]).toMatchObject({ passed: true, types: ['1', '4'], createdVia: 'sheet' });
    expect(snap.logs[0].id).toHaveLength(26);
    expect(snap.issues.map((i) => i.problems[0])).toEqual(['量「很多」看不懂（請填：極少、少量、普通、普通偏多、大量）', '沒有填時間']);
  });
  it('設定', async () => {
    const s = new BowelStore(new LocalBackend(memoryStorage()));
    expect((await s.load()).settings).toEqual(DEFAULT_BOWEL_SETTINGS);
    await s.saveSettings({ constipationDays: 4, weightGainKg: 0.5 });
    await s.saveSettings({ constipationDays: 5, weightGainKg: 0.5 });
    expect((await s.load()).settings).toEqual({ constipationDays: 5, weightGainKg: 0.5 });
    await expect(s.saveSettings({ constipationDays: 0, weightGainKg: 0.5 })).rejects.toThrow();
  });
  it('時間軸、從首頁打開', () => {
    const e = bowelEntries({ loadedAt: 0, logs: [log('2026-11-18 08:00', { types: ['7'], symptoms: ['腹痛'] })], settings: DEFAULT_BOWEL_SETTINGS, issues: [] }, '2026-11-18');
    expect(e[0]).toMatchObject({ icon: 'toilet', value: '7 水狀', extra: '腹痛', ref: { app: 'bowel', kind: 'bowel' } });
    expect(e[0].judge?.level).toBe('bad');
    expect(parseEditHash('#edit/bowel/ABC')).toEqual({ kind: 'bowel', id: 'ABC' });
  });
});
