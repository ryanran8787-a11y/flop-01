import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ExpressionController, type ExpressionSink } from '../src/renderer/src/avatar/expression-controller.js';

function fakeSink(names: string[]): { sink: ExpressionSink; writes: Array<[string, number]> } {
  const writes: Array<[string, number]> = [];
  const map: Record<string, unknown> = {};
  for (const n of names) map[n] = {};
  return {
    writes,
    sink: {
      setValue: (name, w) => {
        writes.push([name, w]);
      },
      getExpression: (name) => (names.includes(name) ? {} : null),
      expressionMap: map,
    },
  };
}

describe('ExpressionController（VRM1.0）', () => {
  it('情緒只寫非嘴部 preset 並收斂到 1', () => {
    const f = fakeSink(['happy', 'joy', 'aa', 'neutral']);
    const c = new ExpressionController();
    c.bind(f.sink);
    f.writes.length = 0;
    c.setEmotion('happy');
    for (let i = 0; i < 120; i++) c.update(1 / 60);
    const happy = f.writes.filter(([n]) => n === 'happy').pop();
    expect(happy?.[1]).toBeGreaterThan(0.9);
    // 嘴部 aa 從未被情緒層碰過
    expect(f.writes.filter(([n]) => n === 'aa')).toEqual([]);
  });

  it('口型只寫嘴部 preset；closed 全歸零', () => {
    const f = fakeSink(['aa', 'a', 'happy']);
    const c = new ExpressionController();
    c.bind(f.sink);
    f.writes.length = 0;
    c.setMouth('aa', 0.8);
    expect(f.writes).toContainEqual(['aa', 0.8]);
    expect(f.writes.filter(([n]) => n === 'happy')).toEqual([]);
    f.writes.length = 0;
    c.setMouth('closed', 0);
    // 只歸零「實際解析到」的 preset（aa 勝出，a 從未被寫過故保持 0、不補寫）
    expect(f.writes).toContainEqual(['aa', 0]);
    expect(f.writes.filter(([n]) => n === 'happy')).toEqual([]);
  });

  it('0.x 回退（joy / 單字母 a）', () => {
    const f = fakeSink(['joy', 'a']);
    const c = new ExpressionController();
    c.bind(f.sink);
    f.writes.length = 0;
    c.setEmotion('happy');
    for (let i = 0; i < 120; i++) c.update(1 / 60);
    const joy = f.writes.filter(([n]) => n === 'joy').pop();
    expect(joy?.[1]).toBeGreaterThan(0.9);
    c.setMouth('aa', 0.5);
    expect(f.writes).toContainEqual(['a', 0.5]);
  });

  it('無眨眼 preset 時靜默跳過', () => {
    const f = fakeSink(['happy']);
    const c = new ExpressionController();
    c.bind(f.sink);
    expect(() => c.setBlink(1)).not.toThrow();
  });
});
