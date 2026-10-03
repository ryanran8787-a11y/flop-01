import type { AppConfig } from '../shared/config-schema.js';
import type { Outfit } from '../shared/types.js';

/**
 * 人設 prompt（精簡，照顧小模型）。
 * 原則：短規則 + 3 組好/壞 few-shot，用「做/不做」句式，避免長散文。
 */
export interface PersonaInput {
  persona: AppConfig['persona'];
  outfits: Outfit[];
  memoriesText: string;
}

export function buildSystemPrompt(input: PersonaInput): string {
  const { persona, outfits, memoriesText } = input;
  const outfitLines =
    outfits.length > 0
      ? outfits.map((o) => `- ${o.id}：${o.name}`).join('\n')
      : '- （目前沒有換裝）';
  const mem = memoriesText.trim().length > 0 ? memoriesText.trim() : '（尚無長期記憶）';
  return [
    `你是「${persona.name}」，${persona.traits}。使用者叫「${persona.userTitle}」。`,
    `說話：${persona.speech}`,
    `禁忌：${persona.taboos}`,
    `輸出必須是 JSON，只能有這四個鍵（順序固定）：emotion, action, outfitId, reply。`,
    `emotion 只能是 idle/happy/shy/caring/annoyed/surprised 其中之一。`,
    `action 只能是 nod/head_pat_react/wave/stretch/leave/return其中之一，或省略。`,
    `outfitId 只能是下面清單的 id，或省略；不在清單就省略，不要亂編：`,
    outfitLines,
    `reply 用繁體中文台灣用語，1–3 句短句。記住的事：`,
    mem,
    `好例子：{"emotion":"happy","reply":"今天有準時吃飯嗎？"}`,
    `好例子：{"emotion":"caring","action":"nod","reply":"聽起來很累，先喝口水吧。"}`,
    `壞例子（不要疊字賣萌）：{"emotion":"happy","reply":"主人最棒棒了～～"}`,
    `壞例子（不要情緒勒索）：{"emotion":"sad","reply":"你都不理人家…"}`,
    `注意：沒有 sad 這個 emotion；使用者離開或道別時祝福就好，不要挽留勒索。`,
  ].join('\n');
}

/** 模型切換後的最小 JSON Schema 相容性測試用 prompt（極短，省 VRAM/時間）。 */
export function buildCompatPrompt(): string {
  return '只回 JSON：{"emotion":"idle","reply":"嗨"}';
}

/** 相容性測試用的 format schema（與正式 schema 同形、欄位更少）。 */
export function compatFormatSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      emotion: { type: 'string' },
      reply: { type: 'string' },
    },
    required: ['emotion', 'reply'],
  };
}

/** 正式 AIResponse JSON Schema（欄位順序即輸出順序：emotion 先）。 */
export function aiResponseFormatSchema(availableOutfitIds: string[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      emotion: {
        type: 'string',
        enum: ['idle', 'happy', 'shy', 'caring', 'annoyed', 'surprised'],
      },
      action: {
        type: 'string',
        enum: ['nod', 'head_pat_react', 'wave', 'stretch', 'leave', 'return'],
      },
      outfitId: { type: 'string', enum: availableOutfitIds },
      reply: { type: 'string' },
    },
    required: ['emotion', 'reply'],
  };
}
