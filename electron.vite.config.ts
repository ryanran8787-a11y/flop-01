import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

// 需驗證：electron-vite 5 多頁 input 寫法（標準 Vite MPA rollupOptions.input）。
export default defineConfig({
  main: {},
  // 重要：preload 在沙盒中只能跑 CJS；package.json 是 type:module，
  // 不強制的話會產出 ESM(.mjs)，Electron 載入報
  // "Cannot use import statement outside a module"，window.api 全滅。
  preload: {
    build: {
      rollupOptions: {
        output: { format: 'cjs' },
      },
    },
  },
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
