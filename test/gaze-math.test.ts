import { describe, expect, it } from 'vitest';
import {
  EYE_PITCH_MAX_DEG,
  EYE_YAW_MAX_DEG,
  HEAD_PITCH_MAX_DEG,
  HEAD_YAW_MAX_DEG,
  clampLookAngles,
  dampFactor,
  distributeGaze,
  gazeTargetFromCursor,
} from '../src/renderer/src/avatar/gaze-math.js';

describe('gazeTargetFromCursor', () => {
  it('中央偏上無偏轉', () => {
    const t = gazeTargetFromCursor({ x: 210, y: 196 }, { width: 420, height: 560 });
    expect(t.yawDeg).toBeCloseTo(0);
    expect(t.pitchDeg).toBeCloseTo(0);
  });

  it('最右 = 最大 yaw，最下 = 最大 pitch', () => {
    const t = gazeTargetFromCursor({ x: 420, y: 560 }, { width: 420, height: 560 });
    expect(t.yawDeg).toBeCloseTo(HEAD_YAW_MAX_DEG);
    expect(t.pitchDeg).toBeLessThanOrEqual(HEAD_PITCH_MAX_DEG + 1e-9);
  });
});

describe('clampLookAngles / distributeGaze', () => {
  it('超界夾取', () => {
    expect(clampLookAngles({ yawDeg: 999, pitchDeg: -999 })).toEqual({
      yawDeg: HEAD_YAW_MAX_DEG,
      pitchDeg: -HEAD_PITCH_MAX_DEG,
    });
  });

  it('頭頸眼權重不同且眼部獨立夾取', () => {
    const d = distributeGaze({ yawDeg: 35, pitchDeg: 20 });
    expect(d.head.yawDeg).toBeLessThan(35);
    expect(d.neck.yawDeg).toBeLessThan(d.head.yawDeg);
    expect(Math.abs(d.eyes.yawDeg)).toBeLessThanOrEqual(EYE_YAW_MAX_DEG);
    expect(Math.abs(d.eyes.pitchDeg)).toBeLessThanOrEqual(EYE_PITCH_MAX_DEG);
  });
});

describe('dampFactor', () => {
  it('約等於 MathUtils.damp 內部係數且單調收斂', () => {
    const f = dampFactor(10, 0.016);
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(1);
    expect(dampFactor(10, 0.032)).toBeGreaterThan(f);
  });
});
