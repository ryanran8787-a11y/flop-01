import { describe, expect, it } from 'vitest';
import { applyDrag, clampWindowPos } from '../src/main/window-bounds.js';

const AREA = { x: 0, y: 0, width: 1920, height: 1040 };
const WIN = { width: 420, height: 560 };

describe('clampWindowPos', () => {
  it('範圍內不動', () => {
    expect(clampWindowPos(100, 100, WIN, AREA)).toEqual({ x: 100, y: 100 });
  });

  it('右下角夾住', () => {
    expect(clampWindowPos(9999, 9999, WIN, AREA)).toEqual({ x: 1500, y: 480 });
  });

  it('左上角夾住', () => {
    expect(clampWindowPos(-50, -30, WIN, AREA)).toEqual({ x: 0, y: 0 });
  });

  it('多螢幕負座標工作區', () => {
    const left = { x: -1920, y: 0, width: 1920, height: 1040 };
    expect(clampWindowPos(-9999, 100, WIN, left)).toEqual({ x: -1920, y: 100 });
  });

  it('視窗比工作區大時貼齊左上', () => {
    const big = { width: 3000, height: 2000 };
    expect(clampWindowPos(100, 100, big, AREA)).toEqual({ x: 0, y: 0 });
  });
});

describe('applyDrag', () => {
  it('增量移動後夾取', () => {
    expect(applyDrag({ x: 100, y: 100 }, WIN, 10, -20, AREA)).toEqual({ x: 110, y: 80 });
    expect(applyDrag({ x: 1490, y: 100 }, WIN, 50, 0, AREA)).toEqual({ x: 1500, y: 100 });
  });
});
