import { describe, expect, it } from 'vitest';
import { forwardTarget } from '../src/main/voice-routes.js';

describe('forwardTarget', () => {
  it('tts.file/stt/whisper/gpu 轉發到對應 IPC', () => {
    expect(forwardTarget({ t: 'tts.file', id: 'a', path: '/x.mp3' })).toEqual({
      channel: 'tts:file',
      data: { id: 'a', path: '/x.mp3' },
    });
    expect(forwardTarget({ t: 'stt.final', text: '嗨', at: 1 })).toEqual({
      channel: 'stt:final',
      data: { text: '嗨', at: 1 },
    });
    expect(forwardTarget({ t: 'stt.bargein', at: 2 })).toEqual({
      channel: 'stt:bargein',
      data: { at: 2 },
    });
    expect(
      forwardTarget({ t: 'whisper.progress', pct: 10 }),
    ).toEqual({ channel: 'whisper:progress', data: { t: 'whisper.progress', pct: 10 } });
    expect(
      forwardTarget({ t: 'gpu.stats', vramTotalMiB: 1, vramUsedMiB: 2, hasNvidia: true, at: 3 }),
    )?.toMatchObject({ channel: 'gpu:stats' });
  });

  it('ready/pong 不轉發', () => {
    expect(forwardTarget({ t: 'ready', version: 'x' })).toBeNull();
    expect(forwardTarget({ t: 'pong', at: 1 })).toBeNull();
  });
});
