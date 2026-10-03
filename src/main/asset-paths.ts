import { join, normalize, sep } from 'node:path';

/** asset:// 純路徑邏輯（無 Electron 依賴，可測）。 */
export const ASSET_SCHEME = 'asset';

export function assetRoot(userData: string): string {
  return join(userData, 'asset');
}

/** 絕對路徑 → asset URL（models/tts 下才轉，否則回 null）。 */
export function toAssetUrl(absPath: string, userData: string): string | null {
  const norm = normalize(absPath);
  for (const sub of ['models', 'tts']) {
    const base = normalize(join(assetRoot(userData), sub) + sep);
    if (norm.startsWith(base)) {
      const rel = norm.slice(base.length).replace(/\\/g, '/');
      return `${ASSET_SCHEME}://${sub}/${encodeURI(rel)}`;
    }
  }
  return null;
}
