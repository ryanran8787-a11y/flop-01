import { ipcMain } from 'electron';
import type { SidecarManager } from './sidecar.js';
import type { OllamaClient } from './ollama.js';
import { collectStats } from './stats-core.js';

export function registerStatsIpc(getter: () => { sidecar: SidecarManager | null; ollama: OllamaClient | null }): void {
  ipcMain.handle('system:stats', () => collectStats(getter()));
}
