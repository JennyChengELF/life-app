/** 血壓、血糖、體溫共用的小元件 */
import { useState, type ReactNode } from 'react';
import type { Judge } from '@life/db';
import { toInputDateTime } from '@life/db';
import type { HealthApi } from '../useHealth';

/** 顏色標示（一定附文字，不只靠顏色） */
export function Badge({ judge }: { judge: Judge | null }) {
  if (!judge) return null;
  return <span className={`lv ${judge.level}`}>{judge.label}</span>;
}

export const RANGES = [
  { key: 30, label: '30 天' },
  { key: 90, label: '90 天' },
  { key: 365, label: '1 年' },
  { key: 0, label: '全部' },
] as const;

export function RangeSeg({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="seg">
      {RANGES.map((r) => (
        <button key={r.key} className={value === r.key ? 'active' : ''} onClick={() => onChange(r.key)}>
          {r.label}
        </button>
      ))}
    </div>
  );
}

export const sinceOf = (days: number) => (days ? Date.now() - days * 86400000 : -Infinity);

/** 一排選項（測量時機、種類、部位） */
export function Choice<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T | null; onChange: (v: T) => void }) {
  return (
    <div className="choice" role="radiogroup">
      {options.map((o) => (
        <button key={o} role="radio" aria-checked={value === o} className={value === o ? 'active' : ''} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

/**
 * 輸入畫面的外框：時間、備註、儲存 / 取消 / 刪除。
 * save 回傳 true 表示存好了；again = 「存好再記一筆」（血壓一次量 2 遍用）
 */
export function VitalFormShell(props: {
  title: string;
  api: HealthApi;
  editing: boolean;
  time: string;
  setTime: (t: string) => void;
  note: string;
  setNote: (n: string) => void;
  onSave: (timeMs: number, note: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onClose: () => void;
  /** 有的話顯示「儲存，再量一次」 */
  onSaveAgain?: () => void;
  children: ReactNode;
}) {
  const { api } = props;
  const save = async (again: boolean) => {
    const ms = new Date(props.time).getTime();
    if (!Number.isFinite(ms)) return api.showToast({ kind: 'error', text: '請輸入時間' });
    const ok = await props.onSave(ms, props.note);
    if (!ok) return;
    if (again && props.onSaveAgain) props.onSaveAgain();
    else props.onClose();
  };
  return (
    <section className="card">
      <h2>{props.title}</h2>
      <label className="field">
        量的時間
        <input type="datetime-local" value={props.time} onChange={(e) => props.setTime(e.target.value)} />
      </label>
      {props.children}
      <label className="field">
        備註
        <input value={props.note} onChange={(e) => props.setNote(e.target.value)} />
      </label>
      <div className="editor-actions">
        <button className="primary big" onClick={() => save(false)} disabled={api.busy}>
          儲存
        </button>
        {props.onSaveAgain && !props.editing && (
          <button onClick={() => save(true)} disabled={api.busy}>
            儲存，再量一次
          </button>
        )}
        <button onClick={props.onClose}>取消</button>
        {props.editing && (
          <button
            className="danger"
            onClick={async () => {
              if (confirm('確定要刪除這筆紀錄嗎？') && (await props.onDelete())) props.onClose();
            }}
          >
            刪除
          </button>
        )}
      </div>
    </section>
  );
}

/** 時間輸入框的狀態（新增時預設現在） */
export function useTimeInput(initial?: number) {
  return useState(toInputDateTime(initial ?? Date.now()));
}

/** 數字輸入框 */
export function NumField(props: { label: ReactNode; unit: string; value: string; onChange: (v: string) => void; step?: number; autoFocus?: boolean; hint?: ReactNode }) {
  return (
    <label className="field">
      {props.label}
      <div className="input-unit">
        <input type="number" inputMode="decimal" step={props.step ?? 1} value={props.value} onChange={(e) => props.onChange(e.target.value)} autoFocus={props.autoFocus} />
        <span className="unit">{props.unit}</span>
      </div>
      {props.hint}
    </label>
  );
}
