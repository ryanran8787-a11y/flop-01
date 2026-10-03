import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

// 需驗證：electron-vite 5 多頁 input 寫法（標準 Vite MPA rollupOptions.input）。
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'src/renderer/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html'),
        },
      },
    },
  },
});
