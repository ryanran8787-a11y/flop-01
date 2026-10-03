import { net, protocol } from 'electron';
import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ASSET_SCHEME, assetRoot } from './asset-paths.js';

/**
 * 本機唯讀檔案協議：asset://models/<name>、asset://tts/<name>。
 * - 只服務 userData 下 models/、tts/ 兩目錄（含正規化越界檢查）
 * - 音檔走 fetch→blob→objectURL（見 renderer），模型走 GLTFLoader fetch
 * - 需驗證：<audio> 直連 asset:// 的 range 行為，故 renderer 一律轉 blob
 */
export function registerAssetPrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
    },
  ]);
}

export function startAssetProtocol(userData: string): void {
  const root = assetRoot(userData);
  const prefix = normalize(root + sep);
  protocol.handle(ASSET_SCHEME, async (req) => {
    try {
      const url = new URL(req.url);
      const rel = decodeURIComponent(url.hostname + url.pathname).replace(/^\/+/, '');
      const m = /^(models|tts)\/(.+)$/.exec(rel);
      const sub = m?.[1];
      const file = m?.[2];
      if (sub === undefined || file === undefined) return new Response('forbidden', { status: 403 });
      const fsPath = normalize(join(root, sub, file));
      if (!fsPath.startsWith(prefix)) return new Response('forbidden', { status: 403 });
      return await net.fetch(pathToFileURL(fsPath).toString());
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}
