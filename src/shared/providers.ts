import type { Action, Emotion, MouthViseme, STTMode } from './types.js';

/**
 * Provider 介面：實作可替換，模組只依賴介面。
 * Renderer / main / sidecar 代理各自實作其一，彼此不 import 實作。
 */

export interface TTSRequest {
  id: string;
  text: string;
  voice: string;
}

export interface TTSProvider {
  readonly name: string;
  speak(req: TTSRequest): Promise<void>;
  cancel(id?: string): Promise<void>;
  setVoice(voice: string): void;
}

export interface STTProvider {
  readonly name: string;
  start(mode: STTMode): Promise<void>;
  stop(): Promise<void>;
  readonly listening: boolean;
}

export interface ChatSentence {
  index: number;
  text: string;
  done: boolean;
}

export interface ChatReq {
  model: string;
  system: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  temperature: number;
  num_ctx: number;
  think?: boolean;
  onSentence: (s: ChatSentence) => void;
}

export interface LLMProvider {
  readonly name: string;
  chatStream(req: ChatReq): Promise<{ emotion: Emotion; action?: Action; replyFull: string }>;
  listModels(): Promise<string[]>;
  switchModel(model: string): Promise<void>;
  readonly currentModel: string;
}

/** 虛擬形象渲染器。VRM 實作於階段 3；Live2D 只做 stub（階段 8）。 */
export interface IAvatarRenderer {
  readonly kind: 'vrm' | 'live2d-stub';
  loadModel(pathOrUrl: string): Promise<void>;
  setEmotion(e: Emotion): void;
  playAction(a: Action): void;
  setLookAt(yawDeg: number, pitchDeg: number): void;
  setMouth(viseme: MouthViseme, weight: number): void;
  setThinking(on: boolean): void;
  dispose(): void;
}

/** Whisper 熱切換管理器（main 經 WS 代理呼叫 sidecar）。 */
export interface WhisperManager {
  reload(cfg: { size: string; device: string; compute: string }): Promise<void>;
  cancelDownload(): Promise<void>;
}

/** 長期記憶存取（main 實作 SQLite，renderer 經 IPC）。 */
export interface MemoryStore {
  append(role: 'user' | 'assistant', text: string): Promise<void>;
  recent(n: number): Promise<Array<{ role: string; text: string; at: number }>>;
  search(query: string, k: number): Promise<Array<{ fact: string; score: number }>>;
}
