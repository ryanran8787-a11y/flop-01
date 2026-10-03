import * as THREE from 'three';

/**
 * 待機層：呼吸、眨眼、微擺動（IdleController）。
 * - 只寫 spine/chest/hips（呼吸/擺動），head/neck/eyes 留給視線層
 * - 眨眼經 ExpressionController.setBlink（2.2–4.8s 隨機間隔，閉合約 120ms）
 * - 動作層播 one-shot 時，呼叫方可傳 suppressedBones 讓呼吸暫停胸部起伏
 */
export type IdleBoneName = 'spine' | 'chest' | 'hips';

export class IdleController {
  private t = 0;
  private nextBlinkAt = 2.5;
  private blinkT = -1; // ≥0 表示眨眼進行中（0–0.12s）
  private base = new Map<string, { rot: THREE.Euler; pos: THREE.Vector3 }>();
  private setBlink: (v: number) => void = () => {};

  constructor(private getNode: (name: IdleBoneName) => THREE.Object3D | null) {}

  onBlink(cb: (v: number) => void): void {
    this.setBlink = cb;
  }

  /** 換模型時清掉舊基準（下一幀重抓）。 */
  rebind(): void {
    this.base.clear();
  }

  update(dt: number, suppressed = false): void {
    this.t += dt;
    if (!suppressed) {
      this.write('hips', (n, b) => {
        n.position.y = b.pos.y + Math.sin(this.t * (Math.PI / 2)) * 0.008;
        n.rotation.z = b.rot.z + Math.sin(this.t * 0.5) * 0.012;
      });
      this.write('chest', (n, b) => {
        n.rotation.x = b.rot.x + Math.sin(this.t * (Math.PI / 2)) * 0.03;
      });
      this.write('spine', (n, b) => {
        n.rotation.y = b.rot.y + Math.sin(this.t * 0.4) * 0.015;
      });
    }
    // 眨眼（不受 suppressed 影響：說話/動作時也眨眼）
    if (this.blinkT < 0 && this.t >= this.nextBlinkAt) {
      this.blinkT = 0;
    }
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const D = 0.12;
      if (this.blinkT >= D) {
        this.blinkT = -1;
        this.setBlink(0);
        this.nextBlinkAt = this.t + 2.2 + Math.random() * 2.6;
      } else {
        // 三角波：0→1→0
        const v = this.blinkT < D / 2 ? this.blinkT / (D / 2) : 1 - (this.blinkT - D / 2) / (D / 2);
        this.setBlink(v);
      }
    }
  }

  private write(name: IdleBoneName, fn: (n: THREE.Object3D, b: { rot: THREE.Euler; pos: THREE.Vector3 }) => void): void {
    const n = this.getNode(name);
    if (n === null) return;
    let b = this.base.get(name);
    if (b === undefined) {
      b = { rot: n.rotation.clone(), pos: n.position.clone() };
      this.base.set(name, b);
    }
    fn(n, b);
  }
}
