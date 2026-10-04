import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * preload 實際檔名 electron-vite 產出為 index.mjs（package type: module），
 * 不是 index.js。寫死會靜默載入失敗 → window.api 缺失。
 * 純函數（fromDir 傳 main 輸出目錄，即 __dirname）。
 */
export function resolvePreloadPath(fromDir: string): string {
  for (const f of ['index.mjs', 'index.js']) {
    const p = join(fromDir, '../preload', f);
    if (existsSync(p)) return p;
  }
  return join(fromDir, '../preload/index.mjs');
}
