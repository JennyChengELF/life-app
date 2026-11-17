import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 綜合首頁。上線到 GitHub Pages 時由部署流程設定 VITE_BASE（例：/life-app/）
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { port: 5172, strictPort: true },
});
