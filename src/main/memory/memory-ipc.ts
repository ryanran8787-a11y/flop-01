import { ipcMain } from 'electron';
import type { SqliteMemory } from './store.js';

/** 記憶 CRUD（設定頁用；完整 UI 在階段 8）。 */
export function registerMemoryIpc(mem: () => SqliteMemory): void {
  ipcMain.handle('memory:list', (_e, payload: unknown) => {
    const p = payload as { limit?: number };
    return mem().listFacts(Math.min(Number(p?.limit ?? 200), 1000));
  });
  ipcMain.handle('memory:update', (_e, payload: unknown) => {
    const p = payload as { id?: number; fact?: string };
    if (typeof p?.id !== 'number' || typeof p?.fact !== 'string') throw new Error('bad args');
    return { ok: mem().updateFact(p.id, p.fact) };
  });
  ipcMain.handle('memory:delete', (_e, payload: unknown) => {
    const p = payload as { id?: number };
    if (typeof p?.id !== 'number') throw new Error('bad args');
    return { ok: mem().deleteFact(p.id) };
  });
  ipcMain.handle('memory:export', () => mem().exportAll());
}
