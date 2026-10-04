import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * preload 實際檔名依打包格式而定（CJS 強制後為 index.cjs）。
 * 優先順序：cjs（沙盒可載）> mjs > js；都沒有回 cjs 預設。
 */
export function resolvePreloadPath(fromDir: string): string {
  for (const f of ['index.cjs', 'index.mjs', 'index.js']) {
    const p = join(fromDir, '../preload', f);
    if (existsSync(p)) return p;
  }
  return join(fromDir, '../preload/index.cjs');
}
