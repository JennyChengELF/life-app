import { useState } from 'react';
import { startOfDay, toDateKey, toHHmm } from '@life/db';
import { TimeField } from '@life/ui/time-field';

/** 修改一筆紀錄的時間與數量（喝水 ml / 體重 kg 共用） */
export function LogEditor(props: {
  time: number | null;
  /** 有日期時改用共用 24 小時欄位，不顯示系統上午／下午選擇器。 */
  date?: string;
  amount: number | null;
  unit: 'ml' | 'kg';
  /** 有給 drinks 才顯示「喝什麼」 */
  drink?: string;
  drinks?: string[];
  /** 備註：選到 noteFor 這個飲品（或原本就有備註）時顯示 */
  note?: string | null;
  noteFor?: string;
  onSave: (time: number, amount: number, drink?: string, note?: string | null) => void;
  onCancel?: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
}) {
  const initialTime = props.time ?? Date.now();
  const [date, setDate] = useState(props.date ?? toDateKey(initialTime));
  const [time, setTime] = useState(toHHmm(initialTime));
  const [amount, setAmount] = useState(props.amount != null ? String(props.amount) : '');
  const [err, setErr] = useState('');
  const [drink, setDrink] = useState(props.drink ?? props.drinks?.[0] ?? '');
  // 舊紀錄的飲品已從清單刪除時，仍可保留原名稱
  const [note, setNote] = useState(props.note ?? '');
  const showNote = props.noteFor != null && (drink === props.noteFor || note !== '');
  const options = props.drinks && drink && !props.drinks.includes(drink) ? [...props.drinks, drink] : props.drinks;

  const save = () => {
    const t = (() => {
      const [hour, minute] = time.split(':').map(Number);
      if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
      const value = new Date(startOfDay(date));
      value.setHours(hour, minute, 0, 0);
      return value.getTime();
    })();
    const a = Number(amount);
    if (t == null) return setErr('請選擇時間');
    if (!Number.isFinite(a) || a <= 0) return setErr(`請輸入 ${props.unit}`);
    props.onSave(t, props.unit === 'ml' ? Math.round(a) : a, options ? drink : undefined, showNote ? note.trim() || null : null);
  };

  return (
    <div className="editor">
      <div className="editor-fields">
        {!props.date && <input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="日期" />}
        <TimeField value={time} onChange={setTime} />
        {options && (
          <select value={drink} onChange={(e) => setDrink(e.target.value)} aria-label="喝什麼">
            {options.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
        <label className="amount">
          <input
            type="number"
            inputMode="decimal"
            step={props.unit === 'kg' ? '0.1' : '1'}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {props.unit}
        </label>
        {showNote && (
          <input
            className="note-input"
            type="text"
            placeholder="備註（可不填）"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={100}
          />
        )}
      </div>
      {err && <p className="error-text small">{err}</p>}
      <div className="editor-actions">
        <button className="primary" onClick={save}>
          儲存
        </button>
        {props.onCancel && <button onClick={props.onCancel}>取消</button>}
        {props.onDelete && (
          <button className="danger" onClick={props.onDelete}>
            {props.deleteLabel ?? '刪除'}
          </button>
        )}
      </div>
    </div>
  );
}
