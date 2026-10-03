/**
 * 游標輪詢器（純邏輯，不 import Electron）。
 * 接線時由 main 傳入 screen.getCursorScreenPoint 與 webContents.send。
 * 只有位置變化才送，省 IPC；renderer 視線平滑（MathUtils.damp）靠連續更新。
 */
export interface CursorDeps {
  getCursorPoint: () => { x: number; y: number };
  /** 視窗左上的 screen 座標（用於換算視窗內相對座標；缺省為 0,0）。 */
  getOrigin?: () => { x: number; y: number };
  send: (pos: { x: number; y: number; at: number }) => void;
}

export function startCursorPoll(deps: CursorDeps, hz = 45): () => void {
  const intervalMs = Math.round(1000 / Math.min(Math.max(hz, 30), 60));
  let lastX = Number.NaN;
  let lastY = Number.NaN;
  const timer = setInterval(() => {
    try {
      const p = deps.getCursorPoint();
      const o = deps.getOrigin?.() ?? { x: 0, y: 0 };
      const lx = p.x - o.x;
      const ly = p.y - o.y;
      if (lx !== lastX || ly !== lastY) {
        lastX = lx;
        lastY = ly;
        deps.send({ x: lx, y: ly, at: Date.now() });
      }
    } catch {
      // 單次取點失敗不中斷輪詢
    }
  }, intervalMs);
  // 需驗證：Electron 44 + Node 24 下 unref 型別仍可用
  const t = timer as unknown as { unref?: () => void };
  t.unref?.();
  return () => clearInterval(timer);
}
