import { useEffect, useState } from 'react';
import { Icon } from '@life/ui/icon';
import { TimeField } from '@life/ui/time-field';
import { WeekDateStrip } from '@life/ui/week-date-strip';
import type { WaterLog, WaterSnapshot } from '@life/db';
import { drinkOf, startOfDay, todayKey, toHHmm } from '@life/db';
import type { WaterApi } from '../useWater';
import { drinkColor } from '../drinkColors';
import { LogEditor } from './LogEditor';

const QUICK = [150, 250, 500];
const OTHER = '其他';

function timestamp(date: string, time: string) {
  const [hour, minute] = time.split(':').map(Number);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const result = new Date(startOfDay(date));
  result.setHours(hour, minute, 0, 0);
  return result.getTime();
}

/** 喝水新增頁：只顯示一週日期列與新增表單，不混入整月月曆或紀錄列表。 */
export function AddView({
  api,
  snap,
  date,
  setDate,
  editId,
  onDone,
  onDirtyChange,
}: {
  api: WaterApi;
  snap: WaterSnapshot;
  date: string;
  setDate: (date: string) => void;
  editId: string | null;
  onDone: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [time, setTime] = useState(() => toHHmm(Date.now()));
  const [custom, setCustom] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const log = editId ? snap.logs.find((item) => item.id === editId) ?? null : null;

  useEffect(() => {
    if (!editId) setTime(toHHmm(Date.now()));
  }, [date, editId]);

  const defaultDrink = snap.drinks[0]?.name ?? '開水';
  const drink = picked && snap.drinks.some((item) => item.name === picked) ? picked : defaultDrink;
  const showNote = drink === OTHER;
  const dirty = !!editId || custom !== '' || picked !== null || note !== '';
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  const changeDate = (next: string) => {
    if (dirty && !confirm('目前有尚未儲存的內容，確定要切換日期嗎？')) return;
    setCustom('');
    setPicked(null);
    setNote('');
    setDate(next);
  };

  const add = async (ml: number) => {
    const at = timestamp(date, time);
    if (at == null) return api.showToast({ kind: 'error', text: '請輸入正確的 24 小時制時間' });
    const selectedDrink = drink;
    const selectedNote = showNote ? note.trim() || null : null;
    const tempId = `temp-${Date.now()}`;
    const id = await api.run(
      (store) => store.addLog(ml, at, selectedDrink, selectedNote),
      (state) => ({ ...state, logs: [...state.logs, { rowNumber: -1, id: tempId, time: at, ml, drink: selectedDrink, note: selectedNote, date, createdVia: 'water' }] }),
    );
    if (!id) return;
    api.showToast({
      kind: 'info',
      text: `已記錄 ${selectedDrink}${selectedNote ? `（${selectedNote}）` : ''} +${ml}ml`,
      undo: () => api.run(async (store) => {
        const fresh = await store.load();
        const saved = fresh.logs.find((item) => item.id === id);
        if (saved) await store.deleteLog(saved);
      }, (state) => ({ ...state, logs: state.logs.filter((item) => item.id !== id) })),
    });
    setCustom('');
    setPicked(null);
    setNote('');
    onDone();
  };

  const addCustom = () => {
    const ml = Number(custom);
    if (!Number.isFinite(ml) || ml <= 0 || ml > 5000) return api.showToast({ kind: 'error', text: '請輸入 1–5000 的 ml' });
    void add(Math.round(ml));
  };

  const save = async (item: WaterLog, patch: { time: number; ml: number; drink: string; note: string | null }) => {
    await api.run((store) => store.updateLog(item, patch));
    onDone();
  };
  const remove = async (item: WaterLog) => {
    await api.run((store) => store.deleteLog(item), (state) => ({ ...state, logs: state.logs.filter((entry) => entry.id !== item.id) }));
    onDone();
  };

  return (
    <div className="add-view">
      <WeekDateStrip selected={date} setDate={changeDate} maxDate={todayKey()} />
      <section className="card">
        <h2>{log ? '修改喝水紀錄' : '新增喝水紀錄'}</h2>
        {log ? (
          <LogEditor
            date={date}
            time={log.time}
            amount={log.ml}
            unit="ml"
            drink={drinkOf(log, snap.drinks)}
            drinks={snap.drinks.map((item) => item.name)}
            note={log.note}
            noteFor={OTHER}
            onSave={(at, ml, selectedDrink, selectedNote) => save(log, { time: at, ml, drink: selectedDrink ?? drinkOf(log, snap.drinks), note: selectedNote ?? null })}
            onCancel={onDone}
            onDelete={() => remove(log)}
          />
        ) : (
          <>
            <TimeField value={time} onChange={setTime} />
            <div className="drink-pick" role="radiogroup" aria-label="喝什麼">
              {snap.drinks.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  role="radio"
                  aria-checked={drink === item.name}
                  className={drink === item.name ? 'active' : ''}
                  style={drink === item.name ? { background: drinkColor(item.name, snap.drinks), borderColor: 'transparent' } : undefined}
                  onClick={() => setPicked(item.name)}
                >{item.name}</button>
              ))}
            </div>
            {showNote && (
              <input className="note-input" type="text" placeholder="備註（可不填，例：咖啡、湯）" value={note} onChange={(event) => setNote(event.target.value)} maxLength={100} />
            )}
            <h3>快速容量</h3>
            <div className="quick">
              {QUICK.map((ml) => <button type="button" key={ml} className="quick-btn" onClick={() => void add(ml)}>+{ml}<small>ml</small></button>)}
            </div>
            {snap.cups.length > 0 && (
              <>
                <h3>常用杯子</h3>
                <div className="cups">
                  {snap.cups.map((cup) => (
                    <button type="button" key={cup.id} className="cup-btn" onClick={() => void add(cup.ml)}>
                      <Icon name="cup" size={20} /> {cup.name}<small>{cup.ml}ml</small>
                    </button>
                  ))}
                </div>
              </>
            )}
            <h3>自訂容量</h3>
            <div className="custom">
              <input type="number" inputMode="numeric" placeholder="其他 ml" value={custom} onChange={(event) => setCustom(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addCustom()} />
              <button type="button" className="primary" onClick={addCustom} disabled={!custom}>記錄 {date.slice(5).replace('-', '/')}</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
