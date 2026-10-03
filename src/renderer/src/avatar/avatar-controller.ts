import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { Action, Emotion, MouthViseme } from '../../../shared/types.js';
import { isPresenceAction } from '../../../shared/types.js';
import type { IAvatarRenderer } from '../../../shared/providers.js';
import type { EventBus } from '../../../shared/event-bus.js';
import type { AppEventMap } from '../../../shared/events.js';
import { ExpressionController } from './expression-controller.js';
import { IdleController } from './idle-controller.js';
import { EyeTrackingController } from './eye-tracking-controller.js';
import { LipSyncController } from './lipsync-controller.js';
import { ProceduralAnim } from './procedural-anim.js';
import { PresenceMachine } from './presence.js';
import { gazeTargetFromCursor } from './gaze-math.js';
import { attachHeadCollider, disposeVRM, frameVRM, loadVRMFromUrl } from './vrm-lifecycle.js';

/**
 * AvatarController：狀態機 + 五層動畫編排，實作 shared IAvatarRenderer。
 *
 * 每幀寫入順序（後寫覆蓋先寫）：
 * 1. ProceduralAnim（one-shot / slide，最高優先）
 * 2. Idle（呼吸/擺動；stretch 佔 spine 時抑制）
 * 3. Gaze（頭/頸/眼；動作佔 head/neck 時抑制）
 * 4. Expression.update（情緒 damp；不碰嘴部 preset）
 * 5. vrm.update(dt)（humanoid normalized→raw 同步 + springbone + 表情套用）
 * 口型由 LipSyncController 直寫（呼叫方逐幀），獨立於上列。
 */
export class AvatarController implements IAvatarRenderer {
  readonly kind = 'vrm' as const;

  private vrm: VRM | null = null;
  private currentUrl: string | null = null;
  private thinking = false;

  private expr = new ExpressionController();
  private idle: IdleController;
  private gaze: EyeTrackingController;
  private lips: LipSyncController;
  private anim: ProceduralAnim;
  private presence = new PresenceMachine();

  /** 滑出距離（世界單位），由 stage 依相機設定。 */
  slideDistance = 2.5;

  constructor(
    private scene: THREE.Scene,
    private bus?: EventBus<AppEventMap>,
  ) {
    const getNode = (name: string): THREE.Object3D | null =>
      this.vrm?.humanoid.getNormalizedBoneNode(name as never) ?? null;
    this.idle = new IdleController(getNode);
    this.gaze = new EyeTrackingController(getNode);
    this.anim = new ProceduralAnim(getNode, () => this.vrm?.scene ?? null);
    this.lips = new LipSyncController(this.expr);
    this.idle.onBlink((v) => this.expr.setBlink(v));
  }

  // ---- IAvatarRenderer ----

  async loadModel(pathOrUrl: string): Promise<void> {
    const next = await loadVRMFromUrl(pathOrUrl).catch((err) => {
      // 載入失敗保留原角色：這裡不動 this.vrm，只向上拋（UI 層提示，階段 8）
      throw new Error(`VRM 載入失敗，已保留原角色：${(err as Error).message}`);
    });
    if (this.vrm !== null) disposeVRM(this.vrm, this.scene);
    this.vrm = next;
    this.currentUrl = pathOrUrl;
    this.scene.add(next.scene);
    frameVRM(next);
    this.expr.bind(next.expressionManager ?? null);
    this.expr.setEmotion('idle');
    this.idle.rebind();
    this.gaze.rebind();
    this.anim.cancel();
    this.presence.reset();
    const head = next.humanoid.getNormalizedBoneNode('head');
    if (head !== null) attachHeadCollider(head);
  }

  setEmotion(e: Emotion): void {
    this.expr.setEmotion(e);
    this.bus?.emit('avatar.emotion', { emotion: e });
  }

  playAction(a: Action): void {
    if (isPresenceAction(a)) {
      if (this.presence.dispatchAction(a)) {
        this.bus?.emit('avatar.presence', { state: this.presence.current });
        if (a === 'leave') {
          this.anim.slideOut(true, this.slideDistance, 1.5, () => {
            this.presence.notifyAnimationDone('leave');
            this.bus?.emit('avatar.presence', { state: this.presence.current });
          });
        } else {
          // return：角色已在場外（leave 結束位置），直接滑回原位
          this.anim.slideBack(1.5, () => {
            this.presence.notifyAnimationDone('return');
            this.bus?.emit('avatar.presence', { state: this.presence.current });
          });
        }
      }
      return;
    }
    if (!this.presence.canInteract) return; // leave 期間不接受一般動作
    this.anim.play(a);
    this.bus?.emit('avatar.action', { action: a });
  }

  setLookAt(yawDeg: number, pitchDeg: number): void {
    this.gaze.setTarget({ yawDeg, pitchDeg });
  }

  /** 由 main 的 cursor:pos 換算（CSS px → 角度）。 */
  lookAtCursor(cursor: { x: number; y: number }, viewport: { width: number; height: number }): void {
    this.gaze.setTarget(gazeTargetFromCursor(cursor, viewport));
  }

  setMouth(viseme: MouthViseme, weight: number): void {
    this.lips.setMouth(viseme, weight);
  }

  setThinking(on: boolean): void {
    this.thinking = on;
    this.bus?.emit('avatar.thinking', { on });
  }

  get isThinking(): boolean {
    return this.thinking;
  }

  get canInteract(): boolean {
    return this.presence.canInteract;
  }

  /** 身體輕觸反應（內部微動作，不佔用 LLM 動作槽）。 */
  poke(): void {
    if (!this.presence.canInteract) return;
    this.anim.play('poke');
  }

  /** VRM 根節點（hit-test raycast 用；無模型時 null）。 */
  hitRoot(): THREE.Object3D | null {
    return this.vrm?.scene ?? null;
  }

  dispose(): void {
    this.anim.cancel();
    if (this.vrm !== null) {
      disposeVRM(this.vrm, this.scene);
      this.vrm = null;
    }
    this.expr.bind(null);
  }

  // ---- 每幀 ----

  update(dt: number): void {
    const bones = this.anim.activeBones();
    this.anim.update(dt);
    const headBusy = bones.has('head') || bones.has('neck');
    const spineBusy = bones.has('spine');
    this.idle.update(dt, spineBusy);
    this.gaze.update(dt, headBusy || !this.presence.canInteract);
    this.expr.update(dt);
    this.vrm?.update(THREE.MathUtils.clamp(dt, 0, 0.1));
  }
}
