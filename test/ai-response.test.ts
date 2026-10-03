import { describe, expect, it } from 'vitest';
import { AIResponseSchema, validateAIResponse } from '../src/shared/config-schema.js';

describe('AIResponse schema', () => {
  it('合法回應通過（含 action + outfitId）', () => {
    const r = AIResponseSchema.safeParse({
      emotion: 'happy',
      action: 'nod',
      outfitId: 'casual-01',
      reply: '嗨，今天過得好嗎？',
    });
    expect(r.success).toBe(true);
  });

  it('缺少 reply 失敗', () => {
    const r = AIResponseSchema.safeParse({ emotion: 'idle' });
    expect(r.success).toBe(false);
  });

  it('非法 emotion 失敗', () => {
    const r = AIResponseSchema.safeParse({ emotion: 'ecstatic', reply: 'hi' });
    expect(r.success).toBe(false);
  });

  it('降級：解析失敗回 idle + 原始文字', () => {
    const v = validateAIResponse({ emotion: '???' }, { rawTextFallback: '原始文字輸出', validOutfitIds: [] });
    expect(v).toEqual({ emotion: 'idle', reply: '原始文字輸出' });
  });

  it('降級：空原始文字用預設句', () => {
    const v = validateAIResponse(null, { rawTextFallback: '   ', validOutfitIds: [] });
    expect(v.emotion).toBe('idle');
    expect(v.reply.length).toBeGreaterThan(0);
  });

  it('非法 outfitId 一律忽略（保留其餘欄位）', () => {
    const v = validateAIResponse(
      { emotion: 'happy', action: 'wave', outfitId: 'not-in-list', reply: '嗨' },
      { rawTextFallback: '', validOutfitIds: ['casual-01'] },
    );
    expect(v).toEqual({ emotion: 'happy', action: 'wave', reply: '嗨' });
  });

  it('合法 outfitId 保留', () => {
    const v = validateAIResponse(
      { emotion: 'happy', outfitId: 'casual-01', reply: '嗨' },
      { rawTextFallback: '', validOutfitIds: ['casual-01'] },
    );
    expect(v.outfitId).toBe('casual-01');
  });
});
