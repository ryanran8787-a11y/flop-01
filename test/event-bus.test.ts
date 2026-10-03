import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../src/shared/event-bus.js';
import type { AppEventMap } from '../src/shared/events.js';

describe('EventBus 基本收發', () => {
  it('on + emit 可收到 payload', () => {
    const bus = createEventBus<AppEventMap>();
    const seen: unknown[] = [];
    bus.on('avatar.emotion', (p) => {
      seen.push(p);
    });
    bus.emit('avatar.emotion', { emotion: 'happy' });
    expect(seen).toEqual([{ emotion: 'happy' }]);
  });

  it('回傳的 unsubscribe 可取消訂閱', () => {
    const bus = createEventBus<AppEventMap>();
    let n = 0;
    const off = bus.on('tts.end', () => {
      n += 1;
    });
    bus.emit('tts.end', { reason: 'finished' });
    off();
    bus.emit('tts.end', { reason: 'finished' });
    expect(n).toBe(1);
  });

  it('once 只觸發一次', () => {
    const bus = createEventBus<AppEventMap>();
    let n = 0;
    bus.once('avatar.action', () => {
      n += 1;
    });
    bus.emit('avatar.action', { action: 'nod' });
    bus.emit('avatar.action', { action: 'wave' });
    expect(n).toBe(1);
  });

  it('不同事件互不干擾', () => {
    const bus = createEventBus<AppEventMap>();
    let a = 0;
    let b = 0;
    bus.on('avatar.action', () => {
      a += 1;
    });
    bus.on('avatar.emotion', () => {
      b += 1;
    });
    bus.emit('avatar.action', { action: 'nod' });
    expect(a).toBe(1);
    expect(b).toBe(0);
  });

  it('多個 handler 依註冊順序執行', () => {
    const bus = createEventBus<AppEventMap>();
    const order: number[] = [];
    bus.on('cursor.pos', () => {
      order.push(1);
    });
    bus.on('cursor.pos', () => {
      order.push(2);
    });
    bus.emit('cursor.pos', { x: 1, y: 2, at: 0 });
    expect(order).toEqual([1, 2]);
  });

  it('listenerCount / clear', () => {
    const bus = createEventBus<AppEventMap>();
    expect(bus.listenerCount('gpu.stats')).toBe(0);
    bus.on('gpu.stats', () => {});
    bus.on('gpu.stats', () => {});
    expect(bus.listenerCount('gpu.stats')).toBe(2);
    bus.clear();
    expect(bus.listenerCount('gpu.stats')).toBe(0);
  });
});

describe('EventBus 錯誤隔離', () => {
  it('emit：某 handler 丟錯不中斷其他人，並經 onError 回報', () => {
    const onError = vi.fn();
    const bus = createEventBus<AppEventMap>({ onError });
    const calls: string[] = [];
    bus.on('llm.error', () => {
      throw new Error('boom');
    });
    bus.on('llm.error', () => {
      calls.push('second');
    });
    bus.emit('llm.error', { code: 'ollama-offline', message: 'x' });
    expect(calls).toEqual(['second']);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('emitAsync：全部等待，錯誤彙總為 AggregateError', async () => {
    const bus = createEventBus<AppEventMap>();
    const order: string[] = [];
    bus.on('config.changed', async () => {
      order.push('a');
      throw new Error('bad-a');
    });
    bus.on('config.changed', async () => {
      order.push('b');
    });
    await expect(bus.emitAsync('config.changed', { keys: ['llmModel'] })).rejects.toBeInstanceOf(
      AggregateError,
    );
    expect(order).toEqual(['a', 'b']);
  });

  it('emitAsync 無 handler 時直接 resolve', async () => {
    const bus = createEventBus<AppEventMap>();
    await expect(bus.emitAsync('fps.mode', { mode: 'idle' })).resolves.toBeUndefined();
  });
});
