import { HARDWARE_PRESETS, type HardwarePreset } from './config-schema.js';
/**
 * VRAM 估算（純函數）。全部是估計值，UI 必須註明：
 * - LLM：按參數量級估（Q4 量化，8B≈6GB、14B≈10GB、27B≈17GB；未知大小回 null 不警告）
 * - Whisper：whisper_models.EST_VRAM_MIB 對應表（float16；int8 打 6 折）
 */
const LLM_EST_MIB: Array<{ re: RegExp; mib: number }> = [
  { re: /27b|32b|30b/i, mib: 17000 },
  { re: /14b|13b/i, mib: 10000 },
  { re: /8b|7b/i, mib: 6000 },
  { re: /4b|3b/i, mib: 3500 },
  { re: /1\.5b|1b/i, mib: 2000 },
];

const WHISPER_EST_MIB: Record<string, number> = {
  tiny: 300,
  base: 600,
  small: 1200,
  medium: 2500,
  'large-v3': 3100,
  'large-v3-turbo': 1800,
};

export function estimateLlmMiB(model: string): number | null {
  for (const e of LLM_EST_MIB) {
    if (e.re.test(model)) return e.mib;
  }
  return null;
}

export function estimateWhisperMiB(size: string, compute: string): number | null {
  const base = WHISPER_EST_MIB[size];
  if (base === undefined) return null;
  if (compute === 'int8' || compute === 'int8_float16') return Math.round(base * 0.6);
  return base;
}

export interface VramCheck {
  total: number | null;
  used: number | null;
  ollamaLoadedMiB: number | null;
  warn: boolean;
  message: string;
}

/** 超標只警告不阻擋；任一未知則不警告（避免誤報）。 */
export function checkVram(
  cfg: { llmModel: string; whisper: { size: string; compute: string } },
  gpu: { vramTotalMiB: number | null },
): VramCheck {
  const llm = estimateLlmMiB(cfg.llmModel);
  const wh = estimateWhisperMiB(cfg.whisper.size, cfg.whisper.compute);
  const total = gpu.vramTotalMiB;
  if (llm === null || wh === null || total === null) {
    return { total, used: null, ollamaLoadedMiB: null, warn: false, message: '估計值不足，不警告' };
  }
  const need = llm + wh;
  const warn = need > total;
  return {
    total,
    used: null,
    ollamaLoadedMiB: null,
    warn,
    message: warn
      ? `估計佔用約 ${(need / 1024).toFixed(1)}GB（LLM ${(llm / 1024).toFixed(1)} + Whisper ${(wh / 1024).toFixed(1)}），超過 VRAM ${(total / 1024).toFixed(1)}GB。僅為估計值，仍可操作。`
      : `估計佔用約 ${(need / 1024).toFixed(1)}GB / VRAM ${(total / 1024).toFixed(1)}GB（估計值）`,
  };
}

/** 推薦預設：按 VRAM 選最接近的一組（無 N 卡回 low）。 */
export function recommendPreset(vramTotalMiB: number | null): HardwarePreset {
  if (vramTotalMiB === null) return HARDWARE_PRESETS[0] as HardwarePreset;
  if (vramTotalMiB >= 15000) return HARDWARE_PRESETS[2] as HardwarePreset;
  if (vramTotalMiB >= 7000) return HARDWARE_PRESETS[1] as HardwarePreset;
  return HARDWARE_PRESETS[0] as HardwarePreset;
}

/** 一鍵套用預設 → config patch（呼叫方再寫檔）。 */
export function presetToPatch(p: HardwarePreset): {
  llmModel: string;
  whisper: { size: string; device: 'cuda' | 'cpu'; compute: 'float16' | 'int8_float16' | 'int8' };
} {
  return {
    llmModel: p.llmModel,
    whisper: { size: p.whisperSize, device: p.whisperDevice, compute: p.whisperCompute },
  };
}
