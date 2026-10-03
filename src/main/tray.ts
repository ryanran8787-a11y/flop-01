import { Menu, Tray, app, type BrowserWindow, type NativeImage } from 'electron';
import { buildTrayMenu, type TrayCallbacks } from './tray-menu.js';

/**
 * 系統匣接線。圖示由呼叫方提供（需驗證：Windows 建議 .ico / 16px；這裡不內建二進位圖）。
 */
export function createTray(icon: NativeImage, win: BrowserWindow, extra: TrayCallbacks): Tray {
  const tray = new Tray(icon);
  const state = { visible: true, muted: false };
  const refresh = (): void => {
    tray.setContextMenu(
      Menu.buildFromTemplate(
        buildTrayMenu(
          {
            onToggleShow: () => {
              if (win.isDestroyed()) return;
              state.visible = !win.isVisible();
              if (state.visible) win.hide();
              else win.show();
              refresh();
              extra.onToggleShow();
            },
            onOpenSettings: extra.onOpenSettings,
            onToggleMute: () => {
              state.muted = !state.muted;
              refresh();
              extra.onToggleMute();
            },
            onLeave: extra.onLeave,
            onQuit: () => {
              extra.onQuit();
              app.quit();
            },
          },
          state,
        ),
      ),
    );
  };
  tray.setToolTip('桌面 AI 伴侶');
  refresh();
  tray.on('click', () => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  });
  return tray;
}
