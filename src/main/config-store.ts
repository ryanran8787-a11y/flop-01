import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { AppConfigSchema, type AppConfig } from '../shared/config-schema.js';

/**
 * 極簡 config 存取（main 用）。完整設定 UI 與熱更新在階段 8。
 * - 損毀檔案 → 改名 .bak，退回預設（不直接報錯崩潰）
 * - 寫入前以 zod 驗證
 */
export function getConfigPath(userDataDir: string): string {
  return `${userDataDir}/config.json`;
}

export function loadConfigFromFile(path: string): AppConfig {
  try {
    const raw = readFileSync(path, 'utf-8');
    const json: unknown = JSON.parse(raw);
    return AppConfigSchema.parse(json);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return AppConfigSchema.parse({});
    }
    try {
      renameSync(path, `${path}.bak-${Date.now()}`);
    } catch {
      // 備份失敗也繼續用預設
    }
    return AppConfigSchema.parse({});
  }
}

export function writeConfigToFile(path: string, cfg: AppConfig): void {
  const parsed = AppConfigSchema.parse(cfg);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(parsed, null, 2), 'utf-8');
}

/** 局部更新 patch 型別（whisper/hotkeys/window 允許深層局部）。 */
export type ConfigPatch = Partial<Omit<AppConfig, 'whisper' | 'hotkeys' | 'window'>> & {
  whisper?: Partial<AppConfig['whisper']>;
  hotkeys?: Partial<AppConfig['hotkeys']>;
  window?: Partial<AppConfig['window']>;
};

/** 局部更新：讀 → 合併（淺層 + whisper/hotkeys/window 一層深層）→ 驗證 → 寫回。 */
export function patchConfigFile(path: string, patch: ConfigPatch): AppConfig {
  const cur = loadConfigFromFile(path);
  const merged = {
    ...cur,
    ...patch,
    whisper: { ...cur.whisper, ...(patch.whisper ?? {}) },
    hotkeys: { ...cur.hotkeys, ...(patch.hotkeys ?? {}) },
    window: { ...cur.window, ...(patch.window ?? {}) },
  };
  const parsed = AppConfigSchema.parse(merged);
  writeConfigToFile(path, parsed);
  return parsed;
}
