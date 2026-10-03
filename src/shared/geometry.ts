/** renderer/main 共用的幾何小函數（純函數，無 Electron 依賴）。 */
export function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
