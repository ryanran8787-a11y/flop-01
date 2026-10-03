import { z } from 'zod';
import { ACTIONS, EMOTIONS, WHISPER_SIZES } from './types.js';

/** 與 types.ts 保持一致的 zod 列舉（schema 驗證用）。 */
export const EmotionSchema = z.enum(EMOTIONS);
export const ActionSchema = z.enum(ACTIONS);

/**
 * AIResponse zod schema。
 * 注意：欄位用 .strict()? 不用 strict，允許模型多吐欄位但 strip；
 * outfitId 合法性需對照可用清單另行檢查（見 validateAIResponse）。
 */
export const AIResponseSchema = z.object({
  emotion: EmotionSchema,
  action: ActionSchema.optional(),
  outfitId: z.string().min(1).optional(),
  reply: z.string().min(1),
});

export type AIResponseInput = z.infer<typeof AIResponseSchema>;

/**
 * 驗證 + 降級：
 * - 解析失敗 → { emotion:'idle', reply: 原始文字截斷 }
 * - 非法 outfitId → 忽略該欄位（保留其餘）
 */
export function validateAIResponse(
  raw: unknown,
  opts: { rawTextFallback: string; validOutfitIds: readonly string[] },
): { emotion: (typeof EMOTIONS)[number]; action?: (typeof ACTIONS)[number]; outfitId?: string; reply: string } {
  const parsed = AIResponseSchema.safeParse(raw);
  if (!parsed.success) {
    const fallback = opts.rawTextFallback.trim().slice(0, 500) || '……嗯，我剛剛恍神了，你可以再說一次嗎？';
    return { emotion: 'idle', reply: fallback };
  }
  const v = parsed.data;
  if (v.outfitId !== undefined && !opts.validOutfitIds.includes(v.outfitId)) {
    const { outfitId: _dropped, ...rest } = v;
    void _dropped;
    return rest;
  }
  return v;
}

// --- AppConfig ---

export const WhisperSizeSchema = z.enum(WHISPER_SIZES);

export const ModelProfileSchema = z.object({
  temperature: z.number().min(0).max(2).default(0.7),
  num_ctx: z.number().int().min(2048).max(131072).default(8192),
  think: z.boolean().optional(),
});

export const AppConfigSchema = z.object({
  ollamaUrl: z.string().url().default('http://127.0.0.1:11434'),
  llmModel: z.string().min(1).default('qwen3:8b'),
  // zod v3/v4 相容寫法：record(key, value)
  modelProfiles: z.record(z.string(), ModelProfileSchema).default({}),
  whisper: z
    .object({
      size: WhisperSizeSchema.default('small'),
      device: z.enum(['cuda', 'cpu']).default('cuda'),
      compute: z.enum(['float16', 'int8_float16', 'int8']).default('float16'),
    })
    .default({ size: 'small', device: 'cuda', compute: 'float16' }),
  ttsVoice: z.string().min(1).default('zh-TW-HsiaoChenNeural'),
  avatar: z
    .object({ backend: z.enum(['vrm', 'live2d-stub']).default('vrm') })
    .default({ backend: 'vrm' }),
  stt: z
    .object({ mode: z.enum(['ptt', 'vad']).default('ptt') })
    .default({ mode: 'ptt' }),
  vrmPath: z.string().default(''),
  outfits: z
    .array(z.object({ id: z.string(), name: z.string(), vrmPath: z.string() }))
    .default([]),
  hotkeys: z
    .object({ ptt: z.string().default('F9'), mute: z.string().default('F10') })
    .default({ ptt: 'F9', mute: 'F10' }),
  fpsCap: z.number().int().min(10).max(120).default(60),
  window: z
    .object({ alwaysOnTop: z.boolean().default(true), skipTaskbar: z.boolean().default(false) })
    .default({ alwaysOnTop: true, skipTaskbar: false }),
  persona: z
    .object({
      name: z.string().default('小晴'),
      userTitle: z.string().default('你'),
      traits: z.string().default('溫暖、直接、像熟悉的朋友'),
      speech: z.string().default('繁中、台灣用語、句子簡短、不用疊字賣萌、不誇張敬語'),
      taboos: z.string().default('不情緒勒索、不給醫療法律專業建議'),
    })
    .default({
      name: '小晴',
      userTitle: '你',
      traits: '溫暖、直接、像熟悉的朋友',
      speech: '繁中、台灣用語、句子簡短、不用疊字賣萌、不誇張敬語',
      taboos: '不情緒勒索、不給醫療法律專業建議',
    }),
  disturb: z
    .object({ enabled: z.boolean().default(true), quietHours: z.string().default('23:00-08:00') })
    .default({ enabled: true, quietHours: '23:00-08:00' }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

/** 預設推薦組合（三組，VRAM 為估計值，UI 需註明）。 */
export interface HardwarePreset {
  id: 'low' | 'mid' | 'high';
  label: string;
  llmModel: string;
  whisperSize: (typeof WHISPER_SIZES)[number];
  whisperDevice: 'cuda' | 'cpu';
  whisperCompute: 'float16' | 'int8_float16' | 'int8';
  estVramMiB: number;
  note: string;
}

export const HARDWARE_PRESETS: readonly HardwarePreset[] = [
  {
    id: 'low',
    label: '低配（無 N 卡 / ≤6GB）',
    llmModel: 'qwen3:4b',
    whisperSize: 'base',
    whisperDevice: 'cpu',
    whisperCompute: 'int8',
    estVramMiB: 4000,
    note: '估計值：LLM 走 Ollama CPU/低 VRAM，Whisper CPU int8。',
  },
  {
    id: 'mid',
    label: '中配（8–12GB VRAM）',
    llmModel: 'qwen3:8b',
    whisperSize: 'small',
    whisperDevice: 'cuda',
    whisperCompute: 'float16',
    estVramMiB: 8000,
    note: '估計值：實際以 GET /api/ps + pynvml 為準。',
  },
  {
    id: 'high',
    label: '高配（≥16GB VRAM）',
    llmModel: 'qwen3:14b',
    whisperSize: 'large-v3-turbo',
    whisperDevice: 'cuda',
    whisperCompute: 'float16',
    estVramMiB: 14000,
    note: '估計值：large-v3-turbo 需 faster-whisper 支援，否則退回 large-v3。',
  },
] as const;
