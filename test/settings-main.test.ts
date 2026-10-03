import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toAssetUrl } from '../src/main/asset-paths.js';
import { importVrmFile } from '../src/main/model-store.js';
import { collectStats, requestGpuStats } from '../src/main/stats-core.js';

describe('asset url', () => {
  it('models/tts 映射；越界回 null', () => {
    const userData = join(tmpdir(), 'ud-test');
    expect(toAssetUrl(join(userData, 'asset', 'models', 'a.vrm'), userData)).toBe('asset://models/a.vrm');
    expect(toAssetUrl(join(userData, 'asset', 'tts', 'x.mp3'), userData)).toBe('asset://tts/x.mp3');
    expect(toAssetUrl(join(userData, 'other', 'a.vrm'), userData)).toBeNull();
    expect(toAssetUrl(join(userData, 'asset', 'models', '..', 'evil'), userData)).toBeNull();
  });

  it('importVrmFile 複製並重名防撞', () => {
    const userData = mkdtempSync(join(tmpdir(), 'ud-'));
    const srcDir = mkdtempSync(join(tmpdir(), 'src-'));
    const src = join(srcDir, 'me.vrm');
    writeFileSync(src, 'fake-vrm-bytes');
    const r1 = importVrmFile(src, userData);
    expect(r1.url).toBe('asset://models/me.vrm');
    expect(existsSync(join(userData, 'asset', 'models', 'me.vrm'))).toBe(true);
    const r2 = importVrmFile(src, userData);
    expect(r2.fileName).toBe('me-2.vrm');
  });
});

function fakeMgr(): EventEmitter & { status: string; gpuStats: () => boolean; sent: boolean } {
  const m = new EventEmitter() as EventEmitter & { status: string; gpuStats: () => boolean; sent: boolean };
  m.status = 'online';
  m.sent = false;
  m.gpuStats = () => {
    m.sent = true;
    return true;
  };
  return m;
}

describe('stats', () => {
  it('requestGpuStats 配對回應；離線回 null', async () => {
    const m = fakeMgr();
    const p = requestGpuStats(m as never, 1000);
    m.emit('message', { t: 'gpu.stats', vramTotalMiB: 8192, vramUsedMiB: 100, hasNvidia: true, at: 1 });
    const g = await p;
    expect(g?.vramTotalMiB).toBe(8192);

    const off = fakeMgr();
    (off as { gpuStats: () => boolean }).gpuStats = () => false;
    expect(await requestGpuStats(off as never, 50)).toBeNull();
  });

  it('collectStats 組快照；ollama 失敗帶錯', async () => {
    const m = fakeMgr();
    setTimeout(() => {
      m.emit('message', { t: 'gpu.stats', vramTotalMiB: 1, vramUsedMiB: 2, hasNvidia: false, at: 3 });
    }, 5);
    const s = await collectStats({
      sidecar: m as never,
      ollama: { loadedModels: async () => [{ name: 'm', sizeVram: 1 }] } as never,
    });
    expect(s.sidecarOnline).toBe(true);
    expect(s.ollama?.length).toBe(1);

    const bad = await collectStats({
      sidecar: null,
      ollama: { loadedModels: async () => { throw new Error('down'); } } as never,
    });
    expect(bad.gpu).toBeNull();
    expect(bad.ollamaError).toBe('down');
  });
});
