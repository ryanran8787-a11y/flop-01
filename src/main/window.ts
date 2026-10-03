import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { AppConfig } from '../shared/config-schema.js';
import { clampWindowPos } from './window-bounds.js';

/**
 * 主 overlay 視窗：透明、無邊框、置頂、預設穿透。
 * 注意：不用 `-webkit-app-region: drag`，拖曳由 renderer 指標事件 + win:dragMove IPC 手動搬移。
 */
export function createMainWindow(cfg: AppConfig, opts: { preloadPath: string }): BrowserWindow {
  const primary = screen.getPrimaryDisplay();
  const W = 420;
  const H = 560;
  const pos = clampWindowPos(
    primary.workArea.x + primary.workArea.width - W - 24,
    primary.workArea.y + primary.workArea.height - H - 48,
    { width: W, height: H },
    primary.workArea,
  );

  const win = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: W,
    height: H,
    transparent: true,
    frame: false,
    alwaysOnTop: cfg.window.alwaysOnTop,
    skipTaskbar: cfg.window.skipTaskbar,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: opts.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(cfg.window.alwaysOnTop, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // 預設穿透，只在角色命中時接收事件
  win.setIgnoreMouseEvents(true, { forward: true });

  win.once('ready-to-show', () => win.show());

  if (process.env['ELECTRON_RENDERER_URL'] !== undefined) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return win;
}

/**
 * 設定視窗：不透明一般視窗（與 overlay 分開），載入同 renderer 包 ?settings=1。
 */
export function createSettingsWindow(preloadPath: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 720,
    title: '設定 — 桌面 AI 伴侶',
    autoHideMenuBar: true,
    backgroundColor: '#14161f',
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl !== undefined) {
    void win.loadURL(`${devUrl}?settings=1`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query: { settings: '1' } });
  }
  return win;
}
