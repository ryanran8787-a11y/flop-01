import { describe, expect, it, vi } from 'vitest';
import { AppConfigSchema } from '../src/shared/config-schema.js';
import { OllamaClient, OllamaError } from '../src/main/ollama.js';
import { OllamaLLM } from '../src/main/llm/llm-provider.js';

function streamJson(chunks: string[], status = 200): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(stream, { status });
}

function chunk(content: string): string {
  return JSON.stringify({ message: { content }, done: false }) + '\n';
}

const cfg = AppConfigSchema.parse({});

describe('OllamaClient.chatStream', () => {
  it('累積 tokens 並回傳全文', async () => {
    const fetchFn = vi.fn(
      async (_url?: unknown, _init?: unknown): Promise<Response> =>
        streamJson([chunk('{"emotion":"'), chunk('happy"}')]),
    );
    const c = new OllamaClient('http://127.0.0.1:11434', fetchFn as unknown as typeof fetch);
    const tokens: string[] = [];
    const full = await c.chatStream({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      onToken: (t) => tokens.push(t),
    });
    expect(full).toBe('{"emotion":"happy"}');
    expect(tokens.join('')).toBe(full);
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    expect(body['stream']).toBe(true);
  });

  it('斷線 → ollama-offline；404 → model-missing', async () => {
    const down = new OllamaClient('http://x', (() => Promise.reject(new Error('refused'))) as never);
    await expect(down.listModels()).rejects.toMatchObject({ code: 'ollama-offline' });
    const nf = new OllamaClient('http://x', (async () => new Response('{}', { status: 404 })) as never);
    await expect(
      nf.chatStream({ model: 'ghost', messages: [], onToken: () => {} }),
    ).rejects.toMatchObject({ code: 'model-missing' });
  });

  it('unload 送 keep_alive:0（失敗吞掉）', async () => {
    const fetchFn = vi.fn(async (_url?: unknown, _init?: unknown): Promise<Response> => new Response('{}'));
    const c = new OllamaClient('http://x', fetchFn as unknown as typeof fetch);
    await c.unload('old');
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'old', keep_alive: 0 });
    const bad = new OllamaClient('http://x', (() => Promise.reject(new Error('down'))) as never);
    await bad.unload('old'); // 不拋
  });
});

describe('OllamaLLM', () => {
  function llmFor(responder: (model: string) => string): { llm: OllamaLLM; unloaded: string[] } {
    const unloaded: string[] = [];
    const fetchFn = vi.fn(async (_url: unknown, init?: { body?: unknown }): Promise<Response> => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string; keep_alive?: number };
      if (body.keep_alive === 0 && body.model !== undefined) {
        unloaded.push(body.model);
        return new Response('{}');
      }
      const text: string = responder(body.model ?? '');
      return streamJson([chunk(text)]);
    });
    const client = new OllamaClient('http://x', fetchFn as unknown as typeof fetch);
    return { llm: new OllamaLLM(client, () => cfg), unloaded };
  }

  it('chatTurn：逐句 + 早期 emotion + 結尾驗證', async () => {
    const { llm } = llmFor(() => '{"emotion":"happy","action":"nod","reply":"嗨！今天好嗎？"}');
    const sentences: string[] = [];
    const early: string[] = [];
    const r = await llm.chatTurn(
      'sys',
      [{ role: 'user', content: 'hi' }],
      [],
      { onSentence: (_i, s) => sentences.push(s), onEarlyEmotion: (e) => early.push(e) },
    );
    expect(sentences).toEqual(['嗨！', '今天好嗎？']);
    expect(early).toEqual(['happy']);
    expect(r).toMatchObject({ emotion: 'happy', action: 'nod' });
  });

  it('壞 JSON 降級為 idle + 原文', async () => {
    const { llm } = llmFor(() => '今天天氣真好');
    const sentences: string[] = [];
    const r = await llm.chatTurn('sys', [], [], { onSentence: (_i, s) => sentences.push(s) });
    expect(r.emotion).toBe('idle');
    expect(r.replyFull).toContain('今天天氣真好');
    expect(sentences).toEqual(['今天天氣真好']);
  });

  it('switchModel 成功換、失敗回滾', async () => {
    const { llm, unloaded } = llmFor((m) =>
      m === 'bad' ? 'not json at all{{{' : '{"emotion":"idle","reply":"嗨"}',
    );
    expect(llm.currentModel).toBe('qwen3:8b');
    const thinking: boolean[] = [];
    await llm.switchModel('good', (on) => thinking.push(on));
    expect(llm.currentModel).toBe('good');
    expect(unloaded).toContain('qwen3:8b');
    expect(thinking).toEqual([true, false]);
    await expect(llm.switchModel('bad')).rejects.toBeInstanceOf(OllamaError);
    expect(llm.currentModel).toBe('good'); // 回滾
  });
});
