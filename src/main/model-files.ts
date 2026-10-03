import { dialog, ipcMain } from 'electron';
import { importVrmFile } from './model-store.js';

export function registerModelIpc(getUserData: () => string): void {
  ipcMain.handle('vrm:browse', async () => {
    const r = await dialog.showOpenDialog({
      title: '選擇 VRM 模型',
      filters: [{ name: 'VRM/GLB', extensions: ['vrm', 'glb'] }],
      properties: ['openFile'],
    });
    if (r.canceled || r.filePaths.length === 0) return { ok: false as const };
    const src = r.filePaths[0];
    if (src === undefined) return { ok: false as const };
    const imported = importVrmFile(src, getUserData());
    return { ok: true as const, ...imported };
  });
}
