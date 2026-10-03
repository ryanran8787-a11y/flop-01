import { describe, expect, it } from 'vitest';
import { inQuietHours, shouldProactive } from '../src/main/proactive.js';

function at(h: number, m: number): Date {
  const d = new Date(2026, 9, 3, h, m, 0);
  return d;
}

describe('inQuietHours', () => {
  it('跨日时段', () => {
    expect(inQuietHours(at(0, 30), '23:00-08:00')).toBe(true);
    expect(inQuietHours(at(23, 30), '23:00-08:00')).toBe(true);
    expect(inQuietHours(at(12, 0), '23:00-08:00')).toBe(false);
    expect(inQuietHours(at(8, 0), '23:00-08:00')).toBe(false);
  });

  it('日間時段', () => {
    expect(inQuietHours(at(13, 0), '12:00-14:00')).toBe(true);
    expect(inQuietHours(at(15, 0), '12:00-14:00')).toBe(false);
  });
});

describe('shouldProactive', () => {
  const base = {
    quietHours: '23:00-08:00',
    disturbEnabled: true,
    canProactive: true,
  };
  it('閒置不足/太頻繁/勿擾擋下', () => {
    const now = at(15, 0);
    expect(shouldProactive({ ...base, now, lastUserAt: now.getTime() - 5 * 60000, lastProactiveAt: null })).toBe(false);
    expect(shouldProactive({ ...base, now, lastUserAt: now.getTime() - 60 * 60000, lastProactiveAt: now.getTime() - 10 * 60000 })).toBe(false);
    expect(shouldProactive({ ...base, now: at(1, 0), lastUserAt: null, lastProactiveAt: null })).toBe(false);
  });

  it('條件齊放行；勿擾關閉則半夜也行', () => {
    const now = at(15, 0);
    expect(shouldProactive({ ...base, now, lastUserAt: now.getTime() - 60 * 60000, lastProactiveAt: null })).toBe(true);
    expect(shouldProactive({ ...base, disturbEnabled: false, now: at(1, 0), lastUserAt: null, lastProactiveAt: null })).toBe(true);
    expect(shouldProactive({ ...base, canProactive: false, now, lastUserAt: null, lastProactiveAt: null })).toBe(false);
  });
});
