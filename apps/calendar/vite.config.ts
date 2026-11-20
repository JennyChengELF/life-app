import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 上線到 GitHub Pages 時由部署流程設定 VITE_BASE（例：/life-app/calendar/）
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: { port: 5177, strictPort: true },
});
