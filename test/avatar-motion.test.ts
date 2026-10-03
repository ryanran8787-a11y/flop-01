import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { IdleController } from '../src/renderer/src/avatar/idle-controller.js';
import { EyeTrackingController } from '../src/renderer/src/avatar/eye-tracking-controller.js';
import { ACTION_DEFS, ProceduralAnim } from '../src/renderer/src/avatar/procedural-anim.js';
import { loadVRMFromUrl } from '../src/renderer/src/avatar/vrm-lifecycle.js';

function nodes(names: string[]): { get: (n: string) => THREE.Object3D | null; all: Map<string, THREE.Object3D> } {
  const all = new Map<string, THREE.Object3D>();
  for (const n of names) all.set(n, new THREE.Object3D());
  return { all, get: (n: string) => all.get(n) ?? null };
}

describe('IdleController', () => {
  it('呼吸帶動 chest；眨眼在 2.2–4.8s 內觸發並回零', () => {
    const ns = nodes(['chest', 'spine', 'hips']);
    const c = new IdleController(ns.get);
    const blinks: number[] = [];
    c.onBlink((v) => blinks.push(v));
    const chest0 = ns.all.get('chest')?.rotation.x ?? 0;
    for (let i = 0; i < 300; i++) c.update(1 / 60);
    expect(ns.all.get('chest')?.rotation.x).not.toBe(chest0);
    expect(blinks.length).toBeGreaterThan(0);
    expect(blinks[blinks.length - 1]).toBe(0);
  });
});

describe('EyeTrackingController', () => {
  it('damp 收斂到目標且頭頸眼分配不同', () => {
    const ns = nodes(['head', 'neck', 'leftEye', 'rightEye']);
    const c = new EyeTrackingController(ns.get);
    c.setTarget({ yawDeg: 35, pitchDeg: 20 });
    for (let i = 0; i < 300; i++) c.update(1 / 60);
    expect(c.current.yawDeg).toBeCloseTo(35, 0);
    const head = ns.all.get('head')?.rotation.y ?? 0;
    const neck = ns.all.get('neck')?.rotation.y ?? 0;
    const eye = ns.all.get('leftEye')?.rotation.y ?? 0;
    expect(head).toBeGreaterThan(neck);
    expect(head).toBeGreaterThan(eye);
  });

  it('suppressed 時不寫骨骼但內部繼續收斂', () => {
    const ns = nodes(['head', 'neck', 'leftEye', 'rightEye']);
    const c = new EyeTrackingController(ns.get);
    c.setTarget({ yawDeg: 35, pitchDeg: 0 });
    for (let i = 0; i < 60; i++) c.update(1 / 60, true);
    expect(ns.all.get('head')?.rotation.y).toBe(0);
    expect(c.current.yawDeg).toBeGreaterThan(1);
  });
});

describe('ProceduralAnim', () => {
  it('nod 播完回 base 並回調', () => {
    const ns = nodes(['head']);
    const onDone = vi.fn();
    const a = new ProceduralAnim(ns.get, () => null);
    a.play('nod', onDone);
    expect(a.playing).toBe('nod');
    expect(a.activeBones().has('head')).toBe(true);
    for (let i = 0; i < 120; i++) a.update(1 / 60);
    expect(a.playing).toBeNull();
    expect(ns.all.get('head')?.rotation.x).toBeCloseTo(0, 6);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('中途有位移（非靜止）', () => {
    const ns = nodes(['head']);
    const a = new ProceduralAnim(ns.get, () => null);
    a.play('nod');
    a.update(ACTION_DEFS.nod.duration * 0.25);
    expect(Math.abs(ns.all.get('head')?.rotation.x ?? 0)).toBeGreaterThan(0.01);
  });

  it('無 root 時 slide 直接回調（不卡住狀態機）', () => {
    const a = new ProceduralAnim(() => null, () => null);
    const onDone = vi.fn();
    a.slideOut(true, 2, 1.5, onDone);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('vrm-lifecycle 失敗保留', () => {
  it('loader 失敗時 reject，呼叫方場景不被動', async () => {
    const scene = new THREE.Scene();
    const before = scene.children.length;
    await expect(loadVRMFromUrl('nope.vrm', () => Promise.reject(new Error('404')))).rejects.toThrow();
    expect(scene.children.length).toBe(before);
  });
});
