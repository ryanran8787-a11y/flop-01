/**
 * IPC 白名單通道表（Electron main <-> renderer）。
 * preload 只暴露這裡列出的通道，其餘一律拒絕。
 * 命名：<域>:<動作>。方向標註供 preload  Gate 用。
 */
export const IPC_CHANNELS = [
  // window
  'win:dragMove',
  'win:hitTest',
  'win:setIgnoreMouse',
  'win:showSettings',
  // avatar / interaction（renderer -> main 轉播，或 main -> renderer 下發）
  'avatar:emotion',
  'avatar:action',
  'avatar:presence',
  'avatar:thinking',
  'ui:notify',
  'cursor:pos',
  'interaction:gesture',
  // 對話管線
  'stt:start',
  'stt:stop',
  'stt:final',
  'stt:interim',
  'stt:error',
  'stt:bargein',
  'tts:speak',
  'tts:cancel',
  'tts:file',
  'tts:error',
  'tts:notify',
  // 模型 / 資源
  'llm:switch',
  'llm:listModels',
  'gpu:stats',
  'whisper:reload',
  'whisper:cancelDownload',
  'whisper:progress',
  'whisper:ready',
  'whisper:error',
  'sidecar:status',
  // config / memory
  'config:get',
  'config:set',
  'config:onChanged',
  'memory:list',
  'memory:update',
  'memory:delete',
  'memory:export',
  'vrm:browse',
  'system:stats',
] as const;

export type IpcChannel = (typeof IPC_CHANNELS)[number];

/** 通道方向：r2m / m2r / both。preload 據此限制 invoke/send/on。 */
export const IPC_DIRECTION: Record<IpcChannel, 'r2m' | 'm2r' | 'both'> = {
  'win:dragMove': 'r2m',
  'win:hitTest': 'both',
  'win:setIgnoreMouse': 'm2r',
  'win:showSettings': 'both',
  'avatar:emotion': 'both',
  'avatar:action': 'both',
  'avatar:presence': 'both',
  'avatar:thinking': 'both',
  'ui:notify': 'm2r',
  'cursor:pos': 'm2r',
  'interaction:gesture': 'r2m',
  'stt:start': 'r2m',
  'stt:stop': 'r2m',
  'stt:final': 'm2r',
  'stt:interim': 'm2r',
  'stt:error': 'm2r',
  'stt:bargein': 'm2r',
  'tts:speak': 'both',
  'tts:cancel': 'both',
  'tts:file': 'm2r',
  'tts:error': 'm2r',
  'tts:notify': 'r2m',
  'llm:switch': 'both',
  'llm:listModels': 'both',
  'gpu:stats': 'm2r',
  'whisper:reload': 'both',
  'whisper:cancelDownload': 'both',
  'whisper:progress': 'm2r',
  'whisper:ready': 'm2r',
  'whisper:error': 'm2r',
  'sidecar:status': 'm2r',
  'config:get': 'both',
  'config:set': 'both',
  'config:onChanged': 'm2r',
  'memory:list': 'both',
  'memory:update': 'both',
  'memory:delete': 'both',
  'memory:export': 'both',
  'vrm:browse': 'both',
  'system:stats': 'both',
};

export function isAllowedChannel(ch: string): ch is IpcChannel {
  return (IPC_CHANNELS as readonly string[]).includes(ch);
}
