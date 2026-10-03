import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { pickPart, refreshBodyProxy, toNdc } from '../src/renderer/src/interaction/picking.js';

function camera(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  c.position.set(0, 1.15, 2.6);
  c.lookAt(0, 1.0, 0);
  c.updateMatrixWorld(true);
  return c;
}

describe('picking', () => {
  it('頭優先於身體；皆無 → none', () => {
    const cam = camera();
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6));
    head.position.set(0, 1.5, 0);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 0.3));
    body.position.set(0, 0.8, 0);
    const root = new THREE.Group();
    root.add(head, body);
    root.updateMatrixWorld(true);
    // 朝頭中心打
    const ndcHead = new THREE.Vector3(0, 1.5, 0).project(cam);
    expect(pickPart({ x: ndcHead.x, y: ndcHead.y }, cam, { head, body })).toBe('head');
    // 朝身體下半打（避開頭）
    const ndcBody = new THREE.Vector3(0, 0.3, 0).project(cam);
    expect(pickPart({ x: ndcBody.x, y: ndcBody.y }, cam, { head, body })).toBe('body');
    // 朝空處打
    expect(pickPart({ x: 0.99, y: 0.99 }, cam, { head, body })).toBe('none');
  });

  it('toNdc 換算', () => {
    expect(toNdc(0, 0, { left: 0, top: 0, width: 100, height: 100 })).toEqual({ x: -1, y: 1 });
    expect(toNdc(100, 100, { left: 0, top: 0, width: 100, height: 100 })).toEqual({ x: 1, y: -1 });
  });

  it('refreshBodyProxy 建盒且可重建（無外洩殘留）', () => {
    const parent = new THREE.Group();
    const inner = new THREE.Mesh(new THREE.BoxGeometry(1, 1.6, 0.5));
    inner.position.y = 0.8;
    parent.add(inner);
    parent.updateMatrixWorld(true);
    const b1 = refreshBodyProxy(parent);
    expect(b1).not.toBeNull();
    expect(parent.getObjectByName('__body_proxy')).toBe(b1);
    const b2 = refreshBodyProxy(parent);
    expect(parent.children.filter((o) => o.name === '__body_proxy').length).toBe(1);
    expect(b2).not.toBe(b1);
  });
});
