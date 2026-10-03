/**
 * 視窗位置純函數（不依賴 Electron，可單元測試）。
 * Electron 的 screen / BrowserWindow 座標在 Windows 上皆為 DIP，
 * cursor 點與 workArea 同單位，直接運算不需縮放（需驗證多螢幕異 DPI）。
 */

export interface XY {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Area extends XY, Size {}

/**
 * 把視窗左上角夾在工作區內。
 * 若視窗比工作區大，則貼齊工作區左上（避免算出 min>max 反轉）。
 */
export function clampWindowPos(px: number, py: number, win: Size, area: Area, margin = 0): XY {
  const maxX = area.x + area.width - win.width - margin;
  const maxY = area.y + area.height - win.height - margin;
  const minX = area.x + margin;
  const minY = area.y + margin;
  const x = maxX < minX ? area.x : Math.min(Math.max(px, minX), maxX);
  const y = maxY < minY ? area.y : Math.min(Math.max(py, minY), maxY);
  return { x: Math.round(x), y: Math.round(y) };
}

/** 拖曳：現位置 + 增量，再夾取。 */
export function applyDrag(pos: XY, win: Size, dx: number, dy: number, area: Area, margin = 0): XY {
  return clampWindowPos(pos.x + dx, pos.y + dy, win, area, margin);
}

import { dist as _dist } from '../shared/geometry.js';

/** 歐氏距離（手勢判定 >5px 用，階段 4 會引用）。main 內轉出口，renderer 請用 shared/geometry。 */
export const dist = _dist;
