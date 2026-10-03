import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RotatingLog,
  SidecarManager,
  backoffDelayMs,
  generateToken,
  parsePortLine,
} from '../src/main/sidecar.js';

describe('backoff/token/port 解析', () => {
  it('指數退避 1s 起跳、30s 上限', () => {
    expect(backoffDelayMs(0)).toBe(1000);
    expect(backoffDelayMs(1)).toBe(2000);
    expect(backoffDelayMs(2)).toBe(4000);
    expect(backoffDelayMs(99)).toBe(30000);
    expect(backoffDelayMs(-5)).toBe(1000);
  });

  it('token 為 64 hex', () => {
    expect(generateToken()).toMatch(/^[0-9a-f]{64}$/);
    expect(generateToken()).not.toBe(generateToken());
  });

  it('只認 SIDECAR_PORT=數字行', () => {
    expect(parsePortLine('SIDECAR_PORT=18765')).toBe(18765);
    expect(parsePortLine('  SIDECAR_PORT=80  ')).toBe(80);
    expect(parsePortLine('SIDECAR_PORT=abc')).toBeNull();
    expect(parsePortLine('PORT=1234')).toBeNull();
    expect(parsePortLine('SIDECAR_PORT=99999')).toBeNull();
  });
});

describe('RotatingLog', () => {
  it('寫入與輪替（小上限加速）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sidelog-'));
    const log = new RotatingLog(dir, 'sidecar', 64, 3);
    for (let i = 0; i < 20; i++) log.write(`line-${i}-padding-padding-padding`);
    const files = readdirSync(dir);
    expect(files.length).toBeLessThanOrEqual(4); // .log + .1..3
    expect(files.some((f) => f === 'sidecar.log')).toBe(true);
  });
});

function fakeChild(): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: () => void;
  killed: boolean;
} {
  const c = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
    killed: boolean;
  };
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.killed = false;
  c.kill = () => {
    c.killed = true;
  };
  return c;
}

function fakeWs(): EventEmitter & {
  sent: string[];
  readyState: number;
  OPEN: number;
  send: (s: string) => void;
  close: () => void;
} {
  const w = new EventEmitter() as EventEmitter & {
    sent: string[];
    readyState: number;
    OPEN: number;
    send: (s: string) => void;
    close: () => void;
  };
  w.sent = [];
  w.readyState = 1;
  w.OPEN = 1;
  w.send = (s: string) => {
    w.sent.push(s);
  };
  w.close = () => {};
  return w;
}

describe('SidecarManager', () => {
  it('start → spawn 帶 token/port 0；stdout port 行 → 連 WS 並 auth', () => {
    const dir = mkdtempSync(join(tmpdir(), 'side-'));
    const child = fakeChild();
    const ws = fakeWs();
    const spawned: Array<{ cmd: string; args: string[] }> = [];
    const m = new SidecarManager({
      pythonPath: 'python',
      scriptPath: 'app.py',
      dataDir: dir,
      spawn: ((cmd: string, args: string[]) => {
        spawned.push({ cmd, args });
        return child as never;
      }) as never,
      connect: (() => ws as never) as never,
    });
    m.start();
    expect(m.status).toBe('starting');
    expect(spawned.length).toBe(1);
    expect(spawned[0]?.args).toContain('--port');
    expect(spawned[0]?.args).toContain('0');
    const ti = (spawned[0]?.args.indexOf('--token') ?? -1) + 1;
    expect(spawned[0]?.args[ti]).toMatch(/^[0-9a-f]{64}$/);

    child.stdout.emit('data', Buffer.from('booting\nSIDECAR_PORT=18765\n'));
    expect(ws.listeners('open').length).toBe(1);
    ws.emit('open');
    const auth = JSON.parse(ws.sent[0] ?? '{}') as { t: string; token: string };
    expect(auth.t).toBe('auth');
    expect(auth.token).toBe(spawned[0]?.args[ti]);

    ws.emit('message', JSON.stringify({ t: 'ready', version: '0.1' }));
    expect(m.status).toBe('online');
    m.stop();
    expect(m.status).toBe('stopped');
    expect(child.killed).toBe(true);
  });

  it('崩潰 → restarting，退避重啟；stop 後不再重啟', () => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), 'side-'));
    let launches = 0;
    const children: Array<ReturnType<typeof fakeChild>> = [];
    const m = new SidecarManager({
      pythonPath: 'python',
      scriptPath: 'app.py',
      dataDir: dir,
      spawn: (() => {
        launches += 1;
        const c = fakeChild();
        children.push(c);
        return c as never;
      }) as never,
      connect: (() => {
        throw new Error('nope');
      }) as never,
      setTimer: (cb, ms) => setTimeout(cb, ms),
      clearTimer: (h) => clearTimeout(h as never),
    });
    m.start();
    expect(launches).toBe(1);
    children[0]?.emit('exit', 1, null);
    expect(m.status).toBe('restarting');
    expect(m.restarts).toBe(1);
    expect(launches).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(launches).toBe(2);
    children[1]?.emit('exit', 1, null);
    vi.advanceTimersByTime(1000);
    expect(launches).toBe(2); // 第二次退避 2s，不夠
    vi.advanceTimersByTime(1000);
    expect(launches).toBe(3);
    m.stop();
    children[2]?.emit('exit', 1, null);
    vi.advanceTimersByTime(60000);
    expect(launches).toBe(3);
    vi.useRealTimers();
  });

  it('訊息路由：ready 以外轉發 message 事件；爛 JSON 丟棄', () => {
    const dir = mkdtempSync(join(tmpdir(), 'side-'));
    const got: unknown[] = [];
    const m = new SidecarManager({
      pythonPath: 'python',
      scriptPath: 'app.py',
      dataDir: dir,
      spawn: (() => fakeChild() as never) as never,
    });
    m.on('message', (x) => got.push(x));
    m.routeMessage('not json{{{');
    expect(got).toEqual([]);
    m.routeMessage(JSON.stringify({ t: 'stt.final', text: '嗨', at: 1 }));
    expect(got).toEqual([{ t: 'stt.final', text: '嗨', at: 1 }]);
  });

  it('未連線時 send 回 false', () => {
    const dir = mkdtempSync(join(tmpdir(), 'side-'));
    const m = new SidecarManager({
      pythonPath: 'python',
      scriptPath: 'app.py',
      dataDir: dir,
      spawn: (() => fakeChild() as never) as never,
    });
    expect(m.gpuStats()).toBe(false);
  });
});
