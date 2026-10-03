import { ipcMain, type BrowserWindow } from 'electron';
import type { SideToMain } from '../shared/protocol.js';
import type { SidecarManager } from './sidecar.js';
import { forwardTarget } from './voice-routes.js';

/** sidecar WS 訊息 → renderer IPC；renderer 播放狀態 → sidecar。 */
export function bridgeSidecarToRenderer(
  mgr: SidecarManager,
  win: () => BrowserWindow | null,
  toAssetUrl?: (absPath: string) => string | null,
): void {
  mgr.on('message', (msg: SideToMain) => {
    const fwd = forwardTarget(msg);
    if (fwd === null) return;
    if (fwd.channel === 'tts:file' && toAssetUrl !== undefined) {
      const d = fwd.data as { id: string; path: string };
      const url = toAssetUrl(d.path);
      (fwd as { data: unknown }).data = url !== null ? { ...d, url } : d;
    }
    const w = win();
    if (w !== null && !w.isDestroyed()) w.webContents.send(fwd.channel, fwd.data);
  });
}

/** renderer 播放狀態 → sidecar 回音閘（tts.notify）；設定頁的 whisper 控制。 */
export function registerVoiceIpc(mgr: SidecarManager): void {
  ipcMain.on('tts:notify', (_e, payload: unknown) => {
    const p = payload as { playing?: boolean };
    mgr.ttsNotify(p?.playing === true);
  });
  ipcMain.handle('whisper:reload', (_e, payload: unknown) => {
    const p = payload as { size?: string; device?: string; compute?: string };
    const ok = mgr.whisperReload(p?.size ?? '', p?.device ?? '', p?.compute ?? '');
    return { accepted: ok };
  });
  ipcMain.handle('whisper:cancelDownload', () => ({ accepted: mgr.whisperCancelDownload() }));
}
