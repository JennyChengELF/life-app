import { TimeField } from './TimeField';

/** 日期＋共用 24 小時時間欄位；value 維持既有 YYYY-MM-DDTHH:mm 格式。 */
export function DateTimeField({ value, onChange, label = '日期與時間', maxDate }: { value: string; onChange: (value: string) => void; label?: string; maxDate?: string }) {
  const date = value.slice(0, 10);
  const time = value.slice(11, 16) || '00:00';
  return (
    <div className="date-time-field">
      <label className="field">{label}<input type="date" value={date} max={maxDate} onChange={(event) => onChange(`${event.target.value}T${time}`)} /></label>
      <TimeField value={time} onChange={(next) => onChange(`${date}T${next}`)} label="時間（24 小時制）" />
    </div>
  );
}
