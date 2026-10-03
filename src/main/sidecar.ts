import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import WebSocket from 'ws';
import type { MainToSide, SideToMain } from '../shared/protocol.js';

/**
 * Sidecar 生命週期 + WS 控制面（完整實作）。
 * - spawn python sidecar/app.py（--port 0 由 sidecar 選埠，stdout 回報 SIDECAR_PORT）
 * - 啟動 token 經 argv 傳入；首訊必須 auth，否則 sidecar 斷線
 * - 崩潰指數退避重啟（1s→2s→…→30s 上限）；stop() 後不再重啟
 * - 子程序輸出寫輪替日誌（1MB × 5）；狀態轉移記錄 main 記憶體
 */

export type SidecarStatus = 'stopped' | 'starting' | 'online' | 'offline' | 'restarting';

export const MAX_BACKOFF_MS = 30_000;

export function backoffDelayMs(attempt: number): number {
  const a = Math.max(0, Math.floor(attempt));
  return Math.min(1000 * 2 ** a, MAX_BACKOFF_MS);
}

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/** 解析 sidecar stdout 行：SIDECAR_PORT=12345 */
export function parsePortLine(line: string): number | null {
  const m = /^SIDECAR_PORT=(\d{1,5})$/.exec(line.trim());
  if (m?.[1] === undefined) return null;
  const p = Number(m[1]);
  return p > 0 && p < 65536 ? p : null;
}

export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: { cwd?: string },
) => ChildProcess;

export type ConnectFn = (url: string) => WebSocket;

const DEFAULT_CONNECT: ConnectFn = (url) => new WebSocket(url);

/** 1MB × 5 輪替寫入器（純檔案操作，可測）。 */
export class RotatingLog {
  constructor(
    private dir: string,
    private base = 'sidecar',
    private maxBytes = 1024 * 1024,
    private keep = 5,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  write(line: string): void {
    const cur = join(this.dir, `${this.base}.log`);
    try {
      if (existsSync(cur) && statSync(cur).size >= this.maxBytes) this.rotate();
      appendFileSync(cur, line + '\n', 'utf-8');
    } catch {
      // 日誌失敗不影響主流程
    }
  }

  private rotate(): void {
    const cur = join(this.dir, `${this.base}.log`);
    try {
      const oldest = join(this.dir, `${this.base}.${this.keep}.log`);
      if (existsSync(oldest)) unlinkSync(oldest);
      // 由大往小搬：.log → .1.log → .2.log …
      for (let i = this.keep - 1; i >= 1; i--) {
        const from = i === 1 ? cur : join(this.dir, `${this.base}.${i - 1}.log`);
        const to = join(this.dir, `${this.base}.${i}.log`);
        if (existsSync(from)) renameSync(from, to);
      }
    } catch {
      // 忽略
    }
  }
}

export interface SidecarOptions {
  pythonPath: string;
  scriptPath: string;
  dataDir: string;
  initialWhisper?: { size: string; device: string; compute: string };
  spawn?: SpawnFn;
  connect?: ConnectFn;
  /** 可注入計時器（測試用）；預設全域 setTimeout/clearTimeout。 */
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export class SidecarManager extends EventEmitter {
  private _status: SidecarStatus = 'stopped';
  private _restarts = 0;
  private _attempt = 0;
  private child: ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private token = '';
  private timer: unknown = null;
  private stopping = false;
  private log: RotatingLog;
  private readonly spawnFn: SpawnFn;
  private readonly connectFn: ConnectFn;

  constructor(private opts: SidecarOptions) {
    super();
    this.log = new RotatingLog(join(opts.dataDir, 'logs'));
    this.spawnFn = opts.spawn ?? ((cmd, args, o) => nodeSpawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: o.cwd }));
    this.connectFn = opts.connect ?? DEFAULT_CONNECT;
  }

  get status(): SidecarStatus {
    return this._status;
  }

  get restarts(): number {
    return this._restarts;
  }

  /** 目前退避等待（測試可讀）。 */
  get nextDelayMs(): number {
    return backoffDelayMs(this._attempt);
  }

  start(): void {
    if (this._status === 'starting' || this._status === 'online') return;
    this.stopping = false;
    this._attempt = 0;
    this.launch();
  }

  stop(): void {
    this.stopping = true;
    this.clearPending();
    try {
      this.ws?.close();
    } catch {
      // 忽略
    }
    this.ws = null;
    try {
      this.child?.kill();
    } catch {
      // 忽略
    }
    this.child = null;
    this.setStatus('stopped');
  }

  // ---- 高階送訊（WS 未連時丟棄並回 false；呼叫方決定是否重試） ----
  send(msg: MainToSide): boolean {
    if (this.ws === null || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  sttStart = (mode: 'ptt' | 'vad'): boolean => this.send({ t: 'stt.start', mode });
  sttStop = (): boolean => this.send({ t: 'stt.stop' });
  ttsSpeak = (id: string, text: string, voice: string): boolean =>
    this.send({ t: 'tts.speak', id, text, voice });
  ttsCancel = (id?: string): boolean => this.send({ t: 'tts.cancel', id });
  ttsNotify = (playing: boolean): boolean => this.send({ t: 'tts.notify', playing });
  whisperReload = (size: string, device: string, compute: string): boolean =>
    this.send({ t: 'whisper.reload', size, device, compute });
  whisperCancelDownload = (): boolean => this.send({ t: 'whisper.cancelDownload' });
  gpuStats = (): boolean => this.send({ t: 'gpu.stats' });

  // ---- 內部狀態機（測試可直驅） ----

  /** 供 stdout 行解析呼叫；拿到 port 即連 WS。 */
  onStdoutLine(line: string): void {
    this.log.write(`[out] ${line}`);
    const port = parsePortLine(line);
    if (port !== null && this.ws === null) this.connectWs(port);
  }

  onStderrLine(line: string): void {
    this.log.write(`[err] ${line}`);
  }

  /** sidecar ready 握手完成（收到 {t:'ready'}）。 */
  recordReady(): void {
    this._attempt = 0;
    this.setStatus('online');
  }

  /** 子程序退出或 WS 斷線。 */
  recordExit(reason: string): void {
    this.log.write(`[exit] ${reason} restarts=${this._restarts}`);
    this.ws = null;
    this.child = null;
    if (this.stopping) {
      this.setStatus('stopped');
      return;
    }
    this._restarts += 1;
    const delay = backoffDelayMs(this._attempt);
    this._attempt += 1;
    this.setStatus('restarting');
    this.clearPending();
    const setTimer = this.opts.setTimer ?? setTimeout;
    this.timer = setTimer(() => {
      this.timer = null;
      this.launch();
    }, delay);
  }

  /** WS 收到訊息：路由。 */
  routeMessage(raw: string): void {
    let msg: SideToMain;
    try {
      msg = JSON.parse(raw) as SideToMain;
    } catch {
      this.log.write('[warn] 非 JSON 訊息已丟棄');
      return;
    }
    if (msg.t === 'ready') {
      this.recordReady();
      return;
    }
    this.emit('message', msg);
  }

  // ---- 私有 ----

  private launch(): void {
    this.setStatus('starting');
    this.token = generateToken();
    const args = [
      this.opts.scriptPath,
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--token',
      this.token,
      '--data-dir',
      this.opts.dataDir,
    ];
    if (this.opts.initialWhisper !== undefined) {
      args.push(
        '--whisper-size',
        this.opts.initialWhisper.size,
        '--whisper-device',
        this.opts.initialWhisper.device,
        '--whisper-compute',
        this.opts.initialWhisper.compute,
      );
    }
    try {
      const child = this.spawnFn(this.opts.pythonPath, args, {});
      this.child = child;
      child.stdout?.on('data', (d: Buffer) => {
        for (const line of String(d).split(/\r?\n/)) {
          if (line.trim().length > 0) this.onStdoutLine(line);
        }
      });
      child.stderr?.on('data', (d: Buffer) => {
        for (const line of String(d).split(/\r?\n/)) {
          if (line.trim().length > 0) this.onStderrLine(line);
        }
      });
      child.on('error', (err: Error) => {
        this.log.write(`[spawn-error] ${err.message}`);
        this.recordExit(`spawn-error: ${err.message}`);
      });
      child.on('exit', (code: number | null, signal: string | null) => {
        this.recordExit(`exit code=${code} signal=${signal}`);
      });
    } catch (err) {
      this.recordExit(`launch-throw: ${(err as Error).message}`);
    }
  }

  private connectWs(port: number): void {
    try {
      const ws = this.connectFn(`ws://127.0.0.1:${port}`);
      this.ws = ws;
      ws.on('open', () => {
        this.send({ t: 'auth', token: this.token });
      });
      ws.on('message', (data: WebSocket.Data) => {
        this.routeMessage(String(data));
      });
      ws.on('close', () => {
        if (this.ws === ws) this.recordExit('ws-close');
      });
      ws.on('error', (err: Error) => {
        this.log.write(`[ws-error] ${err.message}`);
      });
    } catch (err) {
      this.recordExit(`connect-throw: ${(err as Error).message}`);
    }
  }

  private clearPending(): void {
    if (this.timer !== null) {
      const clear = this.opts.clearTimer ?? clearTimeout;
      clear(this.timer as ReturnType<typeof setTimeout>);
      this.timer = null;
    }
  }

  private setStatus(s: SidecarStatus): void {
    this._status = s;
    try {
      const rss = Math.round(process.memoryUsage().rss / 1024 / 1024);
      this.log.write(`[status] ${s} main-rss=${rss}MiB`);
    } catch {
      // 忽略
    }
    this.emit('status', s);
  }
}
