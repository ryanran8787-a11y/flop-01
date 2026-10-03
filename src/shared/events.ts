import type {
  Action,
  Emotion,
  FpsMode,
  Gesture,
  GpuStats,
  HitPart,
  MouthViseme,
  PresenceState,
  STTMode,
} from './types.js';

/**
 * 全域型別化事件表。
 * key = 事件名，value = payload 型別。
 * 所有模組（main / renderer / sidecar 代理）只透過此表溝通。
 * 用 type（不用 interface）以相容 EventBus 的 Record 約束。
 */
export type AppEventMap = {
  // --- 對話管線 ---
  'stt.final': { text: string; at: number };
  'stt.bargein': { at: number };
  'stt.interim': { text: string; at: number };
  'stt.error': { code: STTErrorCode; message: string };
  'llm.sentence': { index: number; text: string; done: boolean };
  'llm.done': { emotion: Emotion; action?: Action; replyFull: string };
  'llm.error': { code: LLMErrorCode; message: string };
  'tts.start': { sentences: number };
  'tts.file': { id: string; path: string };
  'tts.end': { reason: 'finished' | 'cancelled' | 'failed' };
  'tts.error': { code: TTSErrorCode; message: string };

  // --- Avatar ---
  'avatar.emotion': { emotion: Emotion };
  'avatar.action': { action: Action };
  'avatar.presence': { state: PresenceState };
  'avatar.mouth': { viseme: MouthViseme; weight: number };
  'avatar.lookat': { yawDeg: number; pitchDeg: number };
  'avatar.thinking': { on: boolean };
  'avatar.speak': { speaking: boolean };

  // --- 互動 ---
  'interaction.gesture': { gesture: Gesture; x: number; y: number; part: HitPart };
  'interaction.headpat': { x: number; y: number };
  'interaction.menu': { open: boolean };
  'window.drag': { dx: number; dy: number };
  /**
   * 游標位置（視窗左上為原點的 CSS px，main 已扣掉視窗 screen 座標）。
   * renderer 不得當作 screen 座標用。
   */
  'cursor.pos': { x: number; y: number; at: number };

  // --- 模型 / 資源 ---
  'model.switch': { model: string };
  'model.switched': { model: string };
  'model.error': { code: ModelErrorCode; message: string };
  'whisper.reload': { size: string; device: string; compute: string };
  'whisper.progress': { pct: number; bytes?: number };
  'whisper.ready': { size: string; device: string; compute: string };
  'gpu.stats': GpuStats;

  // --- 系統 ---
  'config.changed': { keys: string[] };
  'sidecar.status': { online: boolean; restarts: number };
  'fps.mode': { mode: FpsMode };
};

export type AppEventName = keyof AppEventMap;

export type STTErrorCode =
  | 'mic-denied'
  | 'model-missing'
  | 'model-load-failed'
  | 'sidecar-offline';

export type TTSErrorCode = 'offline' | 'voice-missing' | 'sidecar-offline' | 'cancelled';

export type LLMErrorCode =
  | 'ollama-offline'
  | 'model-missing'
  | 'model-load-failed'
  | 'schema-mismatch'
  | 'vram-short';

export type ModelErrorCode =
  | 'ollama-offline'
  | 'model-missing'
  | 'schema-mismatch'
  | 'load-failed';

/** STT 模式切換（push-to-talk / 持續監聽+VAD）。 */
export interface STTModePayload {
  mode: STTMode;
}
