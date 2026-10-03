import { describe, expect, it } from 'vitest';
import { AppConfigSchema } from '../src/shared/config-schema.js';
import { aiResponseFormatSchema, buildSystemPrompt } from '../src/main/persona.js';

const cfg = AppConfigSchema.parse({
  outfits: [{ id: 'casual-01', name: '日常服', vrmPath: '/x.vrm' }],
});

describe('buildSystemPrompt', () => {
  const sys = buildSystemPrompt({
    persona: cfg.persona,
    outfits: cfg.outfits,
    memoriesText: '- 使用者喜歡吃拉麵',
  });

  it('含人設/換裝/記憶', () => {
    expect(sys).toContain('小晴');
    expect(sys).toContain('casual-01');
    expect(sys).toContain('拉麵');
  });

  it('含好壞例子與禁忌（無 sad、無勒索）', () => {
    expect(sys).toContain('壞例子');
    expect(sys).toContain('勒索');
    expect(sys).toContain('沒有 sad');
  });

  it('無記憶時有佔位（不空白）', () => {
    const s2 = buildSystemPrompt({ persona: cfg.persona, outfits: [], memoriesText: '' });
    expect(s2).toContain('尚無長期記憶');
    expect(s2).toContain('目前沒有換裝');
  });
});

describe('aiResponseFormatSchema', () => {
  it('欄位順序 emotion 优先，outfitId 受清單約束', () => {
    const s = aiResponseFormatSchema(['a', 'b']) as { properties: Record<string, unknown> };
    expect(Object.keys(s.properties)).toEqual(['emotion', 'action', 'outfitId', 'reply']);
    expect(s.properties['outfitId']).toMatchObject({ enum: ['a', 'b'] });
  });
});
