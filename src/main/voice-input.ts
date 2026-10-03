import { globalShortcut } from 'electron';
import type { AppConfig } from '../shared/config-schema.js';
import type { SidecarManager } from './sidecar.js';
import type { Conversation } from './llm/conversation.js';

/**
 * 語音輸入接線（main 端薄層，不可測部分集中於此）。
 * PTT 降級說明：Electron globalShortcut 沒有 key-up 事件，F9 只能做
 * 按一下開始、再按一下結束（toggle），非按住說話。VAD 模式不受影響。
 */
export interface VoiceInputDeps {
  getConfig: () => AppConfig;
  sidecar: () => SidecarManager | null;
  conversation: () => Conversation | null;
  sendRenderer: (channel: string, data: unknown) => void;
  notify: (text: string) => void;
}

export function registerVoiceHotkeys(deps: VoiceInputDeps): () => void {
  let pttOn = false;
  let mutedState = false;
  const cfg = deps.getConfig();

  const stopPtt = (): void => {
    if (!pttOn) return;
    pttOn = false;
    deps.sidecar()?.sttStop();
  };

  const togglePtt = (): void => {
    const sc = deps.sidecar();
    if (sc === null || sc.status !== 'online') {
      deps.notify('語音服務還沒好，等一下再試喔');
      return;
    }
    if (pttOn) {
      stopPtt();
    } else {
      pttOn = true;
      if (!sc.sttStart('ptt')) {
        pttOn = false;
        deps.notify('語音服務還沒好，等一下再試喔');
      }
    }
  };

  const toggleMute = (): void => {
    const conv = deps.conversation();
    if (conv === null) return;
    // main 端維護獨立旗標（設定頁會統一，階段 8）
    mutedState = !mutedState;
    conv.setMuted(mutedState);
    deps.sendRenderer('tts:cancel', {});
    deps.notify(mutedState ? '已靜音' : '取消靜音');
  };

  const cleanups: Array<() => void> = [];
  try {
    if (globalShortcut.register(cfg.hotkeys.ptt, togglePtt)) {
      cleanups.push(() => globalShortcut.unregister(cfg.hotkeys.ptt));
    } else {
      deps.notify(`快捷鍵 ${cfg.hotkeys.ptt} 被佔用了，語音要用設定頁換一個`);
    }
    if (globalShortcut.register(cfg.hotkeys.mute, toggleMute)) {
      cleanups.push(() => globalShortcut.unregister(cfg.hotkeys.mute));
    }
  } catch {
    // globalShortcut 不可用（如 Wayland）：VAD 模式仍可經設定頁啟用
  }
  return () => {
    stopPtt();
    for (const c of cleanups) {
      try {
        c();
      } catch {
        // 忽略
      }
    }
  };
}

/** VAD 模式：sidecar 上線後自動開始持續監聽。 */
export function startVadIfConfigured(deps: VoiceInputDeps): void {
  if (deps.getConfig().stt.mode !== 'vad') return;
  const sc = deps.sidecar();
  if (sc !== null && sc.status === 'online') sc.sttStart('vad');
}
