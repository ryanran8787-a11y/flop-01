/**
 * main 端 config 最小接線（完整設定 UI 在階段 8）。
 * renderer 開機需要 vrmPath/fpsCap，先提供 get/set + 變更廣播。
 */
import { ipcMain, type BrowserWindow } from 'electron';
import { getConfigPath, loadConfigFromFile, patchConfigFile, type ConfigPatch } from './config-store.js';
import { app } from 'electron';

export function currentConfigPath(): string {
  return getConfigPath(app.getPath('userData'));
}

export function registerConfigIpc(win: () => BrowserWindow | null): void {
  ipcMain.handle('config:get', () => loadConfigFromFile(currentConfigPath()));
  ipcMain.handle('config:set', (_e, patch: unknown) => {
    const next = patchConfigFile(currentConfigPath(), ((patch ?? {}) as ConfigPatch));
    const w = win();
    if (w !== null && !w.isDestroyed()) {
      w.webContents.send('config:onChanged', { keys: Object.keys((patch as object) ?? {}) });
    }
    return next;
  });
}
