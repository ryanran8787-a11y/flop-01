import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

/**
 * VRM 載入 / 釋放 / 取景（d.ts + 實作皆已核實）。
 * - 失敗時不動場景舊角色（呼叫方保留舊參照），只 throw
 * - 0.x 模型：rotateVRM0 轉正（d.ts 已核實）
 * - 釋放：scene.remove + VRMUtils.deepDispose（實作確認含 geometry/material/texture）
 */

export async function loadVRMFromUrl(
  url: string,
  load?: (url: string) => Promise<GLTF>,
): Promise<VRM> {
  const gltf =
    load !== undefined
      ? await load(url)
      : await new Promise<GLTF>((resolve, reject) => {
          const loader = new GLTFLoader();
          loader.register((parser) => new VRMLoaderPlugin(parser));
          loader.load(url, resolve, undefined, reject);
        });
  // 需驗證：userData.vrm 為官方範例寫法（型別上為 unknown，需斷言）
  const vrm = (gltf.userData as { vrm?: VRM }).vrm;
  if (vrm === undefined) throw new Error(`非 VRM 模型或解析失敗：${url}`);
  if (vrm.meta.metaVersion === '0') VRMUtils.rotateVRM0(vrm);
  return vrm;
}

export function disposeVRM(vrm: VRM, scene: THREE.Scene): void {
  scene.remove(vrm.scene);
  VRMUtils.deepDispose(vrm.scene);
}

/**
 * 取景：等比縮放到目標身高，雙腳貼 y=0，水平置中。
 * @returns 實際縮放與包圍盒高度（供 slide 距離計算）
 */
export function frameVRM(vrm: VRM, targetHeight = 1.6): { scale: number; height: number } {
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const size = box.getSize(new THREE.Vector3());
  const scale = size.y > 1e-6 ? targetHeight / size.y : 1;
  vrm.scene.scale.setScalar(scale);
  // 縮放後重新計算偏移：水平置中、雙腳貼 y=0
  const box2 = new THREE.Box3().setFromObject(vrm.scene);
  const center2 = box2.getCenter(new THREE.Vector3());
  vrm.scene.position.x -= center2.x;
  vrm.scene.position.z -= center2.z;
  vrm.scene.position.y -= box2.min.y;
  return { scale, height: size.y * scale };
}

/**
 * 頭部不可見碰撞球（階段 4 摸頭命中用）。
 * material.visible=false + mesh 可見：渲染無輸出；raycast 行為於階段 4 真機核實。
 */
export function attachHeadCollider(headNode: THREE.Object3D, radius = 0.16): THREE.Mesh {
  const old = headNode.getObjectByName('__head_collider') as THREE.Mesh | undefined;
  if (old !== undefined) {
    headNode.remove(old);
    old.geometry.dispose();
    (old.material as THREE.Material).dispose();
  }
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 12, 10),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  mesh.name = '__head_collider';
  mesh.userData['part'] = 'head';
  headNode.add(mesh);
  return mesh;
}
