import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfigFromFile, patchConfigFile, writeConfigToFile } from '../src/main/config-store.js';
import { AppConfigSchema } from '../src/shared/config-schema.js';

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'companion-cfg-'));
}

describe('config-store', () => {
  it('缺檔回預設', () => {
    const c = loadConfigFromFile(join(freshDir(), 'config.json'));
    expect(c.ttsVoice).toBe('zh-TW-HsiaoChenNeural');
  });

  it('損毀檔備份並回預設', () => {
    const dir = freshDir();
    const p = join(dir, 'config.json');
    writeFileSync(p, '{broken', 'utf-8');
    const c = loadConfigFromFile(p);
    expect(c.fpsCap).toBe(60);
  });

  it('寫入 + 局部 patch（whisper 深層合併）', () => {
    const dir = freshDir();
    const p = join(dir, 'config.json');
    writeConfigToFile(p, AppConfigSchema.parse({}));
    const next = patchConfigFile(p, { whisper: { size: 'large-v3-turbo' } });
    expect(next.whisper.size).toBe('large-v3-turbo');
    expect(next.whisper.device).toBe('cuda');
    expect(loadConfigFromFile(p).whisper.size).toBe('large-v3-turbo');
  });
});
