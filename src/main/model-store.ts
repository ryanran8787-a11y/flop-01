import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { assetRoot } from './asset-paths.js';

/**
 * 模型檔匯入（純檔案操作，無 Electron 依賴）。
 * 使用者挑的 .vrm/.glb 複製進 userData/asset/models（檔名衝突加後綴）。
 */
export function modelsDir(userData: string): string {
  const d = join(assetRoot(userData), 'models');
  mkdirSync(d, { recursive: true });
  return d;
}

export function importVrmFile(srcPath: string, userData: string): { fileName: string; url: string } {
  const dir = modelsDir(userData);
  const raw = basename(srcPath).replace(/[^\w.\-()\[\] ]/g, '_') || 'model.vrm';
  let name = raw;
  let i = 1;
  while (existsSync(join(dir, name))) {
    i += 1;
    name = raw.replace(/(\.[^.]+)?$/, `-${i}$1`);
  }
  copyFileSync(srcPath, join(dir, name));
  return { fileName: name, url: `asset://models/${encodeURI(name)}` };
}
