import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePreloadPath } from '../src/main/preload-path.js';

describe('resolvePreloadPath', () => {
  it('優先 index.cjs，其次 mjs/js，缺檔回 cjs 預設', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pre-'));
    mkdirSync(join(dir, 'main'), { recursive: true });
    mkdirSync(join(dir, 'preload'), { recursive: true });
    const from = join(dir, 'main');
    expect(resolvePreloadPath(from)).toBe(join(dir, 'preload', 'index.cjs'));
    writeFileSync(join(dir, 'preload', 'index.js'), 'x');
    expect(resolvePreloadPath(from)).toBe(join(dir, 'preload', 'index.js'));
    writeFileSync(join(dir, 'preload', 'index.mjs'), 'x');
    expect(resolvePreloadPath(from)).toBe(join(dir, 'preload', 'index.mjs'));
    writeFileSync(join(dir, 'preload', 'index.cjs'), 'x');
    expect(resolvePreloadPath(from)).toBe(join(dir, 'preload', 'index.cjs'));
  });
});
