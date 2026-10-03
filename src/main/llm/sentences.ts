/**
 * 串流句子切分 + 早期 emotion 抽取（純函數/小類）。
 * - 句子終止符：。！？!?…\n（連續標點併入同一句；…算一句）
 * - emotion 在 JSON 欄位順序中第一個出現，可在完整解析前 regex 抽到，
 *   讓表情先於語音出現。
 */

const TERMINATORS = new Set(['。', '！', '？', '!', '?', '\n', '…']);

export class SentenceBuffer {
  private buf = '';

  /** 餵 token；回傳新完整句（可能多句）。 */
  push(token: string): string[] {
    this.buf += token;
    const out: string[] = [];
    let start = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const ch = this.buf[i];
      if (ch !== undefined && TERMINATORS.has(ch)) {
        // 吞掉連續終止符（？！、……）
        let j = i + 1;
        while (j < this.buf.length) {
          const n = this.buf[j];
          if (n !== undefined && TERMINATORS.has(n)) j++;
          else break;
        }
        const s = this.buf.slice(start, j).trim();
        if (s.length > 0) out.push(s);
        start = j;
        i = j - 1;
      }
    }
    this.buf = this.buf.slice(start);
    return out;
  }

  /** 流結束：殘留文字當一句吐出（去空白）。 */
  flush(): string | null {
    const s = this.buf.trim();
    this.buf = '';
    return s.length > 0 ? s : null;
  }
}

/** 從「不完整 JSON」中提前抽 emotion（僅限已知枚舉值，避免亂吞）。 */
const KNOWN_EMOTIONS = ['idle', 'happy', 'shy', 'caring', 'annoyed', 'surprised'] as const;
export type EarlyEmotion = (typeof KNOWN_EMOTIONS)[number];

export function extractEarlyEmotion(partial: string): EarlyEmotion | null {
  const m = /"emotion"\s*:\s*"([a-z]+)"/.exec(partial);
  if (m?.[1] === undefined) return null;
  const v = m[1];
  return (KNOWN_EMOTIONS as readonly string[]).includes(v) ? (v as EarlyEmotion) : null;
}

/**
 * reply 增量抽取器：從累積原文中只取出 "reply" 欄位的新增明文。
 * - 每次餵「完整累積文字」（呼叫方持有 acc），內部記 consumed 位移
 * - 跳脫跨 token：尾端懸空反斜線 / 不完整 \uXXXX 暫扣，下次再吐
 * - 遇到非跳脫 closing quote 即結束；flush 吐殘留
 */
export class ReplyExtractor {
  private consumed = 0;
  private hold = '';
  private ended = false;
  private _started = false;

  get started(): boolean {
    return this._started;
  }

  get done(): boolean {
    return this.ended;
  }

  push(acc: string): string {
    if (this.ended) return '';
    let raw: string;
    if (!this._started) {
      const m = /"reply"\s*:\s*"/.exec(acc);
      if (m === null || m.index === undefined) return '';
      this._started = true;
      raw = acc.slice(m.index + m[0].length);
      // consumed 直接推到 acc 尾（已掃描；未吐出的尾巴由 hold 帶往下次）
      this.consumed = acc.length;
    } else {
      raw = acc.slice(this.consumed);
      this.consumed = acc.length;
    }
    if (raw.length === 0) return '';
    const seg = this.hold + raw;
    this.hold = '';
    // 找非跳脫的 closing quote
    let esc = false;
    for (let i = 0; i < seg.length; i++) {
      const ch = seg[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\') {
        esc = true;
        continue;
      }
      if (ch === '"') {
        this.ended = true;
        const body = seg.slice(0, i);
        // closing 後的 JSON 尾巴（} 等）直接丟棄
        return this.unescape(body);
      }
    }
    // 沒結束：扣住尾端不完整跳脫
    let cut = seg.length;
    const tail = /((?:\\u[0-9a-fA-F]{0,3}|\\+))$/.exec(seg);
    if (tail?.[1] !== undefined) {
      const run = tail[1];
      if (run.startsWith('\\u')) {
        cut = seg.length - run.length;
        this.hold = run;
      } else if (run.length % 2 === 1) {
        cut = seg.length - run.length;
        this.hold = run;
      }
    }
    return this.unescape(seg.slice(0, cut));
  }

  flush(): string {
    if (this.ended || !this._started) return '';
    this.ended = true;
    const out = this.unescape(this.hold);
    this.hold = '';
    return out;
  }

  private unescape(raw: string): string {
    if (raw.length === 0) return '';
    try {
      return JSON.parse(`"${raw}"`) as string;
    } catch {
      return '';
    }
  }
}

/**
 * 從完整回應中盡力取出 reply 文字（模型沒守 schema 時的搶救）。
 * 順序：JSON.parse 取 reply → 裸文字（去 JSON 殘渣）→ 原文。
 */
export function salvageReplyText(full: string): string {
  const t = full.trim();
  if (t.length === 0) return '';
  try {
    const j = JSON.parse(t) as { reply?: unknown };
    if (typeof j.reply === 'string' && j.reply.trim().length > 0) return j.reply.trim();
  } catch {
    // 繼續往下
  }
  // 常見殘渣：{"emotion":"happy","reply":"嗨 → 取最後一個冒號後的引號內容
  const m = /"reply"\s*:\s*"([^"]*)$/.exec(t);
  if (m?.[1] !== undefined && m[1].trim().length > 0) {
    return m[1].replace(/\\n/g, '\n').trim();
  }
  // 去掉明顯的 JSON 碎片行
  const lines = t
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^[{}",:\s\w-]*$/.test(l));
  const cand = lines.join('\n').trim();
  return cand.length > 0 ? cand : t;
}
