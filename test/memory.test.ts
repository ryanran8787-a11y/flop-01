import { describe, expect, it } from 'vitest';
import { budgetForContext, detectSensitive, SqliteMemory } from '../src/main/memory/store.js';

describe('detectSensitive', () => {
  it('擋卡號/身分證/密碼鍵值/API key', () => {
    expect(detectSensitive('我的卡 1234567890123456')).toBe('card-number');
    expect(detectSensitive('A123456789')).toBe('tw-id');
    expect(detectSensitive('password: abc123')).toBe('secret-kv');
    expect(detectSensitive('密碼：qwer')).toBe('secret-kv');
    expect(detectSensitive('sk-abcdefghijklmnopqrst')).toBe('api-key');
  });

  it('一般文字放行', () => {
    expect(detectSensitive('我喜歡吃拉麵')).toBeNull();
    expect(detectSensitive('電話 0912345678')).toBeNull();
  });
});

describe('budgetForContext', () => {
  it('小模型自動縮減', () => {
    expect(budgetForContext(32768)).toEqual({ memChars: 3000, rounds: 12 });
    expect(budgetForContext(8192)).toEqual({ memChars: 1500, rounds: 8 });
    expect(budgetForContext(4096)).toEqual({ memChars: 800, rounds: 4 });
  });
});

describe('SqliteMemory', () => {
  it('CRUD + 敏感拒存 + top-k + 匯出', () => {
    const mem = new SqliteMemory(':memory:');
    expect(mem.append('user', '我喜歡吃拉麵，尤其是豚骨')).toBe(true);
    expect(mem.append('user', '卡號 1234567890123456')).toBe(false);
    expect(mem.recent(5).length).toBe(1);

    expect(mem.addFact('preference', '使用者喜歡吃拉麵')).toBe(true);
    expect(mem.addFact('fact', '使用者住在台北')).toBe(true);
    expect(mem.addFact('fact', '密碼：abc')).toBe(false);
    expect(mem.addFact('preference', '使用者喜歡吃拉麵')).toBe(false); // 重複

    const hits = mem.search('拉麵', 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.fact).toContain('拉麵');
    expect(mem.search('完全無關的字串xyz', 3)).toEqual([]);

    const rows = mem.listFacts();
    expect(rows.length).toBe(2);
    expect(mem.updateFact(rows[0]?.id ?? -1, '使用者超愛吃拉麵')).toBe(true);
    expect(mem.deleteFact(99999)).toBe(false);
    expect(mem.deleteFact(rows[1]?.id ?? -1)).toBe(true);
    expect(mem.listFacts().length).toBe(1);

    expect(mem.bumpTurn()).toBe(1);
    expect(mem.turnCount()).toBe(1);
    const exp = mem.exportAll();
    expect(exp.messages.length).toBe(1);
    expect(exp.memories.length).toBe(1);
    mem.close();
  });
});
