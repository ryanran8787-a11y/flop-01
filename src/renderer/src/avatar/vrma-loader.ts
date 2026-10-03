import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import { createVRMAnimationClip, type VRMAnimation } from '@pixiv/three-vrm-animation';
import type { VRMCore } from '@pixiv/three-vrm-core';

/**
 * VRMA 載入預留介面（d.ts 已核實：VRMAnimationLoaderPlugin / createVRMAnimationClip 存在）。
 * 需驗證：真機 .vrma 檔的重定向效果（createVRMAnimationClip 需要同 VRM 實例）。
 * 本階段只提供載入 + 轉 clip；播放入 Mixer 的接線留給階段 4（動作系統）。
 */
export async function loadVRMAClip(url: string, vrm: VRMCore): Promise<THREE.AnimationClip> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  const gltf = await loader.loadAsync(url);
  const vrmAnimations = gltf.userData.vrmAnimations as VRMAnimation[] | undefined;
  const first = vrmAnimations?.[0];
  if (first === undefined) throw new Error(`VRMA 無動畫資料：${url}`);
  return createVRMAnimationClip(first, vrm);
}
