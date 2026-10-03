import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GestureEngine, type GestureEvent } from '../src/renderer/src/interaction/gestures.js';

function engine(): { e: GestureEngine; got: GestureEvent[]; now: { v: number } } {
  const got: GestureEvent[] = [];
  const now = { v: 1000 };
  return { e: new GestureEngine((g) => got.push(g)), got, now };
}

describe('GestureEngine', () => {
  it('快點 → click', () => {
    const { e, got, now } = engine();
    e.down(10, 10, now.v);
    e.up(11, 11, now.v + 120);
    expect(got).toEqual([{ type: 'click', x: 11, y: 11 }]);
  });

  it('超時放開 → 非 click 非 longpress（由 tick 決定的 longpress 已先發）', () => {
    const { e, got, now } = engine();
    e.down(10, 10, now.v);
    e.tick(now.v + 700);
    expect(got).toEqual([{ type: 'longpress', x: 10, y: 10 }]);
    e.up(10, 10, now.v + 800);
    expect(got.length).toBe(1);
  });

  it('移動 >5px → dragstart/move/end（無 click）', () => {
    const { e, got, now } = engine();
    e.down(0, 0, now.v);
    e.move(3, 0, now.v + 10);
    expect(got.length).toBe(0);
    e.move(6, 0, now.v + 20);
    expect(got[0]?.type).toBe('dragstart');
    // 跨越閾值的同一個 move 會接著發 dragmove（增量自按下點起算）
    expect(got[1]).toEqual({ type: 'dragmove', x: 6, y: 0, dx: 6, dy: 0 });
    e.move(10, 2, now.v + 30);
    expect(got[2]).toEqual({ type: 'dragmove', x: 10, y: 2, dx: 4, dy: 2 });
    e.up(10, 2, now.v + 40);
    expect(got[got.length - 1]?.type).toBe('dragend');
    expect(got.some((g) => g.type === 'click')).toBe(false);
  });

  it('拖曳後 tick 不觸發 longpress；cancel 清狀態', () => {
    const { e, got, now } = engine();
    e.down(0, 0, now.v);
    e.move(20, 0, now.v + 10);
    e.tick(now.v + 9999);
    expect(got.some((g) => g.type === 'longpress')).toBe(false);
    e.cancel();
    e.up(20, 0, now.v + 10000);
    expect(got.some((g) => g.type === 'dragend')).toBe(false);
  });

  it('無 down 的 move/up 被忽略', () => {
    const { e, got, now } = engine();
    e.move(5, 5, now.v);
    e.up(5, 5, now.v);
    expect(got).toEqual([]);
  });
});

describe('假設驗證：不可見材質的 raycast 行為', () => {
  function shoot(target: THREE.Object3D): number {
    const ray = new THREE.Raycaster();
    ray.set(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
    return ray.intersectObject(target, false).length;
  }

  it('material.visible=false 的 mesh 是否命中（決定碰撞體寫法）', () => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    m.updateMatrixWorld(true);
    const n = shoot(m);
    // 若為 0，碰撞體必須改用 colorWrite:false 寫法
    expect(n).toBeGreaterThanOrEqual(0);
    (m as unknown as { __hits: number }).__hits = n;
    console.log(`[probe] material.visible=false raycast hits = ${n}`);
  });
});
