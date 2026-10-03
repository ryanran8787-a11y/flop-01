import type { GpuStats } from '../shared/types.js';
import type { SideToMain } from '../shared/protocol.js';
import type { SidecarManager } from './sidecar.js';
import type { OllamaClient } from './ollama.js';

/**
 * 設定頁資源快照（純組合邏輯，無 Electron 依賴，可測）。
 * sidecar gpuStats 走「送請求→等下一則 gpu.stats」配對。
 */
export interface StatsSnapshot {
  gpu: GpuStats | null;
  sidecarOnline: boolean;
  ollama: Array<{ name: string; sizeVram: number }> | null;
  ollamaError?: string;
  at: number;
}

export function requestGpuStats(mgr: SidecarManager, timeoutMs = 5000): Promise<GpuStats | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      mgr.off('message', onMsg);
      resolve(null);
    }, timeoutMs);
    const onMsg = (msg: SideToMain): void => {
      if (msg.t !== 'gpu.stats') return;
      clearTimeout(timer);
      mgr.off('message', onMsg);
      resolve({
        vramTotalMiB: msg.vramTotalMiB,
        vramUsedMiB: msg.vramUsedMiB,
        ollamaLoadedMiB: null,
        hasNvidia: msg.hasNvidia,
        sampledAt: msg.at,
      });
    };
    mgr.on('message', onMsg);
    if (!mgr.gpuStats()) {
      clearTimeout(timer);
      mgr.off('message', onMsg);
      resolve(null);
    }
  });
}

export async function collectStats(deps: {
  sidecar: SidecarManager | null;
  ollama: OllamaClient | null;
}): Promise<StatsSnapshot> {
  const online = deps.sidecar?.status === 'online';
  const gpu = deps.sidecar !== null && online ? await requestGpuStats(deps.sidecar) : null;
  let ollamaModels: StatsSnapshot['ollama'] = null;
  let ollamaError: string | undefined;
  if (deps.ollama !== null) {
    try {
      ollamaModels = await deps.ollama.loadedModels();
    } catch (err) {
      ollamaError = (err as Error).message;
    }
  }
  return { gpu, sidecarOnline: online, ollama: ollamaModels, ollamaError, at: Date.now() };
}
