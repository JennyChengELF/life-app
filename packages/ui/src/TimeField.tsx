import { useEffect, useState } from 'react';
import { toHHmm } from '@life/db';

const partsOf = (value: string) => {
  const [hour = '', minute = ''] = value.split(':');
  return [hour, minute] as const;
};

/** 共用 24 小時制時間欄位，不使用可能顯示上午／下午的系統選擇器。 */
export function TimeField({ value, onChange, label = '時間' }: { value: string; onChange: (value: string) => void; label?: string }) {
  const [hour, setHour] = useState(() => partsOf(value)[0]);
  const [minute, setMinute] = useState(() => partsOf(value)[1]);

  useEffect(() => {
    const [nextHour, nextMinute] = partsOf(value);
    setHour(nextHour);
    setMinute(nextMinute);
  }, [value]);

  const commit = (nextHour: string, nextMinute: string) => {
    const h = Number(nextHour);
    const m = Number(nextMinute);
    if (/^\d{1,2}$/.test(nextHour) && /^\d{1,2}$/.test(nextMinute) && h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      onChange(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  };
  const clean = (raw: string) => raw.replace(/\D/g, '').slice(0, 2);

  return (
    <fieldset className="time-field">
      <legend>{label}</legend>
      <label>
        <span className="sr-only">小時，00 到 23</span>
        <input
          inputMode="numeric"
          value={hour}
          placeholder="00"
          aria-label="小時，00 到 23"
          onChange={(event) => {
            const next = clean(event.target.value);
            setHour(next);
            commit(next, minute);
          }}
          onBlur={() => commit(hour, minute)}
        />
      </label>
      <b aria-hidden="true">:</b>
      <label>
        <span className="sr-only">分鐘，00 到 59</span>
        <input
          inputMode="numeric"
          value={minute}
          placeholder="00"
          aria-label="分鐘，00 到 59"
          onChange={(event) => {
            const next = clean(event.target.value);
            setMinute(next);
            commit(hour, next);
          }}
          onBlur={() => commit(hour, minute)}
        />
      </label>
      <button type="button" className="link" onClick={() => onChange(toHHmm(Date.now()))}>現在</button>
    </fieldset>
  );
}
