import * as THREE from 'three';

/**
 * 程序化一次性動作（無版權資產，純數學）。
 * 取代 presupposed 動畫檔；VRMA 載入見 vrma-loader.ts（預留介面）。
 *
 * 方向以弧度偏移寫在 normalized bone 上（base + offset），播完還原 base。
 * 手臂方向因模型靜息姿態而異，屬「需驗證真機」微調項（註於各動作）。
 */

export type OneShotAction = 'nod' | 'head_pat_react' | 'wave' | 'stretch';
/** 內部微反應（不進 LLM Action schema，只供互動層）。 */
export type PlayableAction = OneShotAction | 'poke';

interface Key {
  t: number; // 秒
  e: [number, number, number]; // euler 偏移（弧度）
}

interface ActionDef {
  duration: number;
  bones: Record<string, Key[]>;
}

const D = THREE.MathUtils.degToRad;

function keys(duration: number, bones: Record<string, Key[]>): ActionDef {
  return { duration, bones };
}

export const ACTION_DEFS: Record<PlayableAction, ActionDef> = {
  nod: keys(0.9, {
    // 點頭兩次（pitch +X 為低頭，依模型或需反號：需驗證）
    head: [
      { t: 0, e: [0, 0, 0] },
      { t: 0.22, e: [D(14), 0, 0] },
      { t: 0.45, e: [0, 0, 0] },
      { t: 0.67, e: [D(10), 0, 0] },
      { t: 0.9, e: [0, 0, 0] },
    ],
  }),
  head_pat_react: keys(1.2, {
    head: [
      { t: 0, e: [0, 0, 0] },
      { t: 0.3, e: [D(12), D(4), 0] },
      { t: 0.6, e: [D(12), D(-4), 0] },
      { t: 0.9, e: [D(6), 0, 0] },
      { t: 1.2, e: [0, 0, 0] },
    ],
    spine: [
      { t: 0, e: [0, 0, 0] },
      { t: 0.3, e: [D(4), 0, 0] },
      { t: 1.2, e: [0, 0, 0] },
    ],
  }),
  wave: keys(1.6, {
    // 需驗證：右臂上舉 + 前臂揮動方向（相對 base 偏移，最差情況看起來像搖擺）
    rightUpperArm: [
      { t: 0, e: [0, 0, 0] },
      { t: 0.4, e: [0, 0, D(-70)] },
      { t: 1.2, e: [0, 0, D(-70)] },
      { t: 1.6, e: [0, 0, 0] },
    ],
    rightLowerArm: [
      { t: 0, e: [0, 0, 0] },
      { t: 0.4, e: [0, 0, D(-20)] },
      { t: 0.7, e: [0, 0, D(15)] },
      { t: 1.0, e: [0, 0, D(-20)] },
      { t: 1.2, e: [0, 0, D(15)] },
      { t: 1.6, e: [0, 0, 0] },
    ],
  }),
  stretch: keys(2.0, {    leftUpperArm: [
      { t: 0, e: [0, 0, 0] },
      { t: 0.6, e: [0, 0, D(120)] },
      { t: 1.4, e: [0, 0, D(120)] },
      { t: 2.0, e: [0, 0, 0] },
    ],
    rightUpperArm: [
      { t: 0, e: [0, 0, 0] },
      { t: 0.6, e: [0, 0, D(-120)] },
      { t: 1.4, e: [0, 0, D(-120)] },
      { t: 2.0, e: [0, 0, 0] },
    ],
    spine: [
      { t: 0, e: [0, 0, 0] },
      { t: 0.6, e: [D(-8), 0, 0] },
      { t: 1.4, e: [D(-8), 0, 0] },
      { t: 2.0, e: [0, 0, 0] },
    ],
  }),
  poke: keys(0.6, {
    // 身體輕觸：小幅前傾 + 回彈（不搶頭部，視線層不受影響）
    spine: [
      { t: 0, e: [0, 0, 0] },
      { t: 0.18, e: [D(6), 0, D(2)] },
      { t: 0.6, e: [0, 0, 0] },
    ],
    head: [
      { t: 0, e: [0, 0, 0] },
      { t: 0.18, e: [D(5), 0, 0] },
      { t: 0.6, e: [0, 0, 0] },
    ],
  }),
};

function smooth(u: number): number {
  const c = Math.max(0, Math.min(1, u));
  return c * c * (3 - 2 * c);
}

function sample(track: Key[], t: number): [number, number, number] {
  if (track.length === 0) return [0, 0, 0];
  const first = track[0];
  const last = track[track.length - 1];
  if (first === undefined || last === undefined) return [0, 0, 0];
  if (t <= first.t) return [...first.e];
  if (t >= last.t) return [...last.e];
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i];
    const b = track[i + 1];
    if (a === undefined || b === undefined) continue;
    if (t >= a.t && t <= b.t) {
      const k = smooth((t - a.t) / Math.max(b.t - a.t, 1e-6));
      return [
        a.e[0] + (b.e[0] - a.e[0]) * k,
        a.e[1] + (b.e[1] - a.e[1]) * k,
        a.e[2] + (b.e[2] - a.e[2]) * k,
      ];
    }
  }
  return [...last.e];
}

export class ProceduralAnim {
  private current: PlayableAction | null = null;
  private t = 0;
  private base = new Map<string, THREE.Euler>();
  private rootBase: { x: number; y: number } | null = null;
  private slide: { from: number; to: number; duration: number } | null = null;
  private doneCbs: Array<() => void> = [];

  constructor(
    private getNode: (name: string) => THREE.Object3D | null,
    private getRoot: () => THREE.Object3D | null,
  ) {}

  get playing(): PlayableAction | null {
    return this.current;
  }

  /** 此動作佔用的骨骼（視線/待機層據此抑制同骨）。 */
  activeBones(): Set<string> {
    const def = this.current !== null ? ACTION_DEFS[this.current] : null;
    return new Set(def !== null ? Object.keys(def.bones) : []);
  }

  play(action: PlayableAction, onDone?: () => void): void {
    this.cancel();
    this.current = action;
    this.t = 0;
    if (onDone !== undefined) this.doneCbs.push(onDone);
  }

  /** 滑出/滑回螢幕邊緣（leave/return 用）。distance 為世界單位正值（向右）。 */
  slideOut(toRight: boolean, distance: number, duration: number, onDone?: () => void): void {
    const root = this.getRoot();
    if (root === null) {
      onDone?.();
      return;
    }
    if (this.rootBase === null) this.rootBase = { x: root.position.x, y: root.position.y };
    const from = root.position.x;
    this.slide = { from, to: (this.rootBase?.x ?? 0) + (toRight ? distance : -distance), duration };
    this.t = 0;
    this.current = null;
    if (onDone !== undefined) this.doneCbs.push(onDone);
  }

  slideBack(duration: number, onDone?: () => void): void {
    const root = this.getRoot();
    if (root === null) {
      onDone?.();
      return;
    }
    if (this.rootBase === null) this.rootBase = { x: 0, y: root.position.y };
    this.slide = { from: root.position.x, to: this.rootBase.x, duration };
    this.t = 0;
    this.current = null;
    if (onDone !== undefined) this.doneCbs.push(onDone);
  }

  cancel(): void {
    this.restoreBones();
    this.current = null;
    this.slide = null;
  }

  update(dt: number): void {
    if (this.slide !== null) {
      const root = this.getRoot();
      this.t += dt;
      const s = this.slide;
      const k = smooth(this.t / Math.max(s.duration, 1e-6));
      if (root !== null) {
        // 滑動 + 輕微上下浮動，營造走動感（y 以滑出起點為基準）
        root.position.x = s.from + (s.to - s.from) * k;
        const baseY = this.rootBase?.y ?? root.position.y;
        root.position.y = baseY + Math.sin(this.t * 10) * 0.01 * (1 - k);
      }
      if (this.t >= s.duration) {
        this.slide = null;
        this.flushDone();
      }
      return;
    }
    if (this.current === null) return;
    const def = ACTION_DEFS[this.current];
    this.t += dt;
    for (const [bone, track] of Object.entries(def.bones)) {
      const n = this.getNode(bone);
      if (n === null) continue;
      let b = this.base.get(bone);
      if (b === undefined) {
        b = n.rotation.clone();
        this.base.set(bone, b);
      }
      const [x, y, z] = sample(track, Math.min(this.t, def.duration));
      n.rotation.set(b.x + x, b.y + y, b.z + z, n.rotation.order);
    }
    if (this.t >= def.duration) {
      this.restoreBones();
      this.current = null;
      this.flushDone();
    }
  }

  private restoreBones(): void {
    for (const [bone, e] of this.base) {
      const n = this.getNode(bone);
      if (n !== null) n.rotation.copy(e);
    }
    this.base.clear();
  }

  private flushDone(): void {
    const cbs = this.doneCbs;
    this.doneCbs = [];
    for (const cb of cbs) {
      try {
        cb();
      } catch {
        // 忽略回調錯誤
      }
    }
  }
}
