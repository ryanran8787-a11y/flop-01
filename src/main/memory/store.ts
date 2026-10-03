import Database from 'better-sqlite3';

/**
 * 長期記憶（better-sqlite3，本機）。階段 7 範圍：
 * 短期 messages、長期 memories（事實/偏好/重要事件）、top-k 檢索、token 預算、
 * 敏感資料攔截、匯出。摘要觸發由 conversation 驅動。
 */
export type MemoryKind = 'fact' | 'preference' | 'event';

export interface MemoryRow {
  id: number;
  kind: string;
  fact: string;
  score: number;
  at: number;
}

export interface ChatRow {
  role: string;
  text: string;
  at: number;
}

const SENSITIVE: Array<{ name: string; re: RegExp }> = [
  { name: 'card-number', re: /\b\d{15,19}\b/ },
  { name: 'tw-id', re: /\b[A-Z][12]\d{8}\b/ },
  { name: 'secret-kv', re: /(password|passwd|pwd|密碼|信用卡|卡號|帳號|帳密|金鑰|私鑰)\s*[:：=]\s*\S+/i },
  { name: 'api-key', re: /\b(sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|xox[bap]-[A-Za-z0-9-]+)\b/ },
];

export function detectSensitive(text: string): string | null {
  for (const s of SENSITIVE) {
    if (s.re.test(text)) return s.name;
  }
  return null;
}

/** token 預算：啟發式（CJK 約 1.5 字/token，這裡用字數上限，保守估）。 */
export function budgetForContext(numCtx: number): { memChars: number; rounds: number } {
  if (numCtx >= 16384) return { memChars: 3000, rounds: 12 };
  if (numCtx >= 8192) return { memChars: 1500, rounds: 8 };
  return { memChars: 800, rounds: 4 };
}

export class SqliteMemory {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, role TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, fact TEXT NOT NULL UNIQUE, score REAL NOT NULL DEFAULT 1, at INTEGER NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_messages_at ON messages(at);
      CREATE INDEX IF NOT EXISTS idx_memories_score ON memories(score DESC);
    `);
  }

  close(): void {
    this.db.close();
  }

  /** 存訊息；命中敏感資料回 false（不存）。 */
  append(role: 'user' | 'assistant', text: string): boolean {
    if (detectSensitive(text) !== null) return false;
    this.db.prepare('INSERT INTO messages (role, text, at) VALUES (?, ?, ?)').run(role, text, Date.now());
    return true;
  }

  recent(n: number): ChatRow[] {
    return this.db
      .prepare('SELECT role, text, at FROM messages ORDER BY id DESC LIMIT ?')
      .all(n) as ChatRow[];
  }

  /**
   * top-k 檢索（無 embeddings 的關鍵字啟發式）：
   * 整句包含 +3；英文數字詞命中 +1/詞；新近度加成 ≤1。 trafila…無，純 SQL+JS。
   */
  search(query: string, k: number): Array<{ fact: string; score: number }> {
    const q = query.trim();
    if (q.length === 0) return [];
    const rows = this.db.prepare('SELECT fact, score, at FROM memories').all() as Array<{
      fact: string;
      score: number;
      at: number;
    }>;
    const words = q
      .toLowerCase()
      .split(/[\s,，。！？、；：「」『』（）()!?.-]+/)
      .filter((w) => w.length >= 2);
    const now = Date.now();
    const scored = rows.map((r) => {
      let lex = 0;
      const f = r.fact;
      if (f.includes(q)) lex += 3;
      for (const w of words) {
        if (f.toLowerCase().includes(w)) lex += 1;
      }
      if (lex === 0) return { fact: f, score: 0 }; // 無字面命中：新近度不得單獨入選
      const ageDays = Math.max(0, (now - r.at) / 86400000);
      const s = lex + Math.max(0, 1 - ageDays / 90);
      return { fact: f, score: s * r.score };
    });
    return scored
      .filter((r) => r.score > 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  addFact(kind: MemoryKind, fact: string): boolean {
    const f = fact.trim().slice(0, 500);
    if (f.length === 0 || detectSensitive(f) !== null) return false;
    try {
      this.db
        .prepare('INSERT INTO memories (kind, fact, score, at, updated) VALUES (?, ?, 1, ?, ?)')
        .run(kind, f, Date.now(), Date.now());
      return true;
    } catch {
      return false; // 重複 fact（UNIQUE）等
    }
  }

  listFacts(limit = 200): MemoryRow[] {
    return this.db
      .prepare('SELECT id, kind, fact, score, at FROM memories ORDER BY updated DESC LIMIT ?')
      .all(limit) as MemoryRow[];
  }

  updateFact(id: number, fact: string): boolean {
    if (detectSensitive(fact) !== null) return false;
    const r = this.db.prepare('UPDATE memories SET fact = ?, updated = ? WHERE id = ?').run(fact, Date.now(), id);
    return r.changes > 0;
  }

  deleteFact(id: number): boolean {
    return this.db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes > 0;
  }

  exportAll(): { messages: ChatRow[]; memories: MemoryRow[] } {
    return {
      messages: this.db.prepare('SELECT role, text, at FROM messages ORDER BY id ASC').all() as ChatRow[],
      memories: this.db.prepare('SELECT id, kind, fact, score, at FROM memories ORDER BY id ASC').all() as MemoryRow[],
    };
  }

  turnCount(): number {
    const r = this.db.prepare("SELECT value FROM meta WHERE key = 'turns'").get() as { value: string } | undefined;
    return Number(r?.value ?? 0);
  }

  bumpTurn(): number {
    const n = this.turnCount() + 1;
    this.db.prepare("INSERT INTO meta (key, value) VALUES ('turns', ?) ON CONFLICT(key) DO UPDATE SET value = ?").run(String(n), String(n));
    return n;
  }

  lastSummaryTurn(): number {
    const r = this.db.prepare("SELECT value FROM meta WHERE key = 'summaryTurn'").get() as { value: string } | undefined;
    return Number(r?.value ?? 0);
  }

  setLastSummaryTurn(n: number): void {
    this.db.prepare("INSERT INTO meta (key, value) VALUES ('summaryTurn', ?) ON CONFLICT(key) DO UPDATE SET value = ?").run(String(n), String(n));
  }

  messageCount(): number {
    const r = this.db.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number };
    return r.c;
  }
}
