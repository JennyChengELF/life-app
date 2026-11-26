import { useEffect, useRef, useState } from 'react';
import { toHHmm } from '@life/db';

const partsOf = (value: string) => {
  const [hour = '', minute = ''] = value.split(':');
  return [hour, minute] as const;
};

/** 共用 24 小時制時間欄位，不使用可能顯示上午／下午的系統選擇器。 */
export function TimeField({ value, onChange, label = '時間', showNow = true, allowEmpty = false }: { value: string; onChange: (value: string) => void; label?: string; showNow?: boolean; allowEmpty?: boolean }) {
  const [hour, setHour] = useState(() => partsOf(value)[0]);
  const [minute, setMinute] = useState(() => partsOf(value)[1]);
  const minuteInput = useRef<HTMLInputElement>(null);
  const emitted = useRef<string | null>(null);

  useEffect(() => {
    if (emitted.current === value) return;
    emitted.current = null;
    const [nextHour, nextMinute] = partsOf(value);
    setHour(nextHour);
    setMinute(nextMinute);
  }, [value]);

  const emit = (next: string) => {
    emitted.current = next;
    if (value !== next) onChange(next);
  };
  const valid = (part: string, max: number) => /^\d{1,2}$/.test(part) && Number(part) <= max;
  const pad = (part: string) => part.padStart(2, '0');
  const commit = (h: string, m: string) => {
    if (valid(h, 23) && valid(m, 59)) emit(`${pad(h)}:${pad(m)}`);
    else if (allowEmpty && !h && !m) emit('');
  };
  const clean = (raw: string) => raw.replace(/\D/g, '');
  const replace = (next: string) => {
    const [h, m] = partsOf(next);
    setHour(h);
    setMinute(m);
    emit(next);
  };

  return (
    <fieldset className="time-field" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        const [h, m] = partsOf(value);
        setHour(h);
        setMinute(m);
      }
    }}>
      <legend>{label}</legend>
      <label>
        <span className="sr-only">小時，00 到 23</span>
        <input
          inputMode="numeric"
          value={hour}
          placeholder={allowEmpty ? '–' : '00'}
          aria-label="小時，00 到 23"
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            const next = clean(event.target.value);
            if (next.length > 2) return;
            setHour(next);
            commit(next, minute);
            if (next.length === 2 && valid(next, 23)) minuteInput.current?.focus();
          }}
          onBlur={() => setHour((h) => valid(h, 23) ? pad(h) : h)}
        />
      </label>
      <b aria-hidden="true">:</b>
      <label>
        <span className="sr-only">分鐘，00 到 59</span>
        <input
          ref={minuteInput}
          inputMode="numeric"
          value={minute}
          placeholder={allowEmpty ? '–' : '00'}
          aria-label="分鐘，00 到 59"
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            const next = clean(event.target.value);
            if (next.length > 2) return;
            setMinute(next);
            commit(hour, next);
          }}
          onBlur={() => setMinute((m) => valid(m, 59) ? pad(m) : m)}
        />
      </label>
      {showNow && <button type="button" className="link" onClick={() => replace(toHHmm(Date.now()))}>現在</button>}
      {allowEmpty && (value || hour || minute) && <button type="button" className="link" onClick={() => replace('')}>清除時間</button>}
    </fieldset>
  );
}
