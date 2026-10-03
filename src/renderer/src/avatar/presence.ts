import type { PresenceState } from '../../../shared/types.js';
import { isPresenceAction, type Action } from '../../../shared/types.js';

/**
 * 在場狀態機（純邏輯）：present → leaving → absent → returning → present。
 * - leave 期間鎖互動（AvatarController 據 canInteract 擋掉 click/drag 菜單外事件）
 * - 非 leave/return 動作不影響狀態
 * - 重複 leave/return 請求為冪等（回傳是否發生轉移）
 */
export class PresenceMachine {
  private state: PresenceState = 'present';

  get current(): PresenceState {
    return this.state;
  }

  get canInteract(): boolean {
    return this.state === 'present';
  }

  /** 由 AI action 或匣選單驅動。 */
  dispatchAction(a: Action): boolean {
    if (!isPresenceAction(a)) return false;
    if (a === 'leave' && this.state === 'present') {
      this.state = 'leaving';
      return true;
    }
    if (a === 'return' && this.state === 'absent') {
      this.state = 'returning';
      return true;
    }
    return false;
  }

  /** 動畫播完由 ProceduralAnim 回調推進。 */
  notifyAnimationDone(kind: 'leave' | 'return'): void {
    if (kind === 'leave' && this.state === 'leaving') this.state = 'absent';
    if (kind === 'return' && this.state === 'returning') this.state = 'present';
  }

  reset(): void {
    this.state = 'present';
  }
}
