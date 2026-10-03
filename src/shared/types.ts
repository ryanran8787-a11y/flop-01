/**
 * 全專案共用基礎型別。只放型別 + 常數，不放實作。
 * 任何模組不得在這裡 import main / renderer / sidecar 的實作。
 */

/** LLM 結構化輸出。欄位順序即輸出順序（emotion 先於 reply）。 */
export interface AIResponse {
  emotion: Emotion;
  action?: Action;
  outfitId?: string;
  reply: string;
}

export const EMOTIONS = [
  'idle',
  'happy',
  'shy',
  'caring',
  'annoyed',
  'surprised',
] as const;
export type Emotion = (typeof EMOTIONS)[number];

export const ACTIONS = [
  'nod',
  'head_pat_react',
  'wave',
  'stretch',
  'leave',
  'return',
] as const;
export type Action = (typeof ACTIONS)[number];

/** 一次性動作是否為 leave/return（需走狀態機，leave 期間鎖互動）。 */
export function isPresenceAction(a: Action | undefined): a is 'leave' | 'return' {
  return a === 'leave' || a === 'return';
}

export interface Outfit {
  id: string;
  name: string;
  /** 本地 VRM 檔案路徑（換裝 = 切 VRM 檔）。 */
  vrmPath: string;
}

/** 口型 viseme。closed = 閉合（靜音/播放結束）。 */
export const MOUTH_VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh', 'closed'] as const;
export type MouthViseme = (typeof MOUTH_VISEMES)[number];

/** STT 收音模式。 */
export type STTMode = 'ptt' | 'vad';

export const WHISPER_SIZES = [
  'tiny',
  'base',
  'small',
  'medium',
  'large-v3',
  'large-v3-turbo',
] as const;
export type WhisperSize = (typeof WHISPER_SIZES)[number];

export type WhisperDevice = 'cuda' | 'cpu';
export type WhisperCompute = 'float16' | 'int8_float16' | 'int8';

export interface WhisperConfig {
  size: WhisperSize;
  device: WhisperDevice;
  compute: WhisperCompute;
}

/** 單一 LLM 模型的獨立參數。 */
export interface ModelProfile {
  temperature: number;
  num_ctx: number;
  /** 為 false 時呼叫 Ollama 傳 think:false；undefined 表示不傳（需驗證）。 */
  think?: boolean;
}

/** 人設卡。 */
export interface Persona {
  name: string;
  userTitle: string;
  traits: string;
  speech: string;
  taboos: string;
}

/** GPU / VRAM 快照。 */
export interface GpuStats {
  /** 總 VRAM (MiB)。無 N 卡時為 null。 */
  vramTotalMiB: number | null;
  /** 已用 VRAM (MiB)。 */
  vramUsedMiB: number | null;
  /** Ollama 目前載入模型佔用估計 (MiB)，來自 GET /api/ps。 */
  ollamaLoadedMiB: number | null;
  hasNvidia: boolean;
  sampledAt: number;
}

/** 互動手勢判定結果。 */
export type Gesture = 'click' | 'drag' | 'longpress';
export type HitPart = 'head' | 'body' | 'none';

/** 角色在場狀態（leave/return 狀態機用）。 */
export type PresenceState = 'present' | 'leaving' | 'absent' | 'returning';

/** FPS 模式（長期運行降載用）。 */
export type FpsMode = 'active' | 'idle' | 'occluded';
