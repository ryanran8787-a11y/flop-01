import { describe, expect, it } from 'vitest';
import { FrameGate, targetFps } from '../src/renderer/src/avatar/fps.js';
import {
  BLINK_CANDIDATES,
  EMOTION_PRESET_CANDIDATES,
  MOUTH_PRESET_CANDIDATES,
  isMouthPreset,
  resolvePreset,
} from '../src/renderer/src/avatar/expression-map.js';
import { PresenceMachine } from '../src/renderer/src/avatar/presence.js';

describe('targetFps / FrameGate', () => {
  it('active 受 cap 限，idle 30，occluded 可暫停', () => {
    expect(targetFps('active', 60, false)).toBe(60);
    expect(targetFps('active', 120, false)).toBe(60);
    expect(targetFps('idle', 60, false)).toBe(30);
    expect(targetFps('occluded', 60, true)).toBe(0);
    expect(targetFps('occluded', 60, false)).toBe(10);
  });

  it('FrameGate 依 fps 跳幀', () => {
    const g = new FrameGate();
    expect(g.shouldRender(0, 30)).toBe(true);
    expect(g.shouldRender(10, 30)).toBe(false);
    expect(g.shouldRender(40, 30)).toBe(true);
    expect(g.shouldRender(1000, 0)).toBe(false);
  });
});

describe('expression-map', () => {
  it('VRM1.0 優先', () => {
    expect(resolvePreset(new Set(['happy', 'joy']), EMOTION_PRESET_CANDIDATES.happy)).toBe('happy');
  });

  it('0.x 回退', () => {
    expect(resolvePreset(new Set(['joy']), EMOTION_PRESET_CANDIDATES.happy)).toBe('joy');
    expect(resolvePreset(new Set(['a']), MOUTH_PRESET_CANDIDATES.aa)).toBe('a');
  });

  it('大小寫不敏感且保留原 key', () => {
    expect(resolvePreset(new Set(['Blink_L']), BLINK_CANDIDATES)).toBe('Blink_L');
  });

  it('全無回 null；口型名被識別為嘴部獨佔', () => {
    expect(resolvePreset(new Set(['happy']), EMOTION_PRESET_CANDIDATES.surprised)).toBeNull();
    expect(isMouthPreset('aa')).toBe(true);
    expect(isMouthPreset('A')).toBe(true);
    expect(isMouthPreset('happy')).toBe(false);
  });
});

describe('PresenceMachine', () => {
  it('present→leaving→absent→returning→present', () => {
    const m = new PresenceMachine();
    expect(m.canInteract).toBe(true);
    expect(m.dispatchAction('leave')).toBe(true);
    expect(m.canInteract).toBe(false);
    expect(m.dispatchAction('leave')).toBe(false); // 冪等
    m.notifyAnimationDone('leave');
    expect(m.current).toBe('absent');
    expect(m.dispatchAction('return')).toBe(true);
    m.notifyAnimationDone('return');
    expect(m.current).toBe('present');
  });

  it('一般動作不影響狀態', () => {
    const m = new PresenceMachine();
    expect(m.dispatchAction('nod')).toBe(false);
    expect(m.current).toBe('present');
  });
});
