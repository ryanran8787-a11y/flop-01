import type { Action, Emotion, HitPart } from '../../../shared/types.js';
import type { GestureEvent } from './gestures.js';
import type { RadialItemId, RadialMenu } from './radial-menu.js';

/**
 * 互動編排（DOM 監聽由 bootstrap 掛載，這裡只收 GestureEvent → 可單元測試）。
 * - click 頭 → happy + head_pat_react；click 身體 → poke（輕微反應）
 * - dragmove → win:dragMove；dragstart 關選單
 * - longpress → 環形選單（leave 期間不開）
 * - leave 期間（!canInteract）：click/longpress/drag 一律忽略
 */
export interface AvatarPort {
  canInteract: boolean;
  playAction: (a: Action) => void;
  setEmotion: (e: Emotion) => void;
  poke: () => void;
}

export interface InteractionCallbacks {
  sendDrag: (dx: number, dy: number) => void;
  probeHit: (x: number, y: number) => HitPart;
  menu: RadialMenu;
  muted: () => boolean;
  onMenuOpened?: () => void;
  onOutfit: () => void;
  onSettings: () => void;
  onToggleMute: () => void;
  onLeave: () => void;
}

export class InteractionController {
  constructor(
    private avatar: AvatarPort,
    private cb: InteractionCallbacks,
  ) {}

  onGesture(g: GestureEvent): void {
    switch (g.type) {
      case 'click': {
        if (!this.avatar.canInteract) return;
        const part = this.cb.probeHit(g.x, g.y);
        if (part === 'head') {
          this.avatar.setEmotion('happy');
          this.avatar.playAction('head_pat_react');
        } else if (part === 'body') {
          this.avatar.poke();
        }
        break;
      }
      case 'dragstart': {
        this.cb.menu.close();
        break;
      }
      case 'dragmove': {
        if (!this.avatar.canInteract) return;
        this.cb.sendDrag(g.dx, g.dy);
        break;
      }
      case 'dragend': {
        break;
      }
      case 'longpress': {
        if (!this.avatar.canInteract) return;
        this.cb.menu.open(g.x, g.y, this.cb.muted());
        this.cb.onMenuOpened?.();
        break;
      }
    }
  }

  onMenuSelect(id: RadialItemId): void {
    if (id === 'outfit') this.cb.onOutfit();
    else if (id === 'settings') this.cb.onSettings();
    else if (id === 'mute') this.cb.onToggleMute();
    else this.cb.onLeave();
  }
}
