import { useState } from 'react';
import type { HealthSnapshot, LabItem, LabItemInput, LabKind, LabReport, LabResult, LabResultInput } from '@life/db';
import { judgeLab, LAB_KINDS, rangeOf, rangeText, startOfDay, todayKey } from '@life/db';
import type { HealthApi } from '../useHealth';
import type { LabOpen, Nav } from '../App';
import { parseNum } from '../format';
import { TrendChart } from './TrendChart';
import { Badge, Choice } from './vital';

const itemOf = (snap: HealthSnapshot, name: string) => snap.labItems.find((i) => i.name === name) ?? null;
const resultsOf = (snap: HealthSnapshot, reportId: string) => snap.labResults.filter((r) => r.reportId === reportId);
const showDate = (d: string) => d.replace(/-/g, '/');
const showResult = (r: LabResult, item: LabItem | null) => (r.value != null ? `${r.value}${item?.unit ? ` ${item.unit}` : ''}` : (r.text ?? ''));

export function LabView({ api, snap, nav, open }: { api: HealthApi; snap: HealthSnapshot; nav: Nav; open: LabOpen }) {
  if (open?.mode === 'items') return <div><button type="button" className="link more-back" onClick={() => nav.go('more')}>返回更多</button><LabList api={api} snap={snap} nav={nav} initialView="items" /></div>;
  if (open?.mode === 'stats') return <div><button type="button" className="link more-back" onClick={() => nav.go('stats')}>返回健康統計</button><ItemTrend snap={snap} nav={nav} /></div>;
  if (open?.mode === 'detail') {
    const report = snap.labReports.find((r) => r.id === open.id);
    if (report) return <ReportDetail api={api} snap={snap} nav={nav} report={report} />;
  }
  if (open?.mode === 'form') {
    const report = open.id ? (snap.labReports.find((r) => r.id === open.id) ?? null) : null;
    return <ReportForm api={api} snap={snap} nav={nav} report={report} initialDate={open.date} />;
  }
  return <LabList api={api} snap={snap} nav={nav} />;
}

// ───────────── 列表 ─────────────

function LabList({ api, snap, nav, initialView = 'reports' }: { api: HealthApi; snap: HealthSnapshot; nav: Nav; initialView?: 'reports' | 'trend' | 'items' }) {
  const [view, setView] = useState<'reports' | 'trend' | 'items'>(initialView);
  return (
    <div className="vital">
      <button className="primary big full" onClick={() => nav.lab({ mode: 'form', id: null })}>
        🧪 新增檢驗報告
      </button>
      <div className="chips">
        {(
          [
            ['reports', '報告'],
            ['trend', '各項趨勢'],
            ['items', '項目清單'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={view === k ? 'active' : ''} onClick={() => setView(k)}>
            {label}
          </button>
        ))}
      </div>
      {view === 'reports' && <ReportList snap={snap} nav={nav} />}
      {view === 'trend' && <ItemTrend snap={snap} nav={nav} />}
      {view === 'items' && <ItemsCard api={api} snap={snap} />}
    </div>
  );
}

function abnormalCount(snap: HealthSnapshot, reportId: string) {
  const judges = resultsOf(snap, reportId).map((r) => judgeLab(r, itemOf(snap, r.item)));
  return { warn: judges.filter((j) => j?.level === 'warn').length, bad: judges.filter((j) => j?.level === 'bad').length, n: judges.length };
}

function ReportList({ snap, nav }: { snap: HealthSnapshot; nav: Nav }) {
  const reports = [...snap.labReports].reverse();
  if (!reports.length) return <p className="muted center-text">還沒有檢驗報告</p>;
  return (
    <section className="card">
      <ul className="timeline">
        {reports.map((rep) => {
          const c = abnormalCount(snap, rep.id);
          const bad = c.warn + c.bad;
          return (
            <li key={rep.id} onClick={() => nav.lab({ mode: 'detail', id: rep.id })}>
              <span className="tl-time">{showDate(rep.date)}</span>
              <span className="tl-main">
                <span className="tl-value">{rep.kind}</span> <span className="tl-name">{rep.place ?? ''}</span>
                <div className="tl-extra">{c.n} 項</div>
              </span>
              {bad > 0 ? <Badge judge={{ level: c.bad ? 'bad' : 'warn', label: `${bad} 項異常` }} /> : c.n > 0 && <Badge judge={{ level: 'ok', label: '都正常' }} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ───────────── 一份報告 ─────────────

function ReportDetail({ api, snap, nav, report }: { api: HealthApi; snap: HealthSnapshot; nav: Nav; report: LabReport }) {
  const results = resultsOf(snap, report.id);
  const remove = async () => {
    if (!confirm('確定要刪除這份報告和裡面所有的結果嗎？')) return;
    const ok = await api.run((s) => s.deleteLabReport(report, snap.labResults).then(() => true));
    if (ok) nav.closeLab();
  };
  return (
    <div className="vital">
      <section className="card">
        <div className="sum-head">
          <h2>
            🧪 {report.kind} {report.place && <span className="muted">· {report.place}</span>}
          </h2>
          <span className="muted small">檢驗日期 {showDate(report.date)}</span>
        </div>
        {report.note && <p className="small muted">📝 {report.note}</p>}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>項目</th>
                <th>結果</th>
                <th>正常範圍</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const item = itemOf(snap, r.item);
                const range = rangeOf(r, item);
                return (
                  <tr key={r.id}>
                    <td>
                      {r.item}
                      {r.date && r.date !== report.date && <div className="tl-extra">{showDate(r.date)}</div>}
                    </td>
                    <td className="num">{showResult(r, item)}</td>
                    <td className="num muted small">
                      {item?.type === '文字' ? '' : rangeText(range.low, range.high)}
                      {!range.fromReport && (range.low != null || range.high != null) && <div className="tl-extra">預設</div>}
                    </td>
                    <td className="num">
                      <Badge judge={judgeLab(r, item)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="editor-actions">
          <button className="primary" onClick={() => nav.closeLab({ mode: 'form', id: report.id })}>
            修改
          </button>
          <button onClick={() => nav.closeLab()}>回去</button>
          <button className="danger" onClick={remove} disabled={api.busy}>
            刪除
          </button>
        </div>
      </section>
      <p className="muted small">正常範圍：有填報告上印的就用報告的，沒有才用項目清單的預設（標「預設」）。</p>
    </div>
  );
}

// ───────────── 新增 / 修改報告 ─────────────

interface Row {
  key: string;
  id?: string;
  item: string;
  value: string;
  refLow: string;
  refHigh: string;
}

const str = (n: number | null) => (n == null ? '' : String(n));
let rowSeq = 0;
const newRow = (item: string, refLow: number | null = null, refHigh: number | null = null, extra: Partial<Row> = {}): Row => ({
  key: `r${++rowSeq}`,
  item,
  value: '',
  refLow: str(refLow),
  refHigh: str(refHigh),
  ...extra,
});

/** 新增報告時先列出的項目：上一次同種類報告做過的（範圍一起帶入）；沒有就列出全部項目 */
function templateRows(snap: HealthSnapshot, kind: LabKind): Row[] {
  const last = [...snap.labReports].reverse().find((r) => r.kind === kind) ?? snap.labReports[snap.labReports.length - 1];
  if (last) {
    const rows = resultsOf(snap, last.id)
      .filter((r) => itemOf(snap, r.item))
      .map((r) => newRow(r.item, r.refLow, r.refHigh));
    if (rows.length) return rows;
  }
  return snap.labItems.map((i) => newRow(i.name));
}

function ReportForm({ api, snap, nav, report, initialDate }: { api: HealthApi; snap: HealthSnapshot; nav: Nav; report: LabReport | null; initialDate?: string }) {
  const existing = report ? resultsOf(snap, report.id) : [];
  const [date, setDate] = useState(report?.date ?? initialDate ?? todayKey());
  const [kind, setKindRaw] = useState<LabKind>(report?.kind ?? '健檢');
  const [place, setPlace] = useState(report?.place ?? '');
  const [note, setNote] = useState(report?.note ?? '');
  const [rows, setRows] = useState<Row[]>(() =>
    report
      ? existing.map((r) => newRow(r.item, r.refLow, r.refHigh, { id: r.id, value: r.value != null ? String(r.value) : (r.text ?? '') }))
      : templateRows(snap, '健檢'),
  );
  const [touched, setTouched] = useState(!!report);
  const [adding, setAdding] = useState('');

  // 新增時換種類：還沒填東西的話，換成那個種類上一次的項目
  const setKind = (k: LabKind) => {
    setKindRaw(k);
    if (!touched) setRows(templateRows(snap, k));
  };
  const update = (key: string, patch: Partial<Row>) => {
    setTouched(true);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const unused = snap.labItems.filter((i) => !rows.some((r) => r.item === i.name));
  const filled = rows.filter((r) => r.value.trim()).length;

  const save = async () => {
    const input: LabResultInput[] = [];
    for (const r of rows) {
      const item = itemOf(snap, r.item);
      if (!item) continue;
      const lo = parseNum(r.refLow);
      const hi = parseNum(r.refHigh);
      const v = item.type === '數字' ? parseNum(r.value) : null;
      if ([lo, hi, v].some((x) => Number.isNaN(x))) return api.showToast({ kind: 'error', text: `${r.item} 要填數字` });
      input.push({ id: r.id, item: r.item, value: v, text: item.type === '文字' ? r.value.trim() || null : null, refLow: lo, refHigh: hi });
    }
    const id = await api.run((s) =>
      s.saveLabReport({ date, kind, place: place || null, note: note || null }, input, snap.labItems, report ? { report, results: existing } : undefined),
    );
    if (id) {
      api.showToast({ kind: 'info', text: report ? '已修改' : `已新增報告（${input.filter((r) => r.value != null || r.text).length} 項）` });
      nav.closeLab({ mode: 'detail', id });
    }
  };

  return (
    <div className="lab-form">
      <section className="card">
        <h2>{report ? '修改檢驗報告' : '新增檢驗報告'}</h2>
        <div className="form-grid">
          <label className="field">
            檢驗日期
            <input type="date" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            醫院 / 診所
            <input value={place} onChange={(e) => setPlace(e.target.value)} />
          </label>
        </div>
        <div className="field">
          種類
          <Choice options={LAB_KINDS} value={kind} onChange={setKind} />
        </div>
        <label className="field">
          備註
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </section>

      <section className="card">
        <h2>結果（已填 {filled} 項）</h2>
        <p className="muted small">沒填結果的項目不會存。正常範圍填報告上印的；空白就用項目清單的預設。</p>
        <ul className="lab-rows">
          {rows.map((r) => {
            const item = itemOf(snap, r.item);
            if (!item) return null;
            const v = item.type === '數字' ? parseNum(r.value) : null;
            const judge =
              r.value.trim() && !Number.isNaN(v)
                ? judgeLab({ value: v, text: item.type === '文字' ? r.value : null, refLow: parseNum(r.refLow) ?? null, refHigh: parseNum(r.refHigh) ?? null }, item)
                : null;
            return (
              <li key={r.key} className={r.value.trim() ? 'has' : ''}>
                <div className="lab-row-head">
                  <span className="lab-name">
                    {item.name} {item.unit && <span className="muted small">{item.unit}</span>}
                  </span>
                  <Badge judge={judge} />
                  <button className="icon-small" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`拿掉 ${item.name}`}>
                    ✕
                  </button>
                </div>
                {item.type === '文字' ? (
                  <Choice options={item.options} value={r.value || null} onChange={(o) => update(r.key, { value: r.value === o ? '' : o })} />
                ) : (
                  <div className="lab-row-inputs">
                    <input type="number" inputMode="decimal" step="any" placeholder="結果" value={r.value} onChange={(e) => update(r.key, { value: e.target.value })} />
                    <span className="muted small">範圍</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      className="narrow"
                      placeholder={item.refLow != null ? String(item.refLow) : '下限'}
                      value={r.refLow}
                      onChange={(e) => update(r.key, { refLow: e.target.value })}
                      aria-label="正常範圍下限"
                    />
                    –
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      className="narrow"
                      placeholder={item.refHigh != null ? String(item.refHigh) : '上限'}
                      value={r.refHigh}
                      onChange={(e) => update(r.key, { refHigh: e.target.value })}
                      aria-label="正常範圍上限"
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {unused.length > 0 && (
          <div className="row">
            <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="加項目">
              <option value="">加其他項目⋯</option>
              {unused.map((i) => (
                <option key={i.id} value={i.name}>
                  {i.name}
                </option>
              ))}
            </select>
            <button
              disabled={!adding}
              onClick={() => {
                setRows((rs) => [...rs, newRow(adding)]);
                setAdding('');
              }}
            >
              加入
            </button>
          </div>
        )}
        <p className="muted small">清單裡沒有的項目，先到「項目清單」新增。</p>
      </section>
      <div className="editor-actions sticky-actions">
        <button className="primary big" onClick={save} disabled={api.busy}>
          儲存
        </button>
        <button onClick={() => nav.closeLab(report ? { mode: 'detail', id: report.id } : undefined)}>取消</button>
      </div>
    </div>
  );
}

// ───────────── 各項趨勢 ─────────────

function ItemTrend({ snap, nav }: { snap: HealthSnapshot; nav: Nav }) {
  const reportOf = (id: string) => snap.labReports.find((r) => r.id === id);
  const dateOf = (r: LabResult) => r.date ?? reportOf(r.reportId)?.date ?? '';
  const withData = snap.labItems.filter((i) => snap.labResults.some((r) => r.item === i.name));
  const count = (name: string) => snap.labResults.filter((r) => r.item === name).length;
  const [name, setName] = useState(() => [...withData].sort((a, b) => count(b.name) - count(a.name))[0]?.name ?? '');
  const [query, setQuery] = useState('');
  const [attentionOnly, setAttentionOnly] = useState(false);
  if (!withData.length) return <p className="muted center-text">還沒有檢驗結果</p>;
  const choices = withData.filter((entry) => !query.trim() || entry.name.includes(query.trim()));
  const selectedName = withData.some((entry) => entry.name === name) ? name : choices[0]?.name ?? withData[0].name;
  const item = itemOf(snap, selectedName);
  const list = snap.labResults.filter((r) => r.item === selectedName).sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
  const shown = attentionOnly ? list.filter((result) => {
    const level = judgeLab(result, item)?.level;
    return level === 'warn' || level === 'bad';
  }) : list;
  const latest = list[list.length - 1];
  const pts = list.filter((r) => r.value != null).map((r) => ({ time: startOfDay(dateOf(r)) + 12 * 3600e3, value: r.value! }));
  const refs = [
    ...(item?.refLow != null ? [{ value: item.refLow, label: `下限 ${item.refLow}` }] : []),
    ...(item?.refHigh != null ? [{ value: item.refHigh, label: `上限 ${item.refHigh}` }] : []),
  ];
  return (
    <>
      <input className="note-input" type="search" placeholder="搜尋檢驗項目" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="chips">
        {choices.map((i) => (
          <button key={i.id} className={i.name === selectedName ? 'active' : ''} onClick={() => setName(i.name)}>
            {i.name}
          </button>
        ))}
      </div>
      {latest && <section className="card"><h2>{selectedName}最近結果</h2><div className="big-num">{showResult(latest, item)} <Badge judge={judgeLab(latest, item)} /></div><p className="muted small">{showDate(dateOf(latest))}・參考範圍 {item?.type === '文字' ? '依文字判斷' : rangeText(rangeOf(latest, item).low, rangeOf(latest, item).high) || '未設定'}</p></section>}
      {item?.type === '數字' && (
        <section className="card">
          <h2>{selectedName}</h2>
          <TrendChart points={pts} unit={item.unit} format={(v) => String(Number(v.toFixed(2)))} refs={refs} />
          <p className="muted small">虛線是項目清單的預設範圍；每次報告印的範圍可能不同，以下表為準。</p>
        </section>
      )}
      <section className="card">
        <div className="chart-head"><h2>歷次結果</h2><div className="seg"><button className={!attentionOnly ? 'active' : ''} onClick={() => setAttentionOnly(false)}>全部</button><button className={attentionOnly ? 'active' : ''} onClick={() => setAttentionOnly(true)}>只看需注意</button></div></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>檢驗日期</th>
                <th>結果</th>
                <th>正常範圍</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...shown].reverse().map((r) => {
                const range = rangeOf(r, item);
                return (
                  <tr key={r.id} onClick={() => nav.lab({ mode: 'detail', id: r.reportId })} title="看這份報告">
                    <td className="nowrap">{showDate(dateOf(r))}</td>
                    <td className="num">{showResult(r, item)}</td>
                    <td className="num muted small">{item?.type === '文字' ? '' : rangeText(range.low, range.high)}</td>
                    <td className="num">
                      <Badge judge={judgeLab(r, item)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// ───────────── 項目清單 ─────────────

function ItemsCard({ api, snap }: { api: HealthApi; snap: HealthSnapshot }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <section className="card">
      <h2>檢驗項目清單</h2>
      <p className="muted small">預設範圍是成人的一般參考值，報告上有印範圍時會優先用報告的。可以自己新增、修改。</p>
      <ul className="order-list">
        {snap.labItems.map((i) =>
          editing === i.id ? (
            <LabItemEditor key={i.id} api={api} snap={snap} item={i} onDone={() => setEditing(null)} />
          ) : (
            <li key={i.id}>
              <span className="grow">
                {i.name} {i.unit && <span className="muted small">（{i.unit}）</span>}
                <div className="tl-extra">
                  {i.type === '文字'
                    ? `選項：${i.options.join('、')}${i.badOptions.length ? `；異常：${i.badOptions.join('、')}` : ''}`
                    : rangeText(i.refLow, i.refHigh) || '沒有預設範圍'}
                  {(i.redLow != null || i.redHigh != null) && `；明顯異常：${[i.redLow != null && `< ${i.redLow}`, i.redHigh != null && `≥ ${i.redHigh}`].filter(Boolean).join('、')}`}
                </div>
              </span>
              <button className="link" onClick={() => setEditing(i.id)}>
                修改
              </button>
            </li>
          ),
        )}
        {editing === 'new' && <LabItemEditor api={api} snap={snap} item={null} onDone={() => setEditing(null)} />}
      </ul>
      {editing !== 'new' && <button onClick={() => setEditing('new')}>＋ 新增項目</button>}
    </section>
  );
}

function LabItemEditor({ api, snap, item, onDone }: { api: HealthApi; snap: HealthSnapshot; item: LabItem | null; onDone: () => void }) {
  const [v, setV] = useState({
    name: item?.name ?? '',
    unit: item?.unit ?? '',
    type: item?.type ?? ('數字' as const),
    refLow: str(item?.refLow ?? null),
    refHigh: str(item?.refHigh ?? null),
    redLow: str(item?.redLow ?? null),
    redHigh: str(item?.redHigh ?? null),
    options: item?.options.join(',') ?? '',
    warnOptions: item?.warnOptions.join(',') ?? '',
    badOptions: item?.badOptions.join(',') ?? '',
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const split = (t: string) =>
    t
      .split(/[,，、]/)
      .map((x) => x.trim())
      .filter(Boolean);
  const save = async () => {
    const nums = [v.refLow, v.refHigh, v.redLow, v.redHigh].map(parseNum);
    if (nums.some((n) => Number.isNaN(n))) return api.showToast({ kind: 'error', text: '範圍要填數字' });
    const input: LabItemInput = {
      name: v.name,
      unit: v.unit,
      type: v.type,
      refLow: nums[0],
      refHigh: nums[1],
      redLow: nums[2],
      redHigh: nums[3],
      options: v.type === '文字' ? split(v.options) : [],
      warnOptions: v.type === '文字' ? split(v.warnOptions) : [],
      badOptions: v.type === '文字' ? split(v.badOptions) : [],
    };
    const ok = await api.run((s) => (item ? s.updateLabItem(item, input, snap.labItems) : s.addLabItem(input, snap.labItems)).then(() => true));
    if (ok) onDone();
  };
  const remove = async () => {
    if (!item || !confirm(`確定要刪除「${item.name}」嗎？`)) return;
    const ok = await api.run((s) => s.deleteLabItem(item, snap.labResults).then(() => true));
    if (ok) onDone();
  };
  return (
    <li className="editor">
      <div className="form-grid">
        <label className="field">
          名稱
          <input value={v.name} onChange={set('name')} autoFocus={!item} />
        </label>
        <label className="field">
          單位
          <input value={v.unit} onChange={set('unit')} />
        </label>
      </div>
      <div className="field">
        結果是
        <Choice options={['數字', '文字'] as const} value={v.type} onChange={(t) => setV((s) => ({ ...s, type: t }))} />
      </div>
      {v.type === '數字' ? (
        <div className="form-grid">
          <label className="field">
            正常範圍下限
            <input type="number" step="any" value={v.refLow} onChange={set('refLow')} />
          </label>
          <label className="field">
            正常範圍上限
            <input type="number" step="any" value={v.refHigh} onChange={set('refHigh')} />
          </label>
          <label className="field">
            低於這個算明顯異常（紅）
            <input type="number" step="any" value={v.redLow} onChange={set('redLow')} />
          </label>
          <label className="field">
            高於或等於這個算明顯異常（紅）
            <input type="number" step="any" value={v.redHigh} onChange={set('redHigh')} />
          </label>
        </div>
      ) : (
        <>
          <label className="field">
            選項（用逗號分開）
            <input value={v.options} onChange={set('options')} placeholder="例：陰性,陽性" />
          </label>
          <label className="field">
            算「注意」的選項（黃）
            <input value={v.warnOptions} onChange={set('warnOptions')} placeholder="例：±" />
          </label>
          <label className="field">
            算「異常」的選項（紅）
            <input value={v.badOptions} onChange={set('badOptions')} placeholder="例：陽性" />
          </label>
        </>
      )}
      {item && <p className="muted small">改名稱的話，已記的結果也會一起改。</p>}
      <div className="editor-actions">
        <button className="primary" onClick={save} disabled={api.busy || !v.name.trim()}>
          儲存
        </button>
        <button onClick={onDone}>取消</button>
        {item && !item.code && (
          <button className="danger" onClick={remove}>
            刪除
          </button>
        )}
      </div>
    </li>
  );
}
