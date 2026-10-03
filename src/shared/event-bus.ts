/**
 * 型別化 Event Bus。
 * - on/once/off/emit/emitAsync 全為泛型約束，事件名打錯會在編譯期報錯。
 * - handler 拋錯會被隔離（emit 不中斷其他 handler；emitAsync 收集後 throw AggregateError）。
 * - 用工廠 createEventBus() 建立實例，避免單例造成測試互相污染；
 *   需要全域時再自行建立一個並注入（不直接 import 實作模組）。
 */

export type Handler<T> = (payload: T) => void | Promise<void>;

export class EventBus<TMap extends Record<string, unknown>> {
  private handlers = new Map<keyof TMap, Set<Handler<TMap[keyof TMap]>>>();
  private onError: (err: unknown, event: keyof TMap) => void;

  constructor(opts?: { onError?: (err: unknown, event: keyof TMap) => void }) {
    this.onError = opts?.onError ?? (() => {});
  }

  on<K extends keyof TMap>(event: K, handler: Handler<TMap[K]>): () => void {
    let set = this.handlers.get(event);
    if (set === undefined) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<TMap[keyof TMap]>);
    return () => {
      this.off(event, handler);
    };
  }

  once<K extends keyof TMap>(event: K, handler: Handler<TMap[K]>): () => void {
    const wrapped: Handler<TMap[K]> = (payload) => {
      this.off(event, wrapped);
      return handler(payload);
    };
    return this.on(event, wrapped);
  }

  off<K extends keyof TMap>(event: K, handler: Handler<TMap[K]>): void {
    const set = this.handlers.get(event);
    if (set === undefined) return;
    set.delete(handler as Handler<TMap[keyof TMap]>);
    if (set.size === 0) this.handlers.delete(event);
  }

  /** 同步發射：依註冊順序呼叫；async handler 以 fire-and-forget 執行，錯誤經 onError 回報。 */
  emit<K extends keyof TMap>(event: K, payload: TMap[K]): void {
    const set = this.handlers.get(event);
    if (set === undefined || set.size === 0) return;
    for (const h of [...set]) {
      try {
        const r = (h as Handler<TMap[K]>)(payload);
        if (r instanceof Promise) {
          r.catch((err) => this.onError(err, event));
        }
      } catch (err) {
        this.onError(err, event);
      }
    }
  }

  /** 非同步發射：等待全部 handler（含 async），有錯則 throw AggregateError。 */
  async emitAsync<K extends keyof TMap>(event: K, payload: TMap[K]): Promise<void> {
    const set = this.handlers.get(event);
    if (set === undefined || set.size === 0) return;
    const errors: unknown[] = [];
    for (const h of [...set]) {
      try {
        await (h as Handler<TMap[K]>)(payload);
      } catch (err) {
        errors.push(err);
        this.onError(err, event);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `EventBus handler errors for "${String(event)}"`);
    }
  }

  listenerCount<K extends keyof TMap>(event: K): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}

export function createEventBus<TMap extends Record<string, unknown>>(opts?: {
  onError?: (err: unknown, event: keyof TMap) => void;
}): EventBus<TMap> {
  return new EventBus<TMap>(opts);
}
