import * as THREE from 'three';
import type { HitPart } from '../../../shared/types.js';

/**
 * 碰撞體-only picking（不掃可見 mesh，省效能）。
 * 優先順序：head collider 命中即 'head'（即使身體盒更近）→ body proxy → none。
 * 頭 collider 與身體盒皆為 material.visible=false（headless 探針已證實可 raycast）。
 */
export interface PickProxies {
  head: THREE.Object3D | null;
  body: THREE.Object3D | null;
}

const _ray = new THREE.Raycaster();

export function pickPart(ndc: { x: number; y: number }, camera: THREE.Camera, proxies: PickProxies): HitPart {
  _ray.setFromCamera(ndc as THREE.Vector2, camera);
  if (proxies.head !== null && _ray.intersectObject(proxies.head, true).length > 0) return 'head';
  if (proxies.body !== null && _ray.intersectObject(proxies.body, true).length > 0) return 'body';
  return 'none';
}

/** client px → NDC（rect 為 canvas 邊界）。 */
export function toNdc(x: number, y: number, rect: { left: number; top: number; width: number; height: number }): {
  x: number;
  y: number;
} {
  const w = Math.max(rect.width, 1);
  const h = Math.max(rect.height, 1);
  return { x: ((x - rect.left) / w) * 2 - 1, y: -((y - rect.top) / h) * 2 + 1 };
}

/**
 * 依包圍盒重建身體代理盒（vrm.scene 的子節點，跟著滑動/縮放走）。
 * 舊代理一併 dispose，避免重複載入外洩。
 */
export function refreshBodyProxy(parent: THREE.Object3D): THREE.Mesh | null {
  const old = parent.getObjectByName('__body_proxy') as THREE.Mesh | undefined;
  if (old !== undefined) {
    parent.remove(old);
    old.geometry.dispose();
    (old.material as THREE.Material).dispose();
  }
  const box = new THREE.Box3().setFromObject(parent);
  if (box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // 代理盒用 parent 本地座標：先轉到本地再建盒
  const local = parent.worldToLocal(center.clone());
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(size.x, 0.05), Math.max(size.y, 0.05), Math.max(size.z, 0.05)),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  mesh.name = '__body_proxy';
  mesh.userData['part'] = 'body';
  mesh.position.copy(local);
  parent.add(mesh);
  return mesh;
}
