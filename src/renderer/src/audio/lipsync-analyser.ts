import type { MouthViseme } from '../../../shared/types.js';

/**
 * 頻段能量 → viseme 啟發式映射（近似方案，詳見 docs/LIPSYNC-APPROX.md）。
 * - 輸入：getByteFrequencyData 的 0–255 量級，長度 = fftSize/2
 * - 噪音閘 + attack 40ms / release 100ms 平滑
 * - simple 模式：只用整體音量驅動 aa（降級）
 */
export type OpenViseme = Exclude<MouthViseme, 'closed'>;
export type VisemeWeights = Record<OpenViseme, number>;

const VISEMES: OpenViseme[] = ['aa', 'ih', 'ou', 'ee', 'oh'];

/** 頻段（Hz）。 */
const BANDS = {
  low: [150, 500],
  mid1: [500, 1000],
  mid2: [1000, 2500],
  hi: [2500, 6000],
} as const;

export interface LipSyncOptions {
  sampleRate: number;
  fftSize?: number;
  /** 噪音閘（0–1，byte 正規化均值）。 */
  noiseGate?: number;
  attackMs?: number;
  releaseMs?: number;
  simple?: boolean;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export class LipSyncMapper {
  private readonly binHz: number;
  private gate: number;
  private readonly attackTau: number;
  private readonly releaseTau: number;
  private simple: boolean;
  private smooth: VisemeWeights = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };

  constructor(opts: LipSyncOptions) {
    const fft = opts.fftSize ?? 1024;
    this.binHz = opts.sampleRate / 2 / (fft / 2);
    this.gate = opts.noiseGate ?? 0.08;
    this.attackTau = (opts.attackMs ?? 40) / 1000;
    this.releaseTau = (opts.releaseMs ?? 100) / 1000;
    this.simple = opts.simple ?? false;
  }

  setSimple(simple: boolean): void {
    this.simple = simple;
  }

  setGate(gate: number): void {
    this.gate = clamp01(gate);
  }

  reset(): void {
    this.smooth = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
  }

  get weights(): VisemeWeights {
    return { ...this.smooth };
  }

  /** 主入口：餵一幀頻譜 + 幀間隔秒數，回傳平滑後五軸權重。 */
  process(mags: ArrayLike<number>, dt: number): VisemeWeights {
    const e = this.bandEnergies(mags);
    const sum = e.low + e.mid1 + e.mid2 + e.hi;
    const overall = sum / 4;
    const open = clamp01((overall - this.gate) * 3);
    let target: VisemeWeights;
    if (open <= 0) {
      target = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    } else if (this.simple) {
      target = { aa: open, ih: 0, ou: 0, ee: 0, oh: 0 };
    } else {
      const rLow = e.low / Math.max(sum, 1e-9);
      const rMid = (e.mid1 + e.mid2) / Math.max(sum, 1e-9);
      const rHi = e.hi / Math.max(sum, 1e-9);
      target = {
        aa: clamp01(open * (0.35 + 0.65 * rMid)),
        ih: clamp01(open * rHi * 0.7 + open * rMid * 0.25),
        ou: clamp01(open * rLow * 0.6),
        ee: clamp01(open * Math.pow(rHi, 1.3) * 1.4),
        oh: clamp01(open * Math.pow(rLow, 1.5) * 1.2),
      };
    }
    const out = { ...this.smooth };
    for (const v of VISEMES) {
      const t = target[v];
      const tau = t > out[v] ? this.attackTau : this.releaseTau;
      const k = 1 - Math.exp(-Math.max(dt, 0) / Math.max(tau, 1e-6));
      out[v] = out[v] + (t - out[v]) * k;
    }
    this.smooth = out;
    return { ...out };
  }

  private bandEnergies(mags: ArrayLike<number>): Record<keyof typeof BANDS, number> {
    const avg = (lo: number, hi: number): number => {
      const a = Math.max(0, Math.floor(lo / this.binHz));
      const b = Math.min(mags.length - 1, Math.ceil(hi / this.binHz));
      if (b < a) return 0;
      let s = 0;
      for (let i = a; i <= b; i++) s += (mags[i] ?? 0) / 255;
      return s / (b - a + 1);
    };
    return {
      low: avg(...BANDS.low),
      mid1: avg(...BANDS.mid1),
      mid2: avg(...BANDS.mid2),
      hi: avg(...BANDS.hi),
    };
  }
}

/** 取主導 viseme（播放器每幀只送一個，配 ExpressionController 的獨寫語義）。 */
export function dominant(weights: VisemeWeights, floor = 0.05): { viseme: MouthViseme; weight: number } {
  let best: OpenViseme = 'aa';
  let bestW = -1;
  for (const v of VISEMES) {
    if (weights[v] > bestW) {
      bestW = weights[v];
      best = v;
    }
  }
  if (bestW < floor) return { viseme: 'closed', weight: 0 };
  return { viseme: best, weight: bestW };
}
