import { LipSyncMapper, dominant } from './lipsync-analyser.js';
import type { MouthViseme } from '../../../shared/types.js';

/**
 * TTS 播放器：播 sidecar 合成的 mp3 檔（renderer <audio>，供 AnalyserNode 取數）。
 * - 隊列逐句播放；speakFile 入隊，cancel 清空並停播
 * - 每幀 update(dt)：有 analyser 數據 → mapper → 主導 viseme 回調；結束/空 → closed
 * - Audio 元素由外部工廠注入（真機傳 document.createElement('audio')，測試傳 fake）
 */
export interface MiniAudio {
  src: string;
  onended: (() => void) | null;
  onerror: ((msg: string) => void) | null;
  play: () => Promise<void>;
  pause: () => void;
}

export interface AnalyserSource {
  readonly binCount: number;
  getData: (arr: Uint8Array) => void;
}

export interface TTSPlayerDeps {
  createAudio: () => MiniAudio;
  analyser?: AnalyserSource | null;
  onMouth: (viseme: MouthViseme, weight: number) => void;
  onPlayingChange: (playing: boolean, id: string | null) => void;
  onError?: (id: string, message: string) => void;
  /** URL 轉可播位址（如 asset:// → fetch blob objectURL）；回 null 用原值。 */
  resolveUrl?: (url: string) => Promise<string>;
  revokeUrl?: (url: string) => void;
}

export class TTSPlayer {
  private queue: Array<{ id: string; path: string }> = [];
  private audio: MiniAudio | null = null;
  private currentId: string | null = null;
  private buf: Uint8Array;
  private analyserSrc: AnalyserSource | null;
  private ownedUrls = new Set<string>();
  private readonly mapper = new LipSyncMapper({ sampleRate: 48000 });

  constructor(private deps: TTSPlayerDeps) {
    this.analyserSrc = deps.analyser ?? null;
    this.buf = new Uint8Array(this.analyserSrc?.binCount ?? 512);
  }

  /** 動態接入/斷開 analyser（每句新 audio element 重綁時用）。 */
  setAnalyser(src: AnalyserSource | null): void {
    this.analyserSrc = src;
    this.buf = new Uint8Array(src?.binCount ?? 512);
  }

  get playing(): boolean {
    return this.currentId !== null;
  }

  get pending(): number {
    return this.queue.length;
  }

  setSimpleMode(simple: boolean): void {
    this.mapper.setSimple(simple);
  }

  speakFile(id: string, path: string): void {
    this.queue.push({ id, path });
    if (this.currentId === null) void this.next();
  }

  /** 打斷：停播 + 清空 + 嘴閉合。 */
  cancel(): void {
    this.queue = [];
    try {
      this.audio?.pause();
    } catch {
      // 忽略
    }
    this.audio = null;
    this.revokeOwned();
    this.finish(null);
  }

  /** 每幀呼叫：推口型（無 analyser 時直接 closed，呼叫方可用 simple 模式註記）。 */
  update(dt: number): void {
    if (this.currentId === null || this.analyserSrc == null) {
      if (this.currentId !== null) this.deps.onMouth('closed', 0);
      return;
    }
    this.analyserSrc.getData(this.buf);
    const w = this.mapper.process(this.buf, dt);
    const d = dominant(w);
    this.deps.onMouth(d.viseme, d.weight);
  }

  private async next(): Promise<void> {
    const item = this.queue.shift();
    if (item === undefined) {
      this.finish(null);
      return;
    }
    this.currentId = item.id;
    this.mapper.reset();
    let src = item.path;
    try {
      const resolved = await this.deps.resolveUrl?.(item.path);
      if (resolved !== undefined && resolved !== null) {
        if (resolved !== src) this.ownedUrls.add(resolved);
        src = resolved;
      }
    } catch (err) {
      this.deps.onError?.(item.id, (err as Error).message);
      void this.next();
      return;
    }
    const audio = this.deps.createAudio();
    this.audio = audio;
    audio.onended = () => {
      if (this.audio === audio) {
        this.audio = null;
        this.revokeOwned();
        void this.next();
      }
    };
    audio.onerror = (msg) => {
      if (this.audio === audio) {
        this.audio = null;
        this.deps.onError?.(item.id, msg);
        this.revokeOwned();
        void this.next();
      }
    };
    audio.src = src;
    this.deps.onPlayingChange(true, item.id);
    try {
      await audio.play();
    } catch (err) {
      // 自動播放被擋等：當作錯誤，播下一句（呼叫方顯示氣泡）
      this.deps.onError?.(item.id, (err as Error).message);
      if (this.audio === audio) {
        this.audio = null;
        this.revokeOwned();
        void this.next();
      }
    }
  }

  /** 釋放已播完的自建 objectURL。 */
  private revokeOwned(): void {
    for (const u of this.ownedUrls) {
      try {
        this.deps.revokeUrl?.(u);
      } catch {
        // 忽略
      }
    }
    this.ownedUrls.clear();
  }

  private finish(id: string | null): void {
    const was = this.currentId;
    this.currentId = id;
    this.mapper.reset();
    this.deps.onMouth('closed', 0);
    if (was !== null || id === null) this.deps.onPlayingChange(false, id);
  }
}
