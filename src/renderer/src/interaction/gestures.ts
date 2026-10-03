/**
 * 手勢判定（純邏輯，與 DOM 解耦）。
 * - 按下後移動 >5px → drag（dragstart 一次 + dragmove 增量 + dragend）
 * - <300ms 且未移動放開 → click
 * - 按住 ≥600ms 且未移動 → longpress（單次；放開後結束）
 * 時間由呼叫方傳入（測試用假時鐘；真機傳 performance.now()）。
 */
export const DRAG_PX = 5;
export const CLICK_MS = 300;
export const LONGPRESS_MS = 600;

export type GestureEvent =
  | { type: 'click'; x: number; y: number }
  | { type: 'dragstart'; x: number; y: number }
  | { type: 'dragmove'; x: number; y: number; dx: number; dy: number }
  | { type: 'dragend'; x: number; y: number }
  | { type: 'longpress'; x: number; y: number };

export class GestureEngine {
  private downAt = 0;
  private downPos: { x: number; y: number } | null = null;
  private lastPos: { x: number; y: number } | null = null;
  private dragging = false;
  private longFired = false;

  constructor(private emit: (g: GestureEvent) => void) {}

  down(x: number, y: number, now: number): void {
    this.downAt = now;
    this.downPos = { x, y };
    this.lastPos = { x, y };
    this.dragging = false;
    this.longFired = false;
  }

  move(x: number, y: number, now: number): void {
    if (this.downPos === null || this.lastPos === null) return;
    const moved = Math.hypot(x - this.downPos.x, y - this.downPos.y);
    if (!this.dragging && moved > DRAG_PX) {
      this.dragging = true;
      this.emit({ type: 'dragstart', x, y });
    }
    if (this.dragging) {
      this.emit({ type: 'dragmove', x, y, dx: x - this.lastPos.x, dy: y - this.lastPos.y });
      this.lastPos = { x, y };
    }
    void now;
  }

  /**
   * tick 由呼叫方每幀/定時呼叫，驅動 longpress（按住不動 ≥600ms）。
   * 拖曳開始後不再觸發 longpress。
   */
  tick(now: number): void {
    if (this.downPos === null || this.dragging || this.longFired) return;
    if (now - this.downAt >= LONGPRESS_MS) {
      this.longFired = true;
      this.emit({ type: 'longpress', x: this.downPos.x, y: this.downPos.y });
    }
  }

  up(x: number, y: number, now: number): void {
    if (this.downPos === null) return;
    if (this.dragging) {
      this.emit({ type: 'dragend', x, y });
    } else if (!this.longFired && now - this.downAt < CLICK_MS) {
      this.emit({ type: 'click', x, y });
    }
    // longpress 後放開：不補 click（菜单已開）
    this.downPos = null;
    this.lastPos = null;
    this.dragging = false;
    this.longFired = false;
  }

  cancel(): void {
    this.downPos = null;
    this.lastPos = null;
    this.dragging = false;
    this.longFired = false;
  }
}
