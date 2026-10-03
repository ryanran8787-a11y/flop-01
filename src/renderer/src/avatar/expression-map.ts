import type { Emotion, MouthViseme } from '../../../shared/types.js';

/**
 * 表情預設候選表（VRM 1.0 優先，VRM 0.x 回退）。
 * 1.0 預設：happy/angry/sad/relaxed/surprised/neutral + blink(+Left/Right) + aa/ih/ou/ee/oh
 * 0.x 命名：joy/angry/sorrow/fun + blink/blink_l/blink_r + a/i/u/e/o
 */
export const EMOTION_PRESET_CANDIDATES: Record<Emotion, string[]> = {
  idle: ['neutral', 'relaxed'],
  happy: ['happy', 'joy'],
  shy: ['relaxed', 'sad'],
  caring: ['relaxed', 'neutral'],
  annoyed: ['angry'],
  surprised: ['surprised', 'fun'],
};

/** 眨眼候選：1.0 先整體 blink，再左右 pair；0.x 用 blink_l/blink_r。 */
export const BLINK_CANDIDATES: string[] = ['blink', 'blinkLeft', 'blinkRight', 'blink_l', 'blink_r'];

/** 口型 viseme → 候選（含 0.x 單字母）。 */
export const MOUTH_PRESET_CANDIDATES: Record<Exclude<MouthViseme, 'closed'>, string[]> = {
  aa: ['aa', 'a'],
  ih: ['ih', 'i'],
  ou: ['ou', 'u'],
  ee: ['ee', 'e'],
  oh: ['oh', 'o'],
};

/** 口型獨佔的 preset 名集合（小寫比對）。表情層不得碰這些。 */
const MOUTH_PRESET_NAMES = new Set(
  Object.values(MOUTH_PRESET_CANDIDATES).flat().map((s) => s.toLowerCase()),
);

export function isMouthPreset(name: string): boolean {
  return MOUTH_PRESET_NAMES.has(name.toLowerCase());
}

/** 依可用集合選第一個命中的候選；都沒有回 null（呼叫方跳過，不報錯）。 */
export function resolvePreset(available: ReadonlySet<string>, candidates: readonly string[]): string | null {
  const lower = new Set([...available].map((s) => s.toLowerCase()));
  for (const c of candidates) {
    if (lower.has(c.toLowerCase())) {
      // 回傳實際存在的那個 key（保留原大小寫）
      for (const a of available) {
        if (a.toLowerCase() === c.toLowerCase()) return a;
      }
    }
  }
  return null;
}
