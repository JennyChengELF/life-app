import { useState } from 'react';
import { parseDateTimeText, toInputDateTime } from '@life/db';

/** 修改一筆紀錄的時間與數量（喝水 ml / 體重 kg 共用） */
export function LogEditor(props: {
  time: number | null;
  amount: number | null;
  unit: 'ml' | 'kg';
  onSave: (time: number, amount: number) => void;
  onCancel?: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
}) {
  const [time, setTime] = useState(props.time != null ? toInputDateTime(props.time) : toInputDateTime(Date.now()));
  const [amount, setAmount] = useState(props.amount != null ? String(props.amount) : '');
  const [err, setErr] = useState('');

  const save = () => {
    const t = parseDateTimeText(time);
    const a = Number(amount);
    if (t == null) return setErr('請選擇時間');
    if (!Number.isFinite(a) || a <= 0) return setErr(`請輸入 ${props.unit}`);
    props.onSave(t, props.unit === 'ml' ? Math.round(a) : a);
  };

  return (
    <div className="editor">
      <div className="editor-fields">
        <input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
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
