import './styles.css';

/**
 * 上線時各 APP 在同一個網站的子路徑（/life-app/water/），連結用相對路徑就好。
 * 開發時每個 APP 是不同的 port，改成指到各自的開發伺服器。
 */
const DEV_PORTS: Record<string, number> = { water: 5173, health: 5174 };
if (import.meta.env.DEV) {
  document.querySelectorAll<HTMLAnchorElement>('a[data-app]').forEach((a) => {
    a.href = `http://${location.hostname}:${DEV_PORTS[a.dataset.app!]}/${a.dataset.hash ?? ''}`;
  });
}
