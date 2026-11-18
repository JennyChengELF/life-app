/** 布里斯托型態的小圖示（示意） */
import type { BowelType } from '@life/db';

const SHAPES: Record<Exclude<BowelType, '未觀察'>, JSX.Element> = {
  // 1 硬顆粒：分開的小顆粒
  '1': (
    <>
      <circle cx="6" cy="10" r="3.2" />
      <circle cx="14" cy="8" r="3" />
      <circle cx="22" cy="11" r="3.3" />
      <circle cx="29" cy="8.5" r="2.8" />
    </>
  ),
  // 2 凹凸長條：顆粒黏成一條
  '2': (
    <>
      <circle cx="7" cy="10" r="4" />
      <circle cx="13" cy="9" r="4.2" />
      <circle cx="19" cy="10" r="4" />
      <circle cx="25" cy="9" r="4.2" />
      <circle cx="30" cy="10" r="3.6" />
    </>
  ),
  // 3 裂痕長條
  '3': (
    <>
      <rect x="3" y="5.5" width="30" height="9" rx="4.5" />
      <path d="M10 5.5v3M16 14.5v-3M22 5.5v3.5M28 14.5v-3" className="crack" />
    </>
  ),
  // 4 光滑長條
  '4': <path d="M4 12c4-6 10-6 14-3s10 3 14-3" className="snake" />,
  // 5 柔軟塊狀：邊緣清楚的小塊
  '5': (
    <>
      <ellipse cx="8" cy="10" rx="5" ry="3.6" />
      <ellipse cx="19" cy="9" rx="4.6" ry="3.4" />
      <ellipse cx="29" cy="10.5" rx="4" ry="3" />
    </>
  ),
  // 6 泥糊狀：邊緣不規則
  '6': <path d="M3 13c1-4 4-2 5-5s4-2 5 0 3-3 6-1 3 1 5-1 4 1 4 3 3 2 2 4-4 1-6 1-6 1-9 0-5 1-7 0-5 1-5-1z" />,
  // 7 水狀
  '7': <path d="M3 9c3-2 5 2 8 0s5-2 8 0 5 2 8 0 4-1 6 0M5 14c3-2 5 2 8 0s5-2 8 0 5 2 8 0" className="wave" />,
};

export function TypeIcon({ type }: { type: BowelType }) {
  if (type === '未觀察') return null;
  return (
    <svg className="type-icon" viewBox="0 0 36 20" aria-hidden="true">
      {SHAPES[type]}
    </svg>
  );
}

/** 顏色選項旁的色點（未觀察沒有） */
export const COLOR_SWATCH: Record<string, string> = {
  黃色: '#e2bf3f',
  黃褐色: '#c49a4a',
  褐色: '#8b5a2b',
  深褐色: '#553517',
  綠色: '#5b8a37',
  黑色: '#1f1f1f',
  紅色: '#c0392b',
  灰白色: '#d9d4c7',
};
