import * as THREE from 'three';
import { FrameGate, targetFps } from './fps.js';
import type { FpsMode } from '../../../shared/types.js';

/**
 * 透明舞台：alpha renderer + 半身取景相機 + 無 VRM 時的佔位膠囊。
 * 遮擋偵測：visibilitychange（Chromium 視窗遮擋追蹤）+ 手動 setOccluded（供 main 擴充）。
 * 需驗證：被全螢幕程式蓋住時 visibilitychange 是否觸發（Electron/Chromium 預設應會）。
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private gate = new FrameGate();
  private mode: FpsMode = 'active';
  private occludedPaused: boolean;
  private fpsCap: number;
  private placeholder: THREE.Group | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    opts: { fpsCap?: number; occludedPaused?: boolean } = {},
  ) {
    this.fpsCap = opts.fpsCap ?? 60;
    this.occludedPaused = opts.occludedPaused ?? false;
    // 注意：antialias 必須 false。Windows 透明視窗 + MSAA 在 ANGLE 下會卡死
    // （原生 webgl2 上下文正常，THREE.WebGLRenderer 帶 antialias 即 hang，實測）。
    // stencil 用不到也關掉，省一個 buffer。
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, stencil: false });
    this.renderer.setClearColor(0x000000, 0);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    // 半身取景：角色高 1.6，取胸上
    this.camera.position.set(0, 1.15, 2.6);
    this.camera.lookAt(0, 1.0, 0);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x444455, 1.1);
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(1.5, 2.5, 3);
    this.scene.add(hemi, dir);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      this.setMode(document.hidden ? 'occluded' : 'active');
    });
  }

  setMode(mode: FpsMode): void {
    this.mode = mode;
  }

  /** 閒置計時由呼叫方判定（無互動 N 秒 → idle，降 30fps）。 */
  setIdle(idle: boolean): void {
    if (this.mode !== 'occluded') this.mode = idle ? 'idle' : 'active';
  }

  setOccluded(occluded: boolean): void {
    this.mode = occluded ? 'occluded' : 'active';
  }

  /** 螢幕邊緣滑出距離（世界單位）：可視寬度 × 0.75。 */
  offscreenDistance(): number {
    const dist = this.camera.position.distanceTo(new THREE.Vector3(0, 1, 0));
    const h = 2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    return h * this.camera.aspect * 0.75;
  }

  setFpsCap(cap: number): void {
    this.fpsCap = Math.min(Math.max(Math.round(cap), 10), 120);
  }

  /** 佔位根節點（hit-test raycast 用；無佔位時 null）。 */
  pickRoot(): THREE.Object3D | null {
    return this.placeholder;
  }

  /** 佔位碰撞體（head/body 分開，供 picking 用）。 */
  pickProxies(): { head: THREE.Object3D | null; body: THREE.Object3D | null } {
    if (this.placeholder === null) return { head: null, body: null };
    let head: THREE.Object3D | null = null;
    let body: THREE.Object3D | null = null;
    this.placeholder.traverse((o) => {
      const p = (o.userData as { part?: unknown }).part;
      if (p === 'head' && head === null) head = o;
      if (p === 'body' && body === null) body = o;
    });
    return { head, body };
  }

  showPlaceholder(): void {
    if (this.placeholder !== null) return;
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x78b4ff, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.7, 8, 16), mat);
    body.position.y = 0.85;
    body.userData['part'] = 'body';
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 18), mat);
    head.position.y = 1.55;
    head.userData['part'] = 'head';
    g.add(body, head);
    this.scene.add(g);
    this.placeholder = g;
  }

  hidePlaceholder(): void {
    if (this.placeholder === null) return;
    this.scene.remove(this.placeholder);
    this.placeholder.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh === true) {
        m.geometry.dispose();
        const mt = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mt)) mt.forEach((x) => x.dispose());
        else mt.dispose();
      }
    });
    this.placeholder = null;
  }

  get hasPlaceholder(): boolean {
    return this.placeholder !== null;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  /** rAF 迴圈呼叫：到點才渲染，回傳是否渲染。 */
  render(nowMs: number): boolean {
    const fps = targetFps(this.mode, this.fpsCap, this.occludedPaused);
    if (!this.gate.shouldRender(nowMs, fps)) return false;
    this.renderer.render(this.scene, this.camera);
    return true;
  }

  dispose(): void {
    this.hidePlaceholder();
    this.renderer.dispose();
  }
}
