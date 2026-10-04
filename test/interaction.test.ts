import { describe, expect, it, vi } from 'vitest';
import { InteractionController, type AvatarPort, type InteractionCallbacks } from '../src/renderer/src/interaction/interaction.js';
import type { HitPart } from '../src/shared/types.js';
import { RadialMenu } from '../src/renderer/src/interaction/radial-menu.js';

function setup(part: HitPart = 'none', interact = true): {
  ctl: InteractionController;
  avatar: AvatarPort & { played: string[]; emotions: string[]; pokes: number };
  sent: Array<{ ch: string; data: unknown }>;
  menu: RadialMenu & { opened: Array<{ x: number; y: number }> };
  cb: InteractionCallbacks;
} {
  const avatar = {
    canInteract: interact,
    played: [] as string[],
    emotions: [] as string[],
    pokes: 0,
    playAction: (a: string) => {
      avatar.played.push(a);
    },
    setEmotion: (e: string) => {
      avatar.emotions.push(e);
    },
    poke: () => {
      avatar.pokes += 1;
    },
  };
  const sent: Array<{ ch: string; data: unknown }> = [];
  const opened: Array<{ x: number; y: number }> = [];
  const menu = {
    opened,
    isOpen: false,
    open: (x: number, y: number) => {
      opened.push({ x, y });
    },
    close: () => {},
  } as unknown as RadialMenu & { opened: Array<{ x: number; y: number }> };
  const cb: InteractionCallbacks = {
    sendDrag: (dx, dy) => sent.push({ ch: 'win:dragMove', data: { dx, dy } }),
    probeHit: () => part,
    menu,
    muted: () => false,
    onMenuOpened: vi.fn(),
    onOutfit: vi.fn(),
    onSettings: vi.fn(),
    onToggleMute: vi.fn(),
    onLeave: vi.fn(),
  };
  return { ctl: new InteractionController(avatar, cb), avatar, sent, menu, cb };
}

describe('InteractionController', () => {
  it('click 頭 → happy + head_pat_react', () => {
    const { ctl, avatar } = setup('head');
    ctl.onGesture({ type: 'click', x: 1, y: 2 });
    expect(avatar.emotions).toEqual(['happy']);
    expect(avatar.played).toEqual(['head_pat_react']);
  });

  it('click 身體 → poke（輕微反應，不動情緒）', () => {
    const { ctl, avatar } = setup('body');
    ctl.onGesture({ type: 'click', x: 1, y: 2 });
    expect(avatar.pokes).toBe(1);
    expect(avatar.played).toEqual([]);
    expect(avatar.emotions).toEqual([]);
  });

  it('click 空處 → 無動作', () => {
    const { ctl, avatar } = setup('none');
    ctl.onGesture({ type: 'click', x: 1, y: 2 });
    expect(avatar.pokes).toBe(0);
    expect(avatar.played).toEqual([]);
  });

  it('dragmove → win:dragMove；dragstart 關選單', () => {
    const { ctl, sent, menu } = setup('body');
    const close = vi.spyOn(menu, 'close');
    ctl.onGesture({ type: 'dragstart', x: 0, y: 0 });
    ctl.onGesture({ type: 'dragmove', x: 5, y: 6, dx: 5, dy: 6 });
    expect(close).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([{ ch: 'win:dragMove', data: { dx: 5, dy: 6 } }]);
  });

  it('longpress → 開選單並通知保持接收事件', () => {
    const { ctl, menu, cb } = setup('head');
    ctl.onGesture({ type: 'longpress', x: 9, y: 9 });
    expect(menu.opened).toEqual([{ x: 9, y: 9 }]);
    expect(cb.onMenuOpened).toHaveBeenCalledTimes(1);
  });

  it('leave 期間全忽略', () => {
    const locked = setup('head', false);
    locked.ctl.onGesture({ type: 'click', x: 1, y: 1 });
    locked.ctl.onGesture({ type: 'longpress', x: 1, y: 1 });
    locked.ctl.onGesture({ type: 'dragmove', x: 1, y: 1, dx: 3, dy: 3 });
    expect(locked.avatar.played).toEqual([]);
    expect(locked.avatar.pokes).toBe(0);
    expect(locked.menu.opened).toEqual([]);
    expect(locked.sent).toEqual([]);
  });

  it('選單分發', () => {
    const { ctl, cb } = setup();
    ctl.onMenuSelect('outfit');
    ctl.onMenuSelect('settings');
    ctl.onMenuSelect('mute');
    ctl.onMenuSelect('leave');
    expect(cb.onOutfit).toHaveBeenCalledTimes(1);
    expect(cb.onSettings).toHaveBeenCalledTimes(1);
    expect(cb.onToggleMute).toHaveBeenCalledTimes(1);
    expect(cb.onLeave).toHaveBeenCalledTimes(1);
  });
});
