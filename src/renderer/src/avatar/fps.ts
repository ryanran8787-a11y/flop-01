import type { FpsMode } from '../../../shared/types.js';

/**
 * FPS 調節（純邏輯）。renderer 迴圈據此跳幀：
 * active = min(fpsCap, 60)；idle = 30；occluded ≤ 10 或暫停。
 */
export function targetFps(mode: FpsMode, fpsCap: number, occludedPaused: boolean): number {
  if (mode === 'occluded') return occludedPaused ? 0 : 10;
  if (mode === 'idle') return Math.min(30, fpsCap);
  return Math.min(60, fpsCap);
}

/** 依目標 fps 判斷這一幀是否該渲染（呼叫方每 rAF 傳 now ms）。 */
export class FrameGate {
  private last = -Infinity;

  shouldRender(nowMs: number, fps: number): boolean {
    if (fps <= 0) return false;
    if (nowMs - this.last >= 1000 / fps) {
      this.last = nowMs;
      return true;
    }
    return false;
  }

  reset(): void {
    this.last = -Infinity;
  }
}
