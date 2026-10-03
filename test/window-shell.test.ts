import { describe, expect, it, vi } from 'vitest';
import { HitTestState } from '../src/main/hit-test.js';
import { startCursorPoll } from '../src/main/cursor-poller.js';
import { ensureSingleInstance } from '../src/main/single-instance.js';
import { buildCsp } from '../src/main/csp.js';
import { buildTrayMenu } from '../src/main/tray-menu.js';

describe('HitTestState', () => {
  it('預設穿透', () => {
    expect(new HitTestState().ignoringMouse).toBe(true);
  });

  it('命中→接收事件，未翻轉回傳 false', () => {
    const s = new HitTestState();
    expect(s.setHit(true)).toBe(true);
    expect(s.ignoringMouse).toBe(false);
    expect(s.setHit(true)).toBe(false);
  });

  it('離開→恢復穿透', () => {
    const s = new HitTestState();
    s.setHit(true);
    expect(s.setHit(false)).toBe(true);
    expect(s.ignoringMouse).toBe(true);
  });
});

describe('startCursorPoll', () => {
  it('只在變化時送，hz 夾在 30–60', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    let p = { x: 1, y: 2 };
    const stop = startCursorPoll({ getCursorPoint: () => p, send }, 999);
    vi.advanceTimersByTime(5000);
    expect(send).toHaveBeenCalledTimes(1);
    p = { x: 3, y: 4 };
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledTimes(2);
    stop();
    vi.useRealTimers();
  });

  it('扣掉視窗原點後送視窗內相對座標', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const stop = startCursorPoll(
      { getCursorPoint: () => ({ x: 1500, y: 900 }), getOrigin: () => ({ x: 1400, y: 700 }), send },
      45,
    );
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledWith({ x: 100, y: 200, at: expect.any(Number) });
    stop();
    vi.useRealTimers();
  });
});

describe('ensureSingleInstance', () => {
  it('主實例註冊 second-instance 回呼', () => {
    const onSecondInstance = vi.fn();
    const quit = vi.fn();
    const cb = vi.fn();
    expect(
      ensureSingleInstance({ requestSingleInstanceLock: () => true, onSecondInstance, quit }, cb),
    ).toBe(true);
    expect(onSecondInstance).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();
  });

  it('第二實例退出', () => {
    const quit = vi.fn();
    expect(
      ensureSingleInstance(
        { requestSingleInstanceLock: () => false, onSecondInstance: vi.fn(), quit },
        vi.fn(),
      ),
    ).toBe(false);
    expect(quit).toHaveBeenCalledTimes(1);
  });
});

describe('buildCsp', () => {
  it('包含本機 Ollama 與 WS，且禁 object', () => {
    const csp = buildCsp('http://127.0.0.1:11434');
    expect(csp).toContain('ws://127.0.0.1:*');
    expect(csp).toContain('http://127.0.0.1:*');
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
  });
});

describe('buildTrayMenu', () => {
  it('顯示/隱藏文字隨狀態切換', () => {
    const cb = {
      onToggleShow: vi.fn(),
      onOpenSettings: vi.fn(),
      onToggleMute: vi.fn(),
      onLeave: vi.fn(),
      onQuit: vi.fn(),
    };
    const shown = buildTrayMenu(cb, { visible: true, muted: false });
    expect(shown[0]?.label).toBe('隱藏角色');
    const hidden = buildTrayMenu(cb, { visible: false, muted: true });
    expect(hidden[0]?.label).toBe('顯示角色');
    expect(hidden[3]?.label).toBe('取消靜音');
  });
});
