import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { applyDrag } from './window-bounds.js';
import { HitTestState } from './hit-test.js';
import type { AppConfig } from '../shared/config-schema.js';

/**
 * main 端 IPC 接線（白名單內與視窗相關的通道）。
 * - win:dragMove：renderer 手動拖曳增量 → 移動 + 夾取到工作區
 * - win:hitTest：renderer raycast/alpha 命中 → 切換穿透
 * 其餘通道（stt/tts/llm/memory/config）在各自階段接線。
 */
export function registerWindowIpc(mainWin: BrowserWindow, hit: HitTestState, _cfg: AppConfig): void {
  ipcMain.on('win:dragMove', (_e, payload: unknown) => {
    const p = payload as { dx?: number; dy?: number };
    const dx = Number(p?.dx) || 0;
    const dy = Number(p?.dy) || 0;
    if (dx === 0 && dy === 0) return;
    if (mainWin.isDestroyed()) return;
    const pos = mainWin.getPosition();
    const size = mainWin.getSize();
    const px = pos[0] ?? 0;
    const py = pos[1] ?? 0;
    const w = size[0] ?? 420;
    const h = size[1] ?? 560;
    // 需驗證：異 DPI 多螢幕下 getDisplayNearestPoint 回傳 workArea 單位
    const area = screen.getDisplayNearestPoint({ x: px, y: py }).workArea;
    const next = applyDrag({ x: px, y: py }, { width: w, height: h }, dx, dy, area);
    mainWin.setPosition(next.x, next.y);
  });

  ipcMain.on('win:hitTest', (_e, payload: unknown) => {
    const p = payload as { hit?: boolean };
    if (mainWin.isDestroyed()) return;
    if (hit.setHit(p?.hit === true)) {
      // 需驗證：Windows 上 forward:true 讓穿透時 mousemove 仍進 renderer
      mainWin.setIgnoreMouseEvents(hit.ignoringMouse, { forward: true });
    }
  });
}

/** win:showSettings → 開設定視窗（renderer 選單/設定鈕用）。 */
export function registerSettingsOpener(show: () => void): void {
  ipcMain.on('win:showSettings', () => show());
}

/** 顯示/隱藏切換（含 Dock/工作列行為：hide 時整窗隱藏）。 */
export function toggleShow(mainWin: BrowserWindow): boolean {
  if (mainWin.isDestroyed()) return false;
  if (mainWin.isVisible()) {
    mainWin.hide();
    return false;
  }
  mainWin.show();
  return true;
}

export function setAutoStart(openAtLogin: boolean): void {
  // 需驗證：electron-builder nsis 與便攜版下的 setLoginItemSettings 實際行為
  app.setLoginItemSettings({ openAtLogin, path: process.execPath });
}
