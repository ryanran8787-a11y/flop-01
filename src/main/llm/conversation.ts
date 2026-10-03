import { EventEmitter } from 'node:events';
import type { AppConfig } from '../../shared/config-schema.js';
import type { ChatMessage } from '../ollama.js';
import { OllamaError } from '../ollama.js';
import type { OllamaLLM } from './llm-provider.js';
import { buildSystemPrompt } from '../persona.js';
import { budgetForContext, type SqliteMemory } from '../memory/store.js';
import type { SideToMain } from '../../shared/protocol.js';

/**
 * 對話編排（main 端）：STT → LLM 串流 → 逐句 TTS（深度 1 保序）→ 表情/動作/換裝。
 * - TTS 排隊深度 1：等上一句 tts.file 到達才送下一句（保序，延遲換順序正確性）
 * - 失敗/逾時該句降級為文字氣泡（ui:notify）
 * - 靜音時跳過 TTS，結尾一次顯示全文氣泡
 * - 每 20 輪背景摘要一次；忙碌中新輸入只保留最新一筆
 */
export interface ConversationDeps {
  llm: OllamaLLM;
  mem: SqliteMemory;
  getConfig: () => AppConfig;
  sidecar: {
    on: (event: 'message', cb: (msg: SideToMain) => void) => void;
    ttsSpeak: (id: string, text: string, voice: string) => boolean;
    ttsCancel: () => boolean;
  };
  sendRenderer: (channel: string, data: unknown) => void;
  setVrmPath: (path: string) => void;
  notify: (text: string) => void;
}

const SUMMARY_EVERY_TURNS = 20;
const TTS_FILE_TIMEOUT_MS = 45_000;

export class Conversation extends EventEmitter {
  private busy = false;
  private pendingInput: string | null = null;
  private turnSeq = 0;
  private muted = false;
  private fileWaiters = new Map<string, { ok: (path: string) => void; fail: () => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private deps: ConversationDeps) {
    super();
    deps.sidecar.on('message', (msg) => this.onSidecar(msg));
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.deps.sidecar.ttsCancel();
  }

  get isBusy(): boolean {
    return this.busy;
  }

  lastUserAt: number | null = null;
  lastProactiveAt: number | null = null;

  /** 主動搭話（節流由呼叫方用 shouldProactive 判斷）。不存假的使用者訊息。 */
  async proactive(nudge: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.runTurn(nudge, false);
      this.lastProactiveAt = Date.now();
    } finally {
      this.busy = false;
    }
  }

  /** STT 入口（stt.final）。忙碌中只保留最新。 */
  async turn(userText: string): Promise<void> {
    const text = userText.trim();
    if (text.length === 0) return;
    this.lastUserAt = Date.now();
    // 道別後 2 小時不主動搭話（不挽留、不情緒勒索）
    if (/再見|拜拜|掰掰|晚安|先這樣|下次見/.test(text)) {
      this.lastProactiveAt = Date.now() + 2 * 3600_000;
    }
    if (this.busy) {
      this.pendingInput = text;
      return;
    }
    this.busy = true;
    try {
      await this.runTurn(text, true);
    } finally {
      this.busy = false;
      const next = this.pendingInput;
      this.pendingInput = null;
      if (next !== null) void this.turn(next);
    }
  }

  private onSidecar(msg: SideToMain): void {
    if (msg.t === 'tts.file') {
      const w = this.fileWaiters.get(msg.id);
      if (w !== undefined) {
        clearTimeout(w.timer);
        this.fileWaiters.delete(msg.id);
        w.ok(msg.path);
      }
    } else if (msg.t === 'tts.error') {
      const w = this.fileWaiters.get(msg.id);
      if (w !== undefined) {
        clearTimeout(w.timer);
        this.fileWaiters.delete(msg.id);
        w.fail();
      }
    } else if (msg.t === 'stt.final') {
      void this.turn(msg.text);
    }
  }

  private waitForFile(id: string): Promise<string | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.fileWaiters.delete(id);
        resolve(null);
      }, TTS_FILE_TIMEOUT_MS);
      this.fileWaiters.set(id, {
        ok: (path) => resolve(path),
        fail: () => resolve(null),
        timer,
      });
    });
  }

  private async runTurn(userText: string, storeUser: boolean): Promise<void> {
    const { llm, mem, getConfig } = this.deps;
    const cfg = getConfig();
    const turnId = (this.turnSeq += 1);
    if (storeUser) {
      mem.append('user', userText);
    }
    // 主動搭話的 nudge 不存，避免污染記憶
    this.sendThinking(true);
    try {
      const budget = budgetForContext(this.profileNumCtx(cfg));
      const memHits = mem.search(userText, 8);
      const memText = memHits
        .map((h) => `- ${h.fact}`)
        .join('\n')
        .slice(0, budget.memChars);
      const system = buildSystemPrompt({ persona: cfg.persona, outfits: cfg.outfits, memoriesText: memText });
      const history: ChatMessage[] = mem
        .recent(budget.rounds)
        .reverse()
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.text }));
      const outfitIds = cfg.outfits.map((o) => o.id);

      // TTS 保序鏈（深度 1）
      let chain: Promise<void> = Promise.resolve();
      let sentIdx = 0;
      const result = await llm.chatTurn(system, history, outfitIds, {
        onSentence: (i, text) => {
          void i;
          if (this.muted) return; // 結尾一次顯示
          const myIdx = sentIdx;
          sentIdx += 1;
          chain = chain.then(() => this.speakSentence(turnId, myIdx, text));
        },
        onEarlyEmotion: (e) => this.deps.sendRenderer('avatar:emotion', { emotion: e }),
      });
      await chain;

      if (this.muted) {
        this.deps.notify(result.replyFull);
      }
      mem.append('assistant', result.replyFull);
      this.deps.sendRenderer('avatar:emotion', { emotion: result.emotion });
      if (result.action !== undefined) {
        this.deps.sendRenderer('avatar:action', { action: result.action });
      }
      if (result.outfitId !== undefined) {
        const o = cfg.outfits.find((x) => x.id === result.outfitId);
        if (o !== undefined) this.deps.setVrmPath(o.vrmPath);
      }
      const turns = mem.bumpTurn();
      if (turns - mem.lastSummaryTurn() >= SUMMARY_EVERY_TURNS) {
        mem.setLastSummaryTurn(turns);
        void this.summarize().catch(() => {});
      }
    } catch (err) {
      this.deps.notify(this.errorText(err));
    } finally {
      this.sendThinking(false);
    }
  }

  private async speakSentence(turnId: number, idx: number, text: string): Promise<void> {
    const voice = this.deps.getConfig().ttsVoice;
    const id = `t${turnId}s${idx}`;
    const accepted = this.deps.sidecar.ttsSpeak(id, text, voice);
    if (!accepted) {
      this.deps.notify(text); // sidecar 離線：該句降級文字
      return;
    }
    const path = await this.waitForFile(id);
    if (path === null) {
      this.deps.notify(text); // 合成逾時/失敗：該句降級文字
    }
    // 成功時 renderer 已自動經 tts:file 播放，無需額外動作
  }

  private async summarize(): Promise<void> {
    const { llm, mem } = this.deps;
    const recent = mem
      .recent(20)
      .reverse()
      .map((m) => `${m.role}: ${m.text}`)
      .join('\n');
    if (recent.trim().length === 0) return;
    const out = await llm.rawChat(
      '你是記憶助理。從對話中抽取值得長期記住的事實/偏好/重要事件，只回 JSON：{"facts":[{"kind":"fact|preference|event","fact":"…"}]}，最多 5 條，沒有就回 {"facts":[]}。不要記密碼、卡號等敏感資料。',
      recent,
    );
    try {
      const j = JSON.parse(out) as { facts?: Array<{ kind?: string; fact?: string }> };
      for (const f of j.facts ?? []) {
        const kind = f.kind === 'preference' || f.kind === 'event' ? f.kind : 'fact';
        if (typeof f.fact === 'string') mem.addFact(kind, f.fact);
      }
    } catch {
      // 摘要失敗不影響主流程
    }
  }

  private profileNumCtx(cfg: AppConfig): number {
    return cfg.modelProfiles[cfg.llmModel]?.num_ctx ?? 8192;
  }

  private sendThinking(on: boolean): void {
    this.deps.sendRenderer('avatar:thinking', { on });
  }

  private errorText(err: unknown): string {
    if (err instanceof OllamaError) {
      if (err.code === 'ollama-offline') return '連不上 Ollama，先確認它有啟動喔（預設 http://127.0.0.1:11434）。';
      if (err.code === 'model-missing') return '這個模型本機沒有，去設定頁選一個已安裝的吧。';
      return `模型出錯了：${err.message}`;
    }
    return `出錯了：${(err as Error).message}`;
  }
}
