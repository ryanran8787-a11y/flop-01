import { describe, expect, it } from 'vitest';
import { AppConfigSchema } from '../src/shared/config-schema.js';
import { IPC_CHANNELS, IPC_DIRECTION, isAllowedChannel } from '../src/shared/ipc-channels.js';

describe('AppConfig schema', () => {
  it('空物件可套用全部預設', () => {
    const c = AppConfigSchema.parse({});
    expect(c.ollamaUrl).toBe('http://127.0.0.1:11434');
    expect(c.ttsVoice).toBe('zh-TW-HsiaoChenNeural');
    expect(c.whisper.size).toBe('small');
    expect(c.whisper.device).toBe('cuda');
    expect(c.persona.name).toBe('小晴');
    expect(c.fpsCap).toBe(60);
  });

  it('非法 ollamaUrl 被拒', () => {
    expect(() => AppConfigSchema.parse({ ollamaUrl: 'not-a-url' })).toThrow();
  });

  it('fpsCap 超界被拒', () => {
    expect(() => AppConfigSchema.parse({ fpsCap: 999 })).toThrow();
  });

  it('modelProfiles 可存獨立參數', () => {
    const c = AppConfigSchema.parse({
      modelProfiles: { 'qwen3:8b': { temperature: 0.5, num_ctx: 4096 } },
    });
    expect(c.modelProfiles['qwen3:8b']?.temperature).toBe(0.5);
  });

  it('whisper large-v3-turbo 可選', () => {
    const c = AppConfigSchema.parse({ whisper: { size: 'large-v3-turbo', device: 'cuda', compute: 'float16' } });
    expect(c.whisper.size).toBe('large-v3-turbo');
  });
});

describe('IPC 白名單', () => {
  it('每一個 channel 都有方向標註', () => {
    for (const ch of IPC_CHANNELS) {
      expect(IPC_DIRECTION[ch]).toBeDefined();
    }
  });

  it('未列入通道拒絕', () => {
    expect(isAllowedChannel('os:rmRf')).toBe(false);
    expect(isAllowedChannel('win:dragMove')).toBe(true);
  });
});
