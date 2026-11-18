import { useState } from 'react';
import type { BowelSnapshot } from '@life/db';
import type { BowelApi } from '../useBowel';

export function SettingsView({ api, snap }: { api: BowelApi; snap: BowelSnapshot }) {
  const [days, setDays] = useState(String(snap.settings.constipationDays));
  const [gain, setGain] = useState(String(snap.settings.weightGainKg));
  const changed = days !== String(snap.settings.constipationDays) || gain !== String(snap.settings.weightGainKg);
  const url = api.fileUrl();

  return (
    <div className="settings">
      <section className="card">
        <h2>提醒</h2>
        <label className="field">
          幾天沒排便算便秘（1–14 天）
          <input type="number" inputMode="numeric" min={1} max={14} value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
        <label className="field">
          體重比前一次多幾 kg 時，首頁說明「體重增加屬正常現象」
          <input type="number" inputMode="decimal" step={0.1} min={0.1} max={5} value={gain} onChange={(e) => setGain(e.target.value)} />
        </label>
        <div className="editor-actions">
          <button
            className="primary"
            disabled={!changed || api.busy}
            onClick={async () => {
              const ok = await api.run((s) => s.saveSettings({ constipationDays: Number(days), weightGainKg: Number(gain) }).then(() => true));
              if (ok) api.showToast({ kind: 'info', text: '已儲存' });
            }}
          >
            儲存
          </button>
        </div>
      </section>

      <section className="card">
        <h2>資料</h2>
        {api.mode === 'local' ? (
          <p className="muted">本機測試模式：資料只存在這個瀏覽器。設定好 Google 後會改存到你的 Google 試算表。</p>
        ) : (
          <>
            <p className="muted small">
              資料存在你的 Google 試算表「生活APP-排便」。可以直接在 bowelLogs 最下方新增一列，只要填 time，其他選填（選項照第一列下方的說明填中文）。APP 打開或重新整理時會自動補齊。
            </p>
            <p className="muted small">⚠️ 排便資料比較私密，建議確認試算表的共用設定是「限制」（只有你能看）。</p>
            {url && (
              <a className="btn" href={url} target="_blank" rel="noreferrer">
                開啟排便試算表 ↗
              </a>
            )}
            <div>
              <button className="link danger-text" onClick={api.signOut}>
                中斷 Google 連線
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
