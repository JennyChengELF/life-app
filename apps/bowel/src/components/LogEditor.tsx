import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { BowelInput, BowelLog, BowelType, SingleField, Symptom } from '@life/db';
import { BOWEL_TYPES, judgeBowel, parseDateTimeText, SINGLE_FIELDS, SYMPTOMS, toDateKey, toInputDateTime, typeLabel } from '@life/db';
import type { BowelApi } from '../useBowel';
import { COLOR_SWATCH, TypeIcon } from './icons';
import { DateTimeField } from '@life/ui/date-time-field';

type Patch = Partial<BowelInput> & { time?: number };

/** 「更多」裡的單選欄位（排出時）；沒排出只有感受、順暢度（2026-11-18 確認） */
const MORE_PASSED: SingleField[] = ['afterFeeling', 'ease', 'urgency', 'duration', 'smellLevel', 'smellType'];
const MORE_NOT_PASSED: SingleField[] = ['afterFeeling', 'ease'];

/**
 * 一筆紀錄的詳細欄位：每點一個選項就自動存（2026-11-18 確認）。
 * 剛新增、還沒寫進試算表的（rowNumber < 0）先記在 pending，寫好後一起存。
 */
export function LogEditor(props: { api: BowelApi; log: BowelLog; onClose: () => void; onMoved: (date: string) => void }) {
  const { api, log } = props;
  const [d, setD] = useState<BowelLog>(log);
  const [time, setTime] = useState(toInputDateTime(log.time));
  const [note, setNote] = useState(log.note ?? '');
  const filledMore = MORE_PASSED.filter((k) => log[k] != null).length + (log.symptoms.length ? 1 : 0) + (log.note ? 1 : 0);
  const [more, setMore] = useState(false);
  const latest = useRef(log);
  latest.current = log;
  const pending = useRef<Patch>({});

  const write = (patch: Patch) =>
    api.run(
      (s) => s.updateLog(latest.current, patch),
      (s) => ({ ...s, logs: s.logs.map((l) => (l.id === log.id ? { ...l, ...patch, ...(patch.time ? { date: toDateKey(patch.time) } : {}) } : l)) }),
    );

  // 新增的那一筆寫進試算表後，把等著的修改存進去
  useEffect(() => {
    if (log.rowNumber < 0 || !Object.keys(pending.current).length) return;
    const p = pending.current;
    pending.current = {};
    write(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.rowNumber]);

  const commit = (patch: Patch) => {
    const selected = patch.types;
    const full: Patch = selected
      ? selected.length
        ? { ...patch, passed: true }
        : { ...patch, passed: false, amount: null, color: null }
      : patch.passed === false
        ? { ...patch, types: [], amount: null, color: null }
        : patch;
    setD((x) => ({ ...x, ...full }));
    if (latest.current.rowNumber < 0) pending.current = { ...pending.current, ...full };
    else write(full);
  };

  const toggleType = (t: BowelType) => {
    let next: BowelType[];
    if (d.types.includes(t)) next = d.types.filter((x) => x !== t);
    else if (t === '未觀察') next = ['未觀察'];
    else next = [...d.types.filter((x) => x !== '未觀察'), t];
    commit({ types: next });
  };
  const toggleSymptom = (s: Symptom) => {
    let next = d.symptoms.includes(s) ? d.symptoms.filter((x) => x !== s) : [...d.symptoms, s];
    // 「無特殊狀況」和其他症狀不會同時成立
    if (s === '無特殊狀況' && next.includes(s)) next = [s];
    else if (s !== '無特殊狀況') next = next.filter((x) => x !== '無特殊狀況');
    commit({ symptoms: next });
  };
  const single = (k: SingleField) => (
    <Field key={k} label={SINGLE_FIELDS[k].label}>
      <Chips
        options={SINGLE_FIELDS[k].options}
        isOn={(o) => d[k] === o}
        onTap={(o) => commit({ [k]: d[k] === o ? null : o } as Patch)}
        swatch={k === 'color' ? (o) => COLOR_SWATCH[o] : undefined}
      />
    </Field>
  );

  const saveTime = (v: string) => {
    setTime(v);
    const ms = parseDateTimeText(v.replace('T', ' '));
    if (ms == null || ms === d.time) return;
    if (ms > Date.now() + 5 * 60000) return api.showToast({ kind: 'error', text: '時間不能是未來' });
    commit({ time: ms });
    if (toDateKey(ms) !== toDateKey(d.time)) props.onMoved(toDateKey(ms));
  };
  const saveNote = () => {
    const n = note.trim() || null;
    if (n !== (d.note ?? null)) commit({ note: n });
  };
  const close = () => {
    saveNote();
    props.onClose();
  };
  const remove = async () => {
    if (!confirm('確定要刪除這筆紀錄嗎？')) return;
    props.onClose();
    await api.run(
      (s) => s.deleteLog(latest.current),
      (s) => ({ ...s, logs: s.logs.filter((l) => l.id !== log.id) }),
    );
  };

  const judge = judgeBowel(d);
  const showMore = !d.passed || more;
  const symptomsField = (
    <Field label="症狀（可複選）">
      <Chips options={SYMPTOMS} isOn={(o) => d.symptoms.includes(o)} onTap={toggleSymptom} />
    </Field>
  );
  const noteField = (
    <label className="field">
      備註
      <input type="text" value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} maxLength={200} />
    </label>
  );

  return (
    <div className="editor bowel-editor">
      <div className="ed-head">
        <DateTimeField value={time} onChange={saveTime} label="排便日期" maxDate={toDateKey(Date.now())} />
        <span className="ed-kind">{d.passed ? '💩 有排出' : '尚未選型態（沒排出）'}</span>
        {judge && <span className={`lv ${judge.level}`}>{judge.label}</span>}
      </div>
      {judge?.seeDoctor && <p className="msg warn small">⚠️ {judge.reasons.join('、')}：建議就醫檢查</p>}

      <Field label="型態（可複選；沒選＝沒排出）">
        <div className="choice types">
          {BOWEL_TYPES.map((t) => (
            <button key={t} role="checkbox" aria-checked={d.types.includes(t)} className={d.types.includes(t) ? 'active' : ''} onClick={() => toggleType(t)}>
              <TypeIcon type={t} />
              {typeLabel(t)}
            </button>
          ))}
        </div>
      </Field>

      {d.passed && (
        <>
          {single('amount')}
          {single('color')}
          <button className="link more-btn" onClick={() => setMore(!more)} aria-expanded={more}>
            {more ? '收起 ▴' : `更多${filledMore ? `（已填 ${filledMore} 項）` : ''} ▾`}
          </button>
        </>
      )}

      {showMore && (
        <>
          {(d.passed ? MORE_PASSED : MORE_NOT_PASSED).map(single)}
          {symptomsField}
          {noteField}
        </>
      )}

      <div className="editor-actions">
        <button className="primary" onClick={close}>
          完成
        </button>
        <button className="danger" onClick={remove} disabled={log.rowNumber < 0}>
          刪除
        </button>
        {(api.busy || log.rowNumber < 0) && <span className="muted small">儲存中⋯⋯</span>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      {label}
      {children}
    </div>
  );
}

function Chips<T extends string>(props: { options: readonly T[]; isOn: (o: T) => boolean; onTap: (o: T) => void; swatch?: (o: T) => string | undefined }) {
  return (
    <div className="choice">
      {props.options.map((o) => {
        const sw = props.swatch?.(o);
        return (
          <button key={o} aria-pressed={props.isOn(o)} className={props.isOn(o) ? 'active' : ''} onClick={() => props.onTap(o)}>
            {sw && <i className="swatch" style={{ background: sw }} />}
            {o}
          </button>
        );
      })}
    </div>
  );
}
