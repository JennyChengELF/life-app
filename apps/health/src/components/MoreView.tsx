import type { HealthSnapshot } from '@life/db';
import type { Nav } from '../App';

/** 更多：體溫、偶爾量測、設定 */
export function MoreView({ snap, nav }: { snap: HealthSnapshot; nav: Nav }) {
  const lastTemp = snap.temps[snap.temps.length - 1];
  return (
    <div className="more-list">
      <button onClick={() => nav.go('temp')}>
        <span>🌡️ 體溫</span>
        <span className="muted small">{lastTemp ? `最近 ${lastTemp.celsius} °C ›` : '›'}</span>
      </button>
      <button onClick={() => nav.go('occ')}>
        <span>📏 偶爾量測（身高、圍度）</span>
        <span className="muted small">›</span>
      </button>
      <button onClick={() => nav.go('settings')}>
        <span>⚙️ 設定</span>
        <span className="muted small">›</span>
      </button>
      {snap.issues.length > 0 && (
        <button onClick={() => nav.go('issues')}>
          <span>⚠️ 需要補齊的資料</span>
          <span className="muted small">{snap.issues.length} 筆 ›</span>
        </button>
      )}
    </div>
  );
}
