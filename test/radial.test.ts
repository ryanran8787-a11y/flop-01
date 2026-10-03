// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { RadialMenu, radialLayout, type RadialItemId } from '../src/renderer/src/interaction/radial-menu.js';

describe('radialLayout', () => {
  it('四等分在圓上', () => {
    const pts = radialLayout(4, 100);
    expect(pts.length).toBe(4);
    for (const p of pts) {
      expect(Math.hypot(p.x ?? 0, p.y ?? 0)).toBeCloseTo(100);
    }
  });
});

describe('RadialMenu', () => {
  it('open 建四鈕；click 回調 id 並關閉', () => {
    const selected: RadialItemId[] = [];
    const menu = new RadialMenu(document, (id) => selected.push(id));
    menu.open(200, 150, false);
    expect(menu.isOpen).toBe(true);
    const btns = document.querySelectorAll('[data-item]');
    expect(btns.length).toBe(4);
    expect(document.querySelector('[data-item="mute"]')?.textContent).toBe('靜音');
    (document.querySelector('[data-item="leave"]') as HTMLButtonElement).click();
    expect(selected).toEqual(['leave']);
    expect(menu.isOpen).toBe(false);
  });

  it('靜音標籤隨狀態切換；重複 open 不殘留', () => {
    const menu = new RadialMenu(document, () => {});
    menu.open(0, 0, true);
    expect(document.querySelector('[data-item="mute"]')?.textContent).toBe('取消靜音');
    menu.open(10, 10, false);
    expect(document.querySelectorAll('[data-radial="menu"]').length).toBe(1);
    menu.close();
    expect(menu.isOpen).toBe(false);
    expect(document.querySelectorAll('[data-radial="menu"]').length).toBe(0);
  });
});
