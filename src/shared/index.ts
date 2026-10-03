/**
 * shared 模組公開入口。
 * main / renderer 只從這裡 import 型別與 EventBus，不得深路徑 import 彼此實作。
 */
export * from './types.js';
export * from './events.js';
export * from './ipc-channels.js';
export * from './config-schema.js';
export * from './protocol.js';
export * from './providers.js';
export * from './event-bus.js';
export * from './geometry.js';
export * from './hardware.js';
