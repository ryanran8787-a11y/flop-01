import { app, BrowserWindow, nativeImage, screen, session, Tray } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppConfigSchema, type AppConfig } from '../shared/config-schema.js';
import { getConfigPath, loadConfigFromFile } from './config-store.js';
import { ensureSingleInstance } from './single-instance.js';
import { createMainWindow, createSettingsWindow } from './window.js';
import { registerSettingsOpener, registerWindowIpc } from './window-ipc.js';
import { HitTestState } from './hit-test.js';
import { startCursorPoll } from './cursor-poller.js';
import { buildCsp } from './csp.js';
import { SidecarManager } from './sidecar.js';
import { registerAssetPrivileges, startAssetProtocol } from './asset-protocol.js';
import { toAssetUrl } from './asset-paths.js';
import { registerConfigIpc } from './config-ipc.js';
import { bridgeSidecarToRenderer, registerVoiceIpc } from './voice-bridge.js';
import { registerMemoryIpc } from './memory/memory-ipc.js';
import { SqliteMemory } from './memory/store.js';
import { OllamaClient } from './ollama.js';
import { OllamaLLM } from './llm/llm-provider.js';
import { Conversation } from './llm/conversation.js';
import { registerLlmIpc } from './llm-ipc.js';
import { registerStatsIpc } from './stats.js';
import { registerModelIpc } from './model-files.js';
import { patchConfigFile } from './config-store.js';
import { registerVoiceHotkeys, startVadIfConfigured } from './voice-input.js';
import { shouldProactive } from './proactive.js';
import { createTray } from './tray.js';
import { resolvePreloadPath } from './preload-path.js';

registerAssetPrivileges();

let mainWin: BrowserWindow | null = null;
let cfg: AppConfig = AppConfigSchema.parse({});
const hit = new HitTestState();
let sidecar: SidecarManager | null = null;
let conversation: Conversation | null = null;
let ollamaLlm: OllamaLLM | null = null;
let memory: SqliteMemory | null = null;
let unregisterHotkeys: (() => void) | null = null;
let settingsWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let mainMuted = false;

function sendRenderer(channel: string, data: unknown): void {
  if (mainWin !== null && !mainWin.isDestroyed()) {
    mainWin.webContents.send(channel, data);
  }
}

function notify(text: string): void {
  sendRenderer('ui:notify', { text });
}

function applyCsp(): void {
  const csp = buildCsp(new URL(cfg.ollamaUrl).origin, process.env['NODE_ENV'] === 'development');
  void session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}

function boot(): void {
  const userData = app.getPath('userData');
  cfg = loadConfigFromFile(getConfigPath(userData));
  applyCsp();

  const preloadPath = resolvePreloadPath(__dirname);
  mainWin = createMainWindow(cfg, { preloadPath });
  registerWindowIpc(mainWin, hit, cfg);
  registerConfigIpc(() => mainWin);
  startAssetProtocol(userData);

  const showSettings = (): void => {
    if (settingsWin !== null && !settingsWin.isDestroyed()) {
      settingsWin.focus();
      return;
    }
    settingsWin = createSettingsWindow(preloadPath);
    settingsWin.on('closed', () => {
      settingsWin = null;
    });
  };
  registerSettingsOpener(showSettings);

  // 系統匣（圖示：dev 用專案 assets，打包用 resources）
  const iconCandidates = [
    join(__dirname, '../../assets/tray.png'),
    join(process.resourcesPath, 'assets/tray.png'),
  ];
  const iconPath = iconCandidates.find((p) => existsSync(p));
  if (iconPath !== undefined) {
    tray = createTray(nativeImage.createFromPath(iconPath), mainWin, {
      onToggleShow: () => {},
      onOpenSettings: showSettings,
      onToggleMute: () => {
        mainMuted = !mainMuted;
        conversation?.setMuted(mainMuted);
        sendRenderer('tts:cancel', {});
      },
      onLeave: () => sendRenderer('avatar:action', { action: 'leave' }),
      onQuit: () => {},
    });
  }

  // 需驗證：打包後 sidecar 腳本位置（extraResources）與 dev 路徑差異
  const candidates = [
    join(__dirname, '../../sidecar/app.py'), // electron-vite dev（out/main → 專案根）
    join(process.resourcesPath, 'sidecar/app.py'), // 打包後 extraResources
  ];
  const script = candidates.find((p) => existsSync(p));
  if (script !== undefined) {
    sidecar = new SidecarManager({
      pythonPath: 'python',
      scriptPath: script,
      dataDir: userData,
      initialWhisper: {
        size: cfg.whisper.size,
        device: cfg.whisper.device,
        compute: cfg.whisper.compute,
      },
    });
    sidecar.on('status', (s) => {
      if (mainWin !== null && !mainWin.isDestroyed()) {
        mainWin.webContents.send('sidecar:status', { online: s === 'online', restarts: sidecar?.restarts ?? 0 });
      }
      if (s === 'online') {
        startVadIfConfigured({
          getConfig: () => cfg,
          sidecar: () => sidecar,
          conversation: () => conversation,
          sendRenderer,
          notify,
        });
      }
    });
    bridgeSidecarToRenderer(sidecar, () => mainWin, (p) => toAssetUrl(p, userData));
    registerVoiceIpc(sidecar);
    sidecar.start();
  } else {
    // eslint-disable-next-line no-console
    console.warn('[sidecar] 找不到 app.py，語音功能停用（其餘功能正常）');
  }

  // ---- 對話層 ----
  memory = new SqliteMemory(join(userData, 'memory.db'));
  const ollama = new OllamaClient(cfg.ollamaUrl);
  ollamaLlm = new OllamaLLM(ollama, () => cfg);
  const memRef = memory;
  conversation = new Conversation({
    llm: ollamaLlm,
    mem: memRef,
    getConfig: () => cfg,
    sidecar: {
      on: (event, cb) => {
        sidecar?.on(event, cb);
      },
      ttsSpeak: (id, text, voice) => sidecar?.ttsSpeak(id, text, voice) ?? false,
      ttsCancel: () => sidecar?.ttsCancel() ?? false,
    },
    sendRenderer,
    setVrmPath: (path) => {
      cfg = patchConfigFile(getConfigPath(userData), { vrmPath: path });
      sendRenderer('config:onChanged', { keys: ['vrmPath', 'outfits'] });
    },
    notify,
  });
  registerMemoryIpc(() => memRef);
  registerStatsIpc(() => ({ sidecar, ollama }));
  registerModelIpc(() => userData);
  registerLlmIpc(
    () => ollamaLlm,
    () => cfg,
    (model) => {
      cfg = patchConfigFile(getConfigPath(userData), { llmModel: model });
      ollamaLlm?.refreshFromConfig();
    },
    (on) => sendRenderer('avatar:thinking', { on }),
  );
  unregisterHotkeys = registerVoiceHotkeys({
    getConfig: () => cfg,
    sidecar: () => sidecar,
    conversation: () => conversation,
    sendRenderer,
    notify,
  });

  // 主動搭話（5 分鐘檢查一次；頻率上限 + 勿擾由 shouldProactive 把關）
  const proactiveTimer = setInterval(
    () => {
      const conv = conversation;
      if (conv === null || conv.isBusy) return;
      if (
        shouldProactive({
          now: new Date(),
          lastUserAt: conv.lastUserAt,
          lastProactiveAt: conv.lastProactiveAt,
          quietHours: cfg.disturb.quietHours,
          disturbEnabled: cfg.disturb.enabled,
          canProactive: true,
        })
      ) {
        void conv.proactive('（系統提示：使用者安靜一陣子了，用一句話自然地關心一下，不要提到系統提示。）');
      }
    },
    5 * 60 * 1000,
  );
  const pt = proactiveTimer as unknown as { unref?: () => void };
  pt.unref?.();

  // 游標輪詢 45Hz → renderer（視線/命中判定用；送視窗內相對座標）
  startCursorPoll(
    {
      getCursorPoint: () => screen.getCursorScreenPoint(),
      getOrigin: () => {
        if (mainWin === null || mainWin.isDestroyed()) return { x: 0, y: 0 };
        const pos = mainWin.getPosition();
        return { x: pos[0] ?? 0, y: pos[1] ?? 0 };
      },
      send: (pos) => {
        if (mainWin !== null && !mainWin.isDestroyed()) {
          mainWin.webContents.send('cursor:pos', pos);
        }
      },
    },
    45,
  );

  // 系統匣接線在托盤圖示確定後補全（階段 2 驗收以 API 存在為準，不阻塞）。
  // TODO: 傳入 NativeImage + extra callbacks 呼叫 createTray。
}

const primary = ensureSingleInstance(
  {
    requestSingleInstanceLock: () => app.requestSingleInstanceLock(),
    onSecondInstance: (cb) => app.on('second-instance', cb),
    quit: () => app.quit(),
  },
  () => {
    if (mainWin !== null && !mainWin.isDestroyed()) {
      if (!mainWin.isVisible()) mainWin.show();
      mainWin.focus();
    }
  },
);
if (!primary) {
  // 第二實例直接退出（ensureSingleInstance 已 quit）
} else {
  void app.whenReady().then(boot);
  app.on('window-all-closed', () => {
    // overlay 常駐：全關也不退出（由匣結束）
  });
  app.on('before-quit', () => {
    try {
      unregisterHotkeys?.();
    } catch {
      // 忽略
    }
    try {
      memory?.close();
    } catch {
      // 忽略
    }
    sidecar?.stop();
  });
}
