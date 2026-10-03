import type { MenuItemConstructorOptions } from 'electron';

/**
 * 系統匣選單模板（純函數，方便測試；實際 Tray 接線在 tray.ts）。
 * 項目：顯示/隱藏、設定、靜音開關、請角色離開、結束。
 */
export interface TrayCallbacks {
  onToggleShow: () => void;
  onOpenSettings: () => void;
  onToggleMute: () => void;
  onLeave: () => void;
  onQuit: () => void;
}

export function buildTrayMenu(cb: TrayCallbacks, state: { visible: boolean; muted: boolean }): MenuItemConstructorOptions[] {
  return [
    { label: state.visible ? '隱藏角色' : '顯示角色', click: cb.onToggleShow },
    { type: 'separator' },
    { label: '設定…', click: cb.onOpenSettings },
    { label: state.muted ? '取消靜音' : '靜音', click: cb.onToggleMute },
    { label: '請角色離開', click: cb.onLeave },
    { type: 'separator' },
    { label: '結束', click: cb.onQuit },
  ];
}
