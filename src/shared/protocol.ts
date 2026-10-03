/**
 * Main <-> Python sidecar WebSocket 協定（本機 127.0.0.1 + 啟動 token）。
 * 傳輸為 JSON 文本；音訊 chunk 另以二進位幀或 base64（階段 5 定案，這裡先定義 JSON 控制面）。
 */

export const SIDECAR_WS_HOST = '127.0.0.1';

export interface SidecarAuth {
  token: string;
}

/** main -> side */
export type MainToSide =
  | { t: 'auth'; token: string }
  | { t: 'stt.start'; mode: 'ptt' | 'vad' }
  | { t: 'stt.stop' }
  | { t: 'tts.speak'; id: string; text: string; voice: string }
  | { t: 'tts.cancel'; id?: string }
  | { t: 'tts.notify'; playing: boolean }
  | { t: 'whisper.reload'; size: string; device: string; compute: string }
  | { t: 'whisper.cancelDownload' }
  | { t: 'gpu.stats' }
  | { t: 'ping'; at: number };

/** side -> main */
export type SideToMain =
  | { t: 'ready'; version: string }
  | { t: 'stt.interim'; text: string; at: number }
  | { t: 'stt.final'; text: string; at: number }
  | { t: 'stt.bargein'; at: number }
  | { t: 'stt.error'; code: string; message: string }
  | { t: 'tts.start'; id: string }
  | { t: 'tts.file'; id: string; path: string }
  | { t: 'tts.end'; id: string; reason: 'finished' | 'cancelled' | 'failed' }
  | { t: 'tts.error'; id: string; code: string; message: string }
  | { t: 'stt.state'; listening: boolean; mode: string }
  | { t: 'whisper.progress'; pct: number; bytes?: number }
  | { t: 'whisper.ready'; size: string; device: string; compute: string }
  | { t: 'whisper.error'; code: string; message: string }
  | { t: 'gpu.stats'; vramTotalMiB: number | null; vramUsedMiB: number | null; hasNvidia: boolean; at: number }
  | { t: 'pong'; at: number }
  | { t: 'error'; code: string; message: string };

export type SidecarMessage = MainToSide | SideToMain;

/** 需驗證：二進位音訊幀格式（PCM16/22050/mono）於階段 5 與 pcm 播放器一起凍結。 */
export const SIDECAR_AUDIO_PLACEHOLDER = 'pcm16-22050-mono (需驗證，階段5凍結)' as const;
