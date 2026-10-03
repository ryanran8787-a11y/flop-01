/**
 * Ollama HTTP 客戶端（無 SDK，手寫 fetch；fetch 可注入，方便測試）。
 * 端點：GET /api/tags、GET /api/ps、POST /api/chat（stream JSON lines）。
 * 需驗證：keep_alive:0 卸載語義、format schema 各模型支援度（由相容性測試探測）。
 */
export interface OllamaModelInfo {
  name: string;
  size: number;
  modified: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatStreamOpts {
  model: string;
  messages: ChatMessage[];
  /** JSON Schema（Ollama format）。 */
  format?: Record<string, unknown>;
  temperature?: number;
  num_ctx?: number;
  /** 為 false 時傳 think:false；undefined 不傳。 */
  think?: boolean;
  keepAlive?: string | number;
  onToken: (text: string) => void;
  signal?: AbortSignal;
}

export type FetchFn = typeof fetch;

export class OllamaError extends Error {
  constructor(
    readonly code: 'ollama-offline' | 'model-missing' | 'bad-response' | 'aborted',
    message: string,
  ) {
    super(message);
  }
}

const MODEL_MISSING_HINTS = ['not found', 'does not exist', 'no such model', 'pull'];

export class OllamaClient {
  constructor(
    private baseUrl: string,
    private fetchFn: FetchFn = fetch,
  ) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}${path}`;
  }

  async listModels(): Promise<OllamaModelInfo[]> {
    let res: Response;
    try {
      res = await this.fetchFn(this.url('/api/tags'));
    } catch (err) {
      throw new OllamaError('ollama-offline', `連不上 Ollama：${(err as Error).message}`);
    }
    if (!res.ok) throw new OllamaError('bad-response', `GET /api/tags ${res.status}`);
    const json = (await res.json()) as { models?: Array<{ name?: string; size?: number; modified_at?: string }> };
    return (json.models ?? []).map((m) => ({
      name: m.name ?? '',
      size: m.size ?? 0,
      modified: m.modified_at ?? '',
    }));
  }

  /** 目前載入模型的記憶體佔用估計（bytes）。 */
  async loadedModels(): Promise<Array<{ name: string; sizeVram: number }>> {
    let res: Response;
    try {
      res = await this.fetchFn(this.url('/api/ps'));
    } catch (err) {
      throw new OllamaError('ollama-offline', `連不上 Ollama：${(err as Error).message}`);
    }
    if (!res.ok) throw new OllamaError('bad-response', `GET /api/ps ${res.status}`);
    const json = (await res.json()) as { models?: Array<{ name?: string; size_vram?: number }> };
    return (json.models ?? []).map((m) => ({ name: m.name ?? '', sizeVram: m.size_vram ?? 0 }));
  }

  /** 卸載模型（keep_alive:0）。需驗證各版本語義；失敗不拋錯（盡力而為）。 */
  async unload(model: string): Promise<void> {
    try {
      await this.fetchFn(this.url('/api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, keep_alive: 0 }),
      });
    } catch {
      // 卸載失敗不阻擋切換
    }
  }

  /**
   * 串流 chat，回傳完整 content。增量 token 經 onToken。
   * 附帶偵測 model-missing（404 / 訊息關鍵字）。
   */
  async chatStream(opts: ChatStreamOpts): Promise<string> {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages,
      stream: true,
    };
    if (opts.format !== undefined) body['format'] = opts.format;
    const options: Record<string, unknown> = {};
    if (opts.temperature !== undefined) options['temperature'] = opts.temperature;
    if (opts.num_ctx !== undefined) options['num_ctx'] = opts.num_ctx;
    if (Object.keys(options).length > 0) body['options'] = options;
    if (opts.think !== undefined) body['think'] = opts.think;
    if (opts.keepAlive !== undefined) body['keep_alive'] = opts.keepAlive;

    let res: Response;
    try {
      res = await this.fetchFn(this.url('/api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: opts.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new OllamaError('aborted', 'aborted');
      throw new OllamaError('ollama-offline', `連不上 Ollama：${(err as Error).message}`);
    }
    if (res.status === 404) throw new OllamaError('model-missing', `模型不存在：${opts.model}`);
    if (!res.ok || res.body === null) {
      const text = await res.text().catch(() => '');
      const lower = text.toLowerCase();
      if (MODEL_MISSING_HINTS.some((h) => lower.includes(h))) {
        throw new OllamaError('model-missing', `模型不存在：${opts.model}`);
      }
      throw new OllamaError('bad-response', `POST /api/chat ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let full = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (t.length === 0) continue;
        let chunk: { message?: { content?: string }; error?: string; done?: boolean };
        try {
          chunk = JSON.parse(t) as typeof chunk;
        } catch {
          continue;
        }
        if (typeof chunk.error === 'string' && chunk.error.length > 0) {
          throw new OllamaError('bad-response', chunk.error);
        }
        const c = chunk.message?.content ?? '';
        if (c.length > 0) {
          full += c;
          opts.onToken(c);
        }
      }
    }
    return full;
  }
}
