import type { MouthViseme } from '../../../shared/types.js';
import type { ExpressionController } from './expression-controller.js';

/**
 * 口型層 shell（階段 3）：只提供手動 setMouth/reset。
 * AnalyserNode 頻段映射在階段 6 接上 attachSource()。
 * 保證：只經 ExpressionController.setMouth 寫嘴部 preset，不碰其他層。
 */
export class LipSyncController {
  private active = false;

  constructor(private expr: ExpressionController) {}

  setMouth(viseme: MouthViseme, weight: number): void {
    this.expr.setMouth(viseme, weight);
    this.active = viseme !== 'closed';
  }

  /** 播放結束：嘴巴回閉合。 */
  reset(): void {
    this.expr.setMouth('closed', 0);
    this.active = false;
  }

  get speaking(): boolean {
    return this.active;
  }

  // TODO(階段6): attachSource(analyser: AnalyserNode): void
}
