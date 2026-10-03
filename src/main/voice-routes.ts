import type { SideToMain } from '../shared/protocol.js';

/**
 * sidecar WS 訊息 → renderer IPC 轉發表（純函數，無 Electron 依賴）。
 * 對話編排（LLM 逐句）在階段 7。
 */
export function forwardTarget(msg: SideToMain): { channel: string; data: unknown } | null {
  switch (msg.t) {
    case 'tts.file':
      return { channel: 'tts:file', data: { id: msg.id, path: msg.path } };
    case 'tts.error':
      return { channel: 'tts:error', data: { id: msg.id, code: msg.code, message: msg.message } };
    case 'tts.end':
      return { channel: 'tts:cancel', data: { id: msg.id, reason: msg.reason } };
    case 'stt.final':
      return { channel: 'stt:final', data: { text: msg.text, at: msg.at } };
    case 'stt.interim':
      return { channel: 'stt:interim', data: { text: msg.text, at: msg.at } };
    case 'stt.error':
      return { channel: 'stt:error', data: { code: msg.code, message: msg.message } };
    case 'stt.bargein':
      return { channel: 'stt:bargein', data: { at: msg.at } };
    case 'whisper.progress':
      return { channel: 'whisper:progress', data: msg };
    case 'whisper.ready':
      return { channel: 'whisper:ready', data: msg };
    case 'whisper.error':
      return { channel: 'whisper:error', data: msg };
    case 'gpu.stats':
      return { channel: 'gpu:stats', data: msg };
    default:
      return null;
  }
}
