import { ipcMain } from 'electron';
import type { AppConfig } from '../shared/config-schema.js';
import type { OllamaLLM } from './llm/llm-provider.js';

/** llm:listModels / llm:switch（設定頁用；完整下拉 UI 在階段 8）。 */
export function registerLlmIpc(
  llm: () => OllamaLLM | null,
  getConfig: () => AppConfig,
  saveModel: (model: string) => void,
  thinking: (on: boolean) => void,
): void {
  ipcMain.handle('llm:listModels', async () => {
    const l = llm();
    if (l === null) return { models: [] as string[], current: getConfig().llmModel };
    try {
      return { models: await l.listModels(), current: l.currentModel };
    } catch (err) {
      return { models: [] as string[], current: getConfig().llmModel, error: (err as Error).message };
    }
  });
  ipcMain.handle('llm:switch', async (_e, payload: unknown) => {
    const p = payload as { model?: string };
    const l = llm();
    if (l === null || typeof p?.model !== 'string' || p.model.length === 0) {
      return { ok: false, error: 'bad args' };
    }
    try {
      await l.switchModel(p.model, thinking);
      saveModel(p.model);
      return { ok: true, model: p.model };
    } catch (err) {
      return { ok: false, error: (err as Error).message, model: l.currentModel };
    }
  });
}
