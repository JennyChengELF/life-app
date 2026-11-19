import { useState } from 'react';
import { Icon } from '@life/ui/icon';
import type { Cup, WaterSnapshot } from '@life/db';
import { computeGoal, FACTOR_MAX, FACTOR_MIN, goalWeight, latestWeight, toDateKey, todayKey, toHHmm } from '@life/db';
import type { WaterApi } from '../useWater';
import { drinkColor } from '../drinkColors';

export function SettingsView({ api, snap }: { api: WaterApi; snap: WaterSnapshot }) {
  return (
    <div className="settings">
      <WeightCard api={api} snap={snap} />
      <GoalCard api={api} snap={snap} />
      <DrinksCard api={api} snap={snap} />
      <CupsCard api={api} snap={snap} />
      <DataCard api={api} />
      <p className="muted small center-text">喝水目標僅供參考，不能取代醫療建議；有醫囑限水請依醫師指示。</p>
    </div>
  );
}

function WeightCard({ api, snap }: { api: WaterApi; snap: WaterSnapshot }) {
  const latest = latestWeight(snap.weights);
  const [kg, setKg] = useState('');
  const save = async () => {
    const v = Number(kg);
    if (!Number.isFinite(v) || v < 2 || v > 400) return api.showToast({ kind: 'error', text: '請輸入正確的體重' });
    setKg('');
    await api.run((s) => s.addWeight(Math.round(v * 10) / 10));
    api.showToast({ kind: 'info', text: `已記錄體重 ${v} kg（明天開始用來算目標）` });
  };
  return (
    <section className="card">
      <h2>體重</h2>
      <p>
        {latest ? (
          <>
            最新：<b>{latest.kg} kg</b>
            <span className="muted small">
              （{toDateKey(latest.time)} {toHHmm(latest.time)}）
            </span>
          </>
        ) : (
          <span className="muted">還沒有體重紀錄，目前用預設目標 2000ml</span>
        )}
      </p>
      <div className="row">
        <input type="number" inputMode="decimal" step="0.1" placeholder="今天的體重 kg" value={kg} onChange={(e) => setKg(e.target.value)} />
        <button className="primary" onClick={save} disabled={!kg}>
          記錄
        </button>
      </div>
      <p className="muted small">每天的目標用「昨天以前最新的體重」計算，今天量的明天才會用。體重存在「生活APP-健康」試算表，健康 APP 也看得到。</p>
    </section>
  );
}

function GoalCard({ api, snap }: { api: WaterApi; snap: WaterSnapshot }) {
  const s = snap.settings;
  const [factor, setFactor] = useState(String(s.factor));
  const [extra, setExtra] = useState(String(s.extraMl));
  const [round, setRound] = useState(s.roundTo100);
  const gw = goalWeight(snap.weights, todayKey());
  const w = gw?.kg ?? null;
  const f = Number(factor);
  const e = Number(extra);
  const valid = Number.isFinite(f) && f >= FACTOR_MIN && f <= FACTOR_MAX && Number.isFinite(e) && e >= 0 && e <= 3000;
  const preview = valid ? computeGoal(w, { factor: f, extraMl: e, roundTo100: round }) : null;
  const dirty = f !== s.factor || e !== s.extraMl || round !== s.roundTo100;

  const save = async () => {
    await api.run((st) => st.saveSettings({ factor: f, extraMl: e, roundTo100: round }));
    api.showToast({ kind: 'info', text: '已更新目標設定（今天的目標會跟著更新）' });
  };

  return (
    <section className="card">
      <h2>每日目標</h2>
      <p className="muted small">目標 = 體重 × 係數 ＋ 額外加量</p>
      <label className="field">
        係數（ml/kg，{FACTOR_MIN}–{FACTOR_MAX}）
        <input type="number" value={factor} min={FACTOR_MIN} max={FACTOR_MAX} onChange={(ev) => setFactor(ev.target.value)} />
      </label>
      <label className="field">
        額外加量（ml）
        <input type="number" value={extra} min={0} step={50} onChange={(ev) => setExtra(ev.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={round} onChange={(ev) => setRound(ev.target.checked)} />
        四捨五入到百位
      </label>
      <p>
        {preview ? (
          w != null ? (
            <>
              目標：<b>{preview.goal.toLocaleString()} ml</b>
              <span className="muted small">
                （{w} × {f}
                {e ? ` + ${e}` : ''} = {Math.round(w * f + e)}
                {round ? '，四捨五入' : ''}）
              </span>
              <br />
              <span className="muted small">體重用 {toDateKey(gw!.time)} 量的 {w} kg（今天以前最新的一筆）</span>
            </>
          ) : (
            <span className="muted">今天以前還沒有體重，目標用預設 2000ml</span>
          )
        ) : (
          <span className="error-text">請輸入正確的數值</span>
        )}
      </p>
      <button className="primary" onClick={save} disabled={!valid || !dirty}>
        儲存設定
      </button>
    </section>
  );
}

function DrinksCard({ api, snap }: { api: WaterApi; snap: WaterSnapshot }) {
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    setName('');
    await api.run((s) => s.addDrink(n, snap.drinks));
  };

  return (
    <section className="card">
      <h2>飲品清單</h2>
      <p className="muted small">記錄時可以選喝什麼；第一個是預設（記完會自動回到它）。目前所有飲品都算進喝水量。</p>
      <ul className="cup-list">
        {snap.drinks.map((d, i) =>
          editing === d.id ? (
            <li key={d.id} className="editor">
              <div className="row">
                <input value={draft} onChange={(e) => setDraft(e.target.value)} />
              </div>
              <div className="editor-actions">
                <button
                  className="primary"
                  disabled={!draft.trim()}
                  onClick={() => {
                    setEditing(null);
                    api.run((s) => s.renameDrink(d, draft, snap.drinks));
                  }}
                >
                  儲存
                </button>
                <button onClick={() => setEditing(null)}>取消</button>
                <button
                  className="danger"
                  disabled={snap.drinks.length <= 1}
                  onClick={() => {
                    setEditing(null);
                    api.run((s) => s.deleteDrink(d, snap.drinks));
                  }}
                >
                  刪除
                </button>
              </div>
              <p className="muted small">改名時，用舊名稱的紀錄會一起改；刪除後舊紀錄保留原本的名稱。</p>
            </li>
          ) : (
            <li key={d.id} className="log-row">
              <span className="drink-tag log-ml">
                <i className="dot" style={{ background: drinkColor(d.name, snap.drinks) }} />
                {d.name}
                {i === 0 && <span className="badge">預設</span>}
              </span>
              <button
                className="link"
                onClick={() => {
                  setDraft(d.name);
                  setEditing(d.id);
                }}
              >
                修改
              </button>
            </li>
          ),
        )}
      </ul>
      <div className="row">
        <input placeholder="新增飲品（例：茶）" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="primary" onClick={add} disabled={!name.trim()}>
          新增
        </button>
      </div>
    </section>
  );
}

function CupsCard({ api, snap }: { api: WaterApi; snap: WaterSnapshot }) {
  const [name, setName] = useState('');
  const [ml, setMl] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const add = async () => {
    const v = Number(ml);
    if (!name.trim() || !Number.isFinite(v) || v <= 0) return api.showToast({ kind: 'error', text: '請輸入名稱和容量' });
    setName('');
    setMl('');
    const sort = Math.max(0, ...snap.cups.map((c) => c.sort)) + 1;
    await api.run((s) => s.addCup(name, Math.round(v), sort));
  };

  return (
    <section className="card">
      <h2>常用杯子</h2>
      <p className="muted small">建立後會出現在「今天」，點一下記一杯。</p>
      <ul className="cup-list">
        {snap.cups.map((c) =>
          editing === c.id ? (
            <CupEditor
              key={c.id}
              cup={c}
              onSave={(patch) => {
                setEditing(null);
                api.run((s) => s.updateCup(c, patch));
              }}
              onCancel={() => setEditing(null)}
              onDelete={() => {
                setEditing(null);
                api.run((s) => s.deleteCup(c));
              }}
            />
          ) : (
            <li key={c.id} className="log-row">
              <span className="cup-name">
                <Icon name="cup" size={18} /> {c.name}
              </span>
              <span className="log-ml">{c.ml} ml</span>
              <button className="link" onClick={() => setEditing(c.id)}>
                修改
              </button>
            </li>
          ),
        )}
      </ul>
      <div className="row">
        <input placeholder="名稱（例：保溫瓶）" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="number" inputMode="numeric" placeholder="ml" value={ml} onChange={(e) => setMl(e.target.value)} className="narrow" />
        <button className="primary" onClick={add}>
          新增
        </button>
      </div>
    </section>
  );
}

function CupEditor(props: { cup: Cup; onSave: (p: { name: string; ml: number }) => void; onCancel: () => void; onDelete: () => void }) {
  const [name, setName] = useState(props.cup.name);
  const [ml, setMl] = useState(String(props.cup.ml));
  return (
    <li className="editor">
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <input type="number" value={ml} onChange={(e) => setMl(e.target.value)} className="narrow" />
      </div>
      <div className="editor-actions">
        <button className="primary" onClick={() => props.onSave({ name: name.trim(), ml: Math.round(Number(ml)) })} disabled={!name.trim() || !(Number(ml) > 0)}>
          儲存
        </button>
        <button onClick={props.onCancel}>取消</button>
        <button className="danger" onClick={props.onDelete}>
          刪除
        </button>
      </div>
    </li>
  );
}

function DataCard({ api }: { api: WaterApi }) {
  const water = api.fileUrl('water');
  const health = api.fileUrl('health');
  return (
    <section className="card">
      <h2>資料</h2>
      {api.mode === 'local' ? (
        <p className="muted">本機測試模式：資料只存在這個瀏覽器。設定好 Google 後會改存到你的 Google 試算表。</p>
      ) : (
        <>
          <p className="muted small">資料存在你的 Google 試算表。可以直接在試算表最下方新增喝水紀錄（只要填 time 和 ml），APP 打開或重新整理時會自動補齊。</p>
          <div className="row wrap">
            {water && (
              <a className="btn" href={water} target="_blank" rel="noreferrer">
                開啟喝水試算表 ↗
              </a>
            )}
            {health && (
              <a className="btn" href={health} target="_blank" rel="noreferrer">
                開啟健康試算表 ↗
              </a>
            )}
          </div>
          <button className="link danger-text" onClick={api.signOut}>
            中斷 Google 連線
          </button>
        </>
      )}
    </section>
  );
}
