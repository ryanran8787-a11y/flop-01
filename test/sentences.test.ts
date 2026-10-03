import { describe, expect, it } from 'vitest';
import { SentenceBuffer, extractEarlyEmotion, salvageReplyText, ReplyExtractor } from '../src/main/llm/sentences.js';

describe('SentenceBuffer', () => {
  it('標點切分，連續標點併入', () => {
    const b = new SentenceBuffer();
    expect(b.push('今天天氣很好')).toEqual([]);
    expect(b.push('，我們出去走走')).toEqual([]);
    expect(b.push('吧！真的嗎？')).toEqual(['今天天氣很好，我們出去走走吧！', '真的嗎？']);
  });

  it('換行與省略號切分', () => {
    const b = new SentenceBuffer();
    expect(b.push('第一行\n第二行')).toEqual(['第一行']);
    expect(b.push('等一下……好了')).toEqual(['第二行等一下……']);
    expect(b.flush()).toBe('好了');
  });

  it('flush 吐殘留，空則 null', () => {
    const b = new SentenceBuffer();
    expect(b.flush()).toBeNull();
    b.push('  有尾巴');
    expect(b.flush()).toBe('有尾巴');
    expect(b.flush()).toBeNull();
  });
});

describe('extractEarlyEmotion', () => {
  it('部分 JSON 提前抽到', () => {
    expect(extractEarlyEmotion('{"emotion":"hap')).toBeNull();
    expect(extractEarlyEmotion('{"emotion":"happy","re')).toBe('happy');
    expect(extractEarlyEmotion('{"emotion":"ecstatic"')).toBeNull();
  });
});

describe('ReplyExtractor', () => {
  it('跨 token 增量吐 reply 明文（不含 JSON 雜訊）', () => {
    const ex = new ReplyExtractor();
    let acc = '';
    const deltas: string[] = [];
    for (const tok of ['{"emotion":"happy","', 'action":"nod","reply":"嗨', '！今', '天好嗎？"}']) {
      acc += tok;
      deltas.push(ex.push(acc));
    }
    expect(deltas.join('')).toBe('嗨！今天好嗎？');
    expect(ex.flush()).toBe('');
  });

  it('跳脫引號與尾端反斜線不斷裂', () => {
    const ex = new ReplyExtractor();
    let acc = '{"reply":"他說\\"嗨';
    expect(ex.push(acc)).toBe('他說"嗨');
    acc += '\\';
    expect(ex.push(acc)).toBe(''); // 懸空反斜線暫扣
    acc += 'n好嗎"}';
    expect(ex.push(acc)).toBe('\n好嗎');
    expect(ex.done).toBe(true);
  });

  it('非 JSON 永不啟動', () => {
    const ex = new ReplyExtractor();
    expect(ex.push('純文字')).toBe('');
    expect(ex.started).toBe(false);
  });

  it('截斷流：push 即時吐，flush 只剩暫扣（此例無暫扣故空）', () => {
    const ex = new ReplyExtractor();
    expect(ex.push('{"reply":"說到一半')).toBe('說到一半');
    expect(ex.flush()).toBe('');
  });
});

describe('salvageReplyText', () => {  it('完整 JSON 取 reply', () => {
    expect(salvageReplyText('{"emotion":"idle","reply":"嗨"}')).toBe('嗨');
  });

  it('截斷 JSON 搶救 reply 前綴', () => {
    expect(salvageReplyText('{"emotion":"happy","reply":"今天很開心')).toBe('今天很開心');
  });

  it('裸文字原樣', () => {
    expect(salvageReplyText('純文字回應')).toBe('純文字回應');
  });
});
