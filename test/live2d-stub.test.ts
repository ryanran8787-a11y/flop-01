import { describe, expect, it, vi } from 'vitest';
import { Live2DRendererStub, Live2DNotImplemented } from '../src/renderer/src/live2d/live2d-stub.js';
import type { IAvatarRenderer } from '../src/shared/providers.js';

describe('Live2D stub', () => {
  it('符合 IAvatarRenderer 形狀；loadModel 明確拋錯；其餘 no-op', async () => {
    const r: IAvatarRenderer = new Live2DRendererStub();
    expect(r.kind).toBe('live2d-stub');
    await expect(r.loadModel('x')).rejects.toBeInstanceOf(Live2DNotImplemented);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => {
      r.setEmotion('happy');
      r.playAction('nod');
      r.setLookAt(10, 5);
      r.setMouth('aa', 0.5);
      r.setThinking(true);
      r.dispose();
    }).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1); // 只警告一次
    warn.mockRestore();
  });
});
