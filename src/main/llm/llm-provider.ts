import type { Action, Emotion } from '../../shared/types.js';
import type { AppConfig } from '../../shared/config-schema.js';
import { AIResponseSchema, validateAIResponse } from '../../shared/config-schema.js';
import { OllamaClient, OllamaError, type ChatMessage } from '../ollama.js';
import { aiResponseFormatSchema, buildCompatPrompt, compatFormatSchema } from '../persona.js';
import { SentenceBuffer, extractEarlyEmotion, salvageReplyText, ReplyExtractor } from './sentences.js';

/**
 * LLM Provider（Ollama）：串流 chat → 逐句回調 → 結尾驗證。
 * - profile 取自 config.modelProfiles[model]（temperature/num_ctx/think）
 * - 切換：unload 舊模型 → 相容性測試 → 失敗回滾
 */
export interface SentenceCb {
  onSentence: (index: number, text: string) => void;
  onEarlyEmotion?: (emotion: Emotion) => void;
}

export interface TurnResult {
  emotion: Emotion;
  action?: Action;
  outfitId?: string;
  replyFull: string;
}

export class OllamaLLM {
  private _current: string;

  constructor(
    private client: OllamaClient,
    private getConfig: () => AppConfig,
  ) {
    this._current = getConfig().llmModel;
  }

  get currentModel(): string {
    return this._current;
  }

  refreshFromConfig(): void {
    this._current = this.getConfig().llmModel;
  }

  private profile(model: string): { temperature: number; num_ctx: number; think?: boolean } {
    const p = this.getConfig().modelProfiles[model];
    return {
      temperature: p?.temperature ?? 0.7,
      num_ctx: p?.num_ctx ?? 8192,
      think: p?.think,
    };
  }

  async listModels(): Promise<string[]> {
    return (await this.client.listModels()).map((m) => m.name);
  }

  /**
   * 切換模型：舊模型 keep_alive:0 → 新模型相容性測試 → 成功才認。
   * thinking 回調供 UI 顯示「思考中」；失敗拋錯且 _current 不變（回滾）。
   */
  async switchModel(next: string, onThinking?: (on: boolean) => void): Promise<void> {
    if (next === this._current) return;
    onThinking?.(true);
    try {
      const prev = this._current;
      if (prev.length > 0) await this.client.unload(prev);
      await this.compatTest(next);
      this._current = next;
    } finally {
      onThinking?.(false);
    }
  }

  /** 最小 JSON 相容性測試：必須是可解析 JSON 且含 emotion+reply（嚴格，不接受降級）。 */
  async compatTest(model: string): Promise<void> {
    const prof = this.profile(model);
    const messages: ChatMessage[] = [
      { role: 'system', content: '只回 JSON，不要解釋。' },
      { role: 'user', content: buildCompatPrompt() },
    ];
    const full = await this.client.chatStream({
      model,
      messages,
      format: compatFormatSchema(),
      temperature: 0,
      num_ctx: Math.min(prof.num_ctx, 4096),
      think: false,
      onToken: () => {},
    });
    const parsed = AIResponseSchema.safeParse(safeJson(full));
    if (!parsed.success || parsed.data.reply.trim().length === 0) {
      throw new OllamaError('bad-response', `模型 ${model} 未通過 JSON 相容性測試`);
    }
  }

  /** 無 format 的裸聊（摘要等內部任務用）。 */
  async rawChat(system: string, user: string, numCtx = 4096): Promise<string> {
    return this.client.chatStream({
      model: this._current,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      num_ctx: numCtx,
      think: false,
      onToken: () => {},
    });
  }

  /** 一輪對話：串流 → 逐句 → 結尾驗證（含降級）。 */
  async chatTurn(
    system: string,
    history: ChatMessage[],
    outfitIds: string[],
    cb: SentenceCb,
  ): Promise<TurnResult> {
    const model = this._current;
    const prof = this.profile(model);
    const messages: ChatMessage[] = [{ role: 'system', content: system }, ...history];
    const buf = new SentenceBuffer();
    const replyEx = new ReplyExtractor();
    let idx = 0;
    let acc = '';
    let earlySent = false;
    const emitSentences = (text: string): void => {
      for (const s of buf.push(text)) {
        cb.onSentence(idx, s);
        idx += 1;
      }
    };
    const full = await this.client.chatStream({
      model,
      messages,
      format: aiResponseFormatSchema(outfitIds),
      temperature: prof.temperature,
      num_ctx: prof.num_ctx,
      think: prof.think,
      onToken: (tok) => {
        acc += tok;
        if (!earlySent) {
          const e = extractEarlyEmotion(acc);
          if (e !== null) {
            earlySent = true;
            cb.onEarlyEmotion?.(e);
          }
        }
        emitSentences(replyEx.push(acc));
      },
    });
    emitSentences(replyEx.flush());
    if (!replyEx.started) {
      // 非 JSON 降級：搶救全文當一句
      emitSentences(salvageReplyText(full));
    }
    const tail = buf.flush();
    if (tail !== null) {
      cb.onSentence(idx, tail);
      idx += 1;
    }
    void idx;
    const parsed = validateAIResponse(safeJson(full), {
      rawTextFallback: salvageReplyText(full),
      validOutfitIds: outfitIds,
    });
    return { ...parsed, replyFull: parsed.reply };
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
