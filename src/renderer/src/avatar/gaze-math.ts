/**
 * 視線數學（純函數）。平滑本體用 THREE.MathUtils.damp（renderer 端），
 * 這裡只放角度分配與夾取，方便單元測試。
 */

export const HEAD_YAW_MAX_DEG = 35;
export const HEAD_PITCH_MAX_DEG = 20;

/** 頭/頸/眼的 yaw/pitch 權重（總和不需為 1，各自相對頭部目標）。 */
export interface GazeWeights {
  head: number;
  neck: number;
  eyes: number;
}

export const DEFAULT_GAZE_WEIGHTS: GazeWeights = {
  head: 0.55,
  neck: 0.3,
  eyes: 0.35,
};

/** 眼睛自身夾角（度），避免翻白眼。 */
export const EYE_YAW_MAX_DEG = 15;
export const EYE_PITCH_MAX_DEG = 10;

export interface LookAngles {
  yawDeg: number;
  pitchDeg: number;
}

export interface PartAngles extends LookAngles {}

/**
 * 螢幕游標 → 相對角色的 yaw/pitch（度）。
 * @param cursor 畫面游標（CSS px，相對於視窗左上）
 * @param viewport 視窗大小
 * @param charCenter 角色頭部在視窗中的大約位置（0–1），預設中央偏上
 */
export function gazeTargetFromCursor(
  cursor: { x: number; y: number },
  viewport: { width: number; height: number },
  charCenter: { x: number; y: number } = { x: 0.5, y: 0.35 },
): LookAngles {
  const w = Math.max(viewport.width, 1);
  const h = Math.max(viewport.height, 1);
  const nx = (cursor.x / w - charCenter.x) * 2; // -1..1（左負右正）
  const ny = (cursor.y / h - charCenter.y) * 2; // -1..1（上負下正）
  return clampLookAngles({
    yawDeg: nx * HEAD_YAW_MAX_DEG,
    pitchDeg: ny * HEAD_PITCH_MAX_DEG,
  });
}

export function clampLookAngles(t: LookAngles): LookAngles {
  return {
    yawDeg: Math.max(-HEAD_YAW_MAX_DEG, Math.min(HEAD_YAW_MAX_DEG, t.yawDeg)),
    pitchDeg: Math.max(-HEAD_PITCH_MAX_DEG, Math.min(HEAD_PITCH_MAX_DEG, t.pitchDeg)),
  };
}

/** 依權重分配到頭/頸/眼（含各自夾取）。 */
export function distributeGaze(
  target: LookAngles,
  weights: GazeWeights = DEFAULT_GAZE_WEIGHTS,
): { head: PartAngles; neck: PartAngles; eyes: PartAngles } {
  const t = clampLookAngles(target);
  const clamp = (v: number, m: number): number => Math.max(-m, Math.min(m, v));
  return {
    head: { yawDeg: clamp(t.yawDeg * weights.head, HEAD_YAW_MAX_DEG), pitchDeg: clamp(t.pitchDeg * weights.head, HEAD_PITCH_MAX_DEG) },
    neck: { yawDeg: clamp(t.yawDeg * weights.neck, HEAD_YAW_MAX_DEG), pitchDeg: clamp(t.pitchDeg * weights.neck, HEAD_PITCH_MAX_DEG) },
    eyes: { yawDeg: clamp(t.yawDeg * weights.eyes, EYE_YAW_MAX_DEG), pitchDeg: clamp(t.pitchDeg * weights.eyes, EYE_PITCH_MAX_DEG) },
  };
}

/**
 * damp 收斂係數，與 THREE.MathUtils.damp(x, y, lambda, dt) 內部的
 * `1 - exp(-lambda * dt)` 一致。lambda 約 8–12（視線用 10）。
 */
export function dampFactor(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * dt);
}
