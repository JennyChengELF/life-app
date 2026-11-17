import { defineConfig } from 'vite';

// 綜合 APP（目前只有首頁）。上線到 GitHub Pages 時由部署流程設定 VITE_BASE（例：/life-app/）
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  server: { port: 5172, strictPort: true },
});
