import { describe, expect, it } from 'vitest';
import { LipSyncMapper, dominant } from '../src/renderer/src/audio/lipsync-analyser.js';

const SR = 48000;
const BINS = 512;

/** 合成頻譜：在指定頻段填值，其餘填底噪。 */
function spectrum(fill: Partial<Record<'low' | 'mid1' | 'mid2' | 'hi', number>>, noise = 2): number[] {
  const a = new Array<number>(BINS).fill(noise);
  const binHz = SR / 2 / BINS;
  const ranges = { low: [150, 500], mid1: [500, 1000], mid2: [1000, 2500], hi: [2500, 6000] } as const;
  for (const [k, v] of Object.entries(fill)) {
    const [lo, hi] = ranges[k as keyof typeof ranges];
    for (let i = Math.floor(lo / binHz); i <= Math.ceil(hi / binHz) && i < BINS; i++) a[i] = v;
  }
  return a;
}

function settle(fill: Partial<Record<'low' | 'mid1' | 'mid2' | 'hi', number>>, secs = 1.0): ReturnType<LipSyncMapper['process']> {
  const m = new LipSyncMapper({ sampleRate: SR });
  let w = m.process(spectrum(fill), 1 / 60);
  for (let i = 0; i < Math.round(secs * 60); i++) w = m.process(spectrum(fill), 1 / 60);
  return w;
}

describe('LipSyncMapper', () => {
  it('靜音 → 全零（閉合）', () => {
    const m = new LipSyncMapper({ sampleRate: SR });
    const w = m.process(spectrum({}, 0), 0.5);
    expect(Object.values(w).every((v) => v === 0)).toBe(true);
    expect(dominant(w)).toEqual({ viseme: 'closed', weight: 0 });
  });

  it('中頻主導 → aa 最強', () => {
    const w = settle({ mid1: 180, mid2: 150, low: 40, hi: 30 });
    expect(w.aa).toBeGreaterThan(0.3);
    expect(dominant(w).viseme).toBe('aa');
  });

  it('高頻主導 → ee 出頭', () => {
    const w = settle({ hi: 200, low: 30, mid1: 40, mid2: 50 });
    expect(w.ee).toBeGreaterThan(w.aa);
    expect(dominant(w).viseme).toBe('ee');
  });

  it('低頻主導 → oh/ou 高於 ee', () => {
    const w = settle({ low: 200, hi: 25, mid1: 60, mid2: 50 });
    expect(w.oh + w.ou).toBeGreaterThan(w.ee);
  });

  it('attack 快、release 慢', () => {
    const m = new LipSyncMapper({ sampleRate: SR, attackMs: 40, releaseMs: 100 });
    const loud = spectrum({ mid1: 200, mid2: 180 });
    const quiet = spectrum({}, 0);
    m.process(loud, 0.04);
    const afterAttack = m.weights.aa;
    // 放足夠長達到穩態
    for (let i = 0; i < 120; i++) m.process(loud, 1 / 60);
    const steady = m.weights.aa;
    m.process(quiet, 0.04);
    const afterRelease = m.weights.aa;
    // 同樣 40ms：attack 上升量 > release 下降量（release 較慢）
    expect(afterAttack - 0).toBeGreaterThan(steady - afterRelease);
  });

  it('simple 模式只動 aa', () => {
    const m = new LipSyncMapper({ sampleRate: SR, simple: true });
    let w = m.process(spectrum({ hi: 200 }), 1 / 60);
    for (let i = 0; i < 60; i++) w = m.process(spectrum({ hi: 200 }), 1 / 60);
    expect(w.aa).toBeGreaterThan(0.2);
    expect(w.ee).toBe(0);
    expect(w.oh).toBe(0);
  });
});
