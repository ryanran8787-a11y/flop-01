import { describe, expect, it, vi } from 'vitest';
import { AppConfigSchema } from '../src/shared/config-schema.js';
import { OllamaError } from '../src/main/ollama.js';
import { Conversation } from '../src/main/llm/conversation.js';
import { SqliteMemory } from '../src/main/memory/store.js';
import type { SideToMain } from '../src/shared/protocol.js';

const cfg = AppConfigSchema.parse({
  outfits: [{ id: 'casual-01', name: '日常服', vrmPath: '/c.vrm' }],
});

interface Ctx {
  conv: Conversation;
  sent: Array<{ ch: string; data: unknown }>;
  spoken: Array<{ id: string; text: string }>;
  notified: string[];
  vrmPaths: string[];
  msgHandler: (m: SideToMain) => void;
  chatTurnImpl: (
    sys: string,
    hist: Array<{ role: string; content: string }>,
    ids: string[],
    cb: { onSentence: (i: number, s: string) => void; onEarlyEmotion?: (e: 'happy') => void },
  ) => Promise<{ emotion: 'happy'; action?: 'nod'; outfitId?: string; replyFull: string }>;
}

function setup(reply: { emotion: 'happy'; action?: 'nod'; outfitId?: string; replyFull: string } = { emotion: 'happy', replyFull: '嗨，今天好嗎？' }): Ctx {
  const sent: Ctx['sent'] = [];
  const spoken: Ctx['spoken'] = [];
  const notified: string[] = [];
  const vrmPaths: string[] = [];
  const mem = new SqliteMemory(':memory:');
  let handler: (m: SideToMain) => void = () => {};
  const ctx = {} as Ctx;
  const current = { ...reply };
  const llm = {
    chatTurn: vi.fn(
      async (
        _sys: string,
        _hist: Array<{ role: string; content: string }>,
        _ids: string[],
        cb: { onSentence: (i: number, s: string) => void; onEarlyEmotion?: (e: 'happy') => void },
      ) => {
        cb.onEarlyEmotion?.('happy');
        cb.onSentence(0, current.replyFull);
        return { ...current };
      },
    ),
    rawChat: vi.fn(async () => '{"facts":[]}'),
  };
  const conv = new Conversation({
    llm: llm as never,
    mem,
    getConfig: () => cfg,
    sidecar: {
      on: (_e, cb) => {
        handler = cb;
      },
      ttsSpeak: (id, text, _voice) => {
        spoken.push({ id, text });
        return true;
      },
      ttsCancel: () => true,
    },
    sendRenderer: (ch, data) => sent.push({ ch, data }),
    setVrmPath: (p) => vrmPaths.push(p),
    notify: (t) => notified.push(t),
  });
  return { conv, sent, spoken, notified, vrmPaths, get msgHandler() { return handler; }, chatTurnImpl: llm.chatTurn };
}

describe('Conversation', () => {
  it('一輪：thinking→TTS 保序→表情動作→記憶', async () => {
    const c = setup();
    const p = c.conv.turn('你好');
    await new Promise((r) => setTimeout(r, 10));
    expect(c.spoken).toEqual([{ id: 't1s0', text: '嗨，今天好嗎？' }]);
    // 送 tts.file → 鏈完成 → turn 結束
    c.msgHandler({ t: 'tts.file', id: 't1s0', path: '/a.mp3' });
    await p;
    const thinking = c.sent.filter((s) => s.ch === 'avatar:thinking');
    expect(thinking[0]?.data).toEqual({ on: true });
    expect(thinking[thinking.length - 1]?.data).toEqual({ on: false });
    expect(c.sent).toContainEqual({ ch: 'avatar:emotion', data: { emotion: 'happy' } });
  });

  it('outfitId 合法 → 切 vrmPath', async () => {
    const c = setup({ emotion: 'happy', outfitId: 'casual-01', replyFull: '換好了' });
    const p = c.conv.turn('換衣服');
    await new Promise((r) => setTimeout(r, 10));
    c.msgHandler({ t: 'tts.file', id: 't1s0', path: '/a.mp3' });
    await p;
    expect(c.vrmPaths).toEqual(['/c.vrm']);
  });

  it('靜音：不送 TTS，結尾一次氣泡', async () => {
    const c = setup();
    c.conv.setMuted(true);
    await c.conv.turn('嗨');
    expect(c.spoken).toEqual([]);
    expect(c.notified).toEqual(['嗨，今天好嗎？']);
  });

  it('Ollama 離線 → 中文提示 + thinking 關', async () => {
    const c = setup();
    (c.chatTurnImpl as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new OllamaError('ollama-offline', 'x'),
    );
    await c.conv.turn('嗨');
    expect(c.notified.join('')).toContain('Ollama');
    const thinking = c.sent.filter((s) => s.ch === 'avatar:thinking');
    expect(thinking[thinking.length - 1]?.data).toEqual({ on: false });
  });

  it('忙碌中只保留最新輸入', async () => {
    const c = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    (c.chatTurnImpl as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      await gate;
      return { emotion: 'happy' as const, replyFull: '第一輪' };
    });
    const p1 = c.conv.turn('first');
    const p2 = c.conv.turn('second');
    const p3 = c.conv.turn('third');
    release();
    await Promise.all([p1, p2, p3]);
    c.msgHandler({ t: 'tts.file', id: 't1s0', path: '/a.mp3' });
    await new Promise((r) => setTimeout(r, 30));
    expect((c.chatTurnImpl as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it('stt.final 自動進 turn', async () => {
    const c = setup();
    c.msgHandler({ t: 'stt.final', text: '麥克風內容', at: 1 });
    await new Promise((r) => setTimeout(r, 30));
    expect(c.spoken.length).toBe(1);
  });
});
