import * as THREE from 'three';
import { distributeGaze, type LookAngles } from './gaze-math.js';

/**
 * 視線層：游標目標 → damp 平滑 → 頭/頸/眼加權分配。
 * 寫入 normalized bone（humanoid.update 會同步到 raw）。
 * one-shot 動作需要頭部時由 AvatarController 傳 suppressed=true 暫停。
 */
export type GazeBoneName = 'head' | 'neck' | 'leftEye' | 'rightEye';

export class EyeTrackingController {
  private cur: LookAngles = { yawDeg: 0, pitchDeg: 0 };
  private target: LookAngles = { yawDeg: 0, pitchDeg: 0 };
  private base = new Map<string, THREE.Euler>();

  constructor(private getNode: (name: GazeBoneName) => THREE.Object3D | null) {}

  setTarget(t: LookAngles): void {
    this.target = t;
  }

  rebind(): void {
    this.base.clear();
  }

  update(dt: number, suppressed = false, lambda = 10): void {
    const k = THREE.MathUtils.damp(0, 1, lambda, Math.max(dt, 0));
    // 用 damp 係數做 lerp：cur += (target - cur) * k
    this.cur = {
      yawDeg: this.cur.yawDeg + (this.target.yawDeg - this.cur.yawDeg) * k,
      pitchDeg: this.cur.pitchDeg + (this.target.pitchDeg - this.cur.pitchDeg) * k,
    };
    if (suppressed) return;
    const d = distributeGaze(this.cur);
    this.write('head', d.head.yawDeg, d.head.pitchDeg);
    this.write('neck', d.neck.yawDeg, d.neck.pitchDeg);
    this.write('leftEye', d.eyes.yawDeg, d.eyes.pitchDeg);
    this.write('rightEye', d.eyes.yawDeg, d.eyes.pitchDeg);
  }

  /** 目前視線（度），供除錯/測試。 */
  get current(): LookAngles {
    return { ...this.cur };
  }

  private write(name: GazeBoneName, yawDeg: number, pitchDeg: number): void {
    const n = this.getNode(name);
    if (n === null) return;
    let b = this.base.get(name);
    if (b === undefined) {
      b = n.rotation.clone();
      this.base.set(name, b);
    }
    // three 座標：yaw=Y，pitch=X（低頭為 +X，依模型而異，微調見 需驗證）
    n.rotation.set(
      b.x + THREE.MathUtils.degToRad(pitchDeg),
      b.y + THREE.MathUtils.degToRad(yawDeg),
      b.z,
      n.rotation.order,
    );
  }
}
