import { contextBridge, ipcRenderer } from 'electron';
import { IPC_DIRECTION, isAllowedChannel, type IpcChannel } from '../shared/ipc-channels.js';

/**
 * Preload 白名單橋接。renderer 只能用這裡暴露的 window.api。
 * - send：允許 r2m / both
 * - on：允許 m2r / both（回傳取消訂閱）
 * - invoke：僅 both（request/response 型）
 * 白名單外一律拋錯，不轉發。
 */
export interface RendererApi {
  send: (channel: string, data?: unknown) => void;
  on: (channel: string, cb: (data: unknown) => void) => () => void;
  invoke: (channel: string, data?: unknown) => Promise<unknown>;
}

function assertAllowed(channel: string): asserts channel is IpcChannel {
  if (!isAllowedChannel(channel)) {
    throw new Error(`blocked ipc channel: ${channel}`);
  }
}

const api: RendererApi = {
  send: (channel, data) => {
    assertAllowed(channel);
    const dir = IPC_DIRECTION[channel];
    if (dir !== 'r2m' && dir !== 'both') throw new Error(`channel not sendable: ${channel}`);
    ipcRenderer.send(channel, data);
  },
  on: (channel, cb) => {
    assertAllowed(channel);
    const dir = IPC_DIRECTION[channel];
    if (dir !== 'm2r' && dir !== 'both') throw new Error(`channel not subscribable: ${channel}`);
    const listener = (_e: unknown, data: unknown): void => cb(data);
    ipcRenderer.on(channel, listener as (...args: unknown[]) => void);
    return () => ipcRenderer.removeListener(channel, listener as (...args: unknown[]) => void);
  },
  invoke: (channel, data) => {
    assertAllowed(channel);
    const dir = IPC_DIRECTION[channel];
    if (dir !== 'both') throw new Error(`channel not invokable: ${channel}`);
    return ipcRenderer.invoke(channel, data);
  },
};

contextBridge.exposeInMainWorld('api', api);
