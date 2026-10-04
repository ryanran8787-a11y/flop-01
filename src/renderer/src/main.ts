/**
 * Renderer 入口（階段 3）：舞台 + AvatarController + 主迴圈 + IPC 接線。
 * - 開機經 config:get 取 vrmPath/fpsCap；無 VRM 顯示佔位
 * - cursor:pos（視窗內相對座標）→ lookAtCursor（視線）
 * - 命中判定：raycast（VRM 全身或佔位，15Hz 節流 + 翻轉才送）；精確 head/body 分區在階段 4
 * - 渲染迴圈拖曳期間不中斷（拖曳只動視窗位置，本迴圈獨立跑）
 */
import * as THREE from 'three';
import { createEventBus } from '../../shared/event-bus.js';
import type { AppEventMap } from '../../shared/events.js';
import type { Action, Emotion, HitPart } from '../../shared/types.js';
import { AvatarController } from './avatar/avatar-controller.js';
import { Live2DRendererStub } from './live2d/live2d-stub.js';
import { Stage } from './avatar/stage.js';
import { GestureEngine } from './interaction/gestures.js';
import { InteractionController } from './interaction/interaction.js';
import { pickPart, refreshBodyProxy, toNdc, type PickProxies } from './interaction/picking.js';
import { RadialMenu } from './interaction/radial-menu.js';
import { TTSPlayer } from './audio/tts-player.js';
import { Bubble } from './ui/bubble.js';

interface PreloadApi {
  send: (ch: string, data?: unknown) => void;
  on: (ch: string, cb: (d: unknown) => void) => () => void;
  invoke: (ch: string, data?: unknown) => Promise<unknown>;
}

const api = (window as unknown as { api?: PreloadApi }).api;
const debug = document.getElementById('debug') as HTMLElement | null;
const lines: string[] = [];
const say = (s: string): void => {
  lines.push(s);
  while (lines.length > 3) lines.shift();
  if (debug !== null) debug.textContent = lines.join('\n');
};
// 每次載入都不同的開機 ID：重啟後若 ID 沒變，看到的就是殭屍視窗
const BOOT_ID = Math.random().toString(36).slice(2, 7);
say(`boot ${BOOT_ID}`);
window.addEventListener('error', (e) => {
  say(`頁面錯誤：${e.message}`);
});
window.addEventListener('unhandledrejection', (e) => {
  say(`未處理拒絕：${e.reason instanceof Error ? e.reason.message : String(e.reason)}`);
});

const bus = createEventBus<AppEventMap>();
const canvasEl = document.getElementById('scene') as HTMLCanvasElement | null;
if (canvasEl === null) throw new Error('缺 #scene canvas');
const canvas: HTMLCanvasElement = canvasEl;

const stage = new Stage(canvas, { fpsCap: 60 });
say('stage ok');
const avatar = new AvatarController(stage.scene, bus);
avatar.slideDistance = stage.offscreenDistance();
say('avatar ok');

let outfits: Array<{ id: string; name: string; vrmPath: string }> = [];
let muted = false;
const vrmProxies: PickProxies = { head: null, body: null };

function refreshProxies(): void {
  const root = avatar.hitRoot();
  if (root !== null) {
    vrmProxies.head = root.getObjectByName('__head_collider') ?? null;
    vrmProxies.body = refreshBodyProxy(root);
  } else {
    vrmProxies.head = null;
    vrmProxies.body = null;
  }
}

/** 建佔位（自身加防護：throw 也要留下錯誤字串，不許靜默）。 */
function safePlaceholder(reason: string): void {
  try {
    stage.showPlaceholder();
  } catch (err) {
    say(`佔位建立失敗：${(err as Error).message}`);
    return;
  }
  say(reason);
}

let viewport = { width: window.innerWidth, height: window.innerHeight };
window.addEventListener('resize', () => {
  viewport = { width: window.innerWidth, height: window.innerHeight };
  avatar.slideDistance = stage.offscreenDistance();
});

// IPC 接線
if (api !== undefined) {
  api.on('cursor:pos', (d) => {
    const p = d as { x: number; y: number };
    // 視窗穿透時 renderer 收不到視窗外滑鼠事件，故由 main 輪詢經此傳入
    avatar.lookAtCursor(p, viewport);
  });
  api.on('avatar:emotion', (d) => {
    avatar.setEmotion((d as { emotion: Emotion }).emotion);
  });
  api.on('avatar:action', (d) => {
    avatar.playAction((d as { action: Action }).action);
  });
  api.on('avatar:thinking', (d) => {
    const on = (d as { on?: boolean }).on === true;
    avatar.setThinking(on);
    say(on ? '思考中…' : '');
  });
  api.on('ui:notify', (d) => {
    bubble.show(String((d as { text?: unknown }).text ?? ''));
  });
  let lastVrmPath: string | null = null;
  interface BootCfg {
    vrmPath?: string;
    fpsCap?: number;
    outfits?: Array<{ id: string; name: string; vrmPath: string }>;
    avatar?: { backend?: string };
  }
  let cachedCfg: BootCfg | null = null;
  async function fetchConfig(): Promise<BootCfg> {
    const a = api;
    if (a === undefined) throw new Error('preload 未就緒');
    const timeout = new Promise<never>(
      (_res, rej) => setTimeout(() => rej(new Error('config:get 逾時（3s）')), 3000),
    );
    const cfg = (await Promise.race([a.invoke('config:get'), timeout])) as BootCfg;
    cachedCfg = cfg;
    return cfg;
  }
  async function loadFromConfig(): Promise<void> {
    let cfg: BootCfg;
    try {
      cfg = await fetchConfig();
    } catch (err) {
      // invoke 卡住也不擋開機：用快取或預設值繼續（placeholder 照出、按鈕照用）
      say(`config 讀取失敗，用預設值繼續：${(err as Error).message}`);
      cfg = cachedCfg ?? {};
    }
    if (cfg.avatar?.backend === 'live2d-stub') {
      // 預留介面驗證：stub 可實例化，但渲染仍走 VRM（不中斷使用）
      new Live2DRendererStub().dispose();
      say('Live2D 後端尚未實作，已退回 VRM 顯示');
    }
    if (typeof cfg.fpsCap === 'number') stage.setFpsCap(cfg.fpsCap);
    if (Array.isArray(cfg.outfits)) outfits = cfg.outfits;
    const vp = typeof cfg.vrmPath === 'string' && cfg.vrmPath.length > 0 ? cfg.vrmPath : null;
    if (vp === lastVrmPath) return;
    lastVrmPath = vp;
    if (vp === null) {
      safePlaceholder('尚未選擇 VRM（設定頁選擇後即時切換）');
      return;
    }
    try {
      await avatar.loadModel(vp);
      stage.hidePlaceholder();
      refreshProxies();
      avatar.slideDistance = stage.offscreenDistance();
      say('VRM 已載入');
    } catch (err) {
      safePlaceholder(`VRM 載入失敗，已保留原角色：${(err as Error).message}`);
    }
  }
  void loadFromConfig().catch((err) => {
    safePlaceholder(`config 讀取失敗：${(err as Error).message}`);
  });
  // 換裝（LLM outfitId / 設定頁）走 config vrmPath，renderer 自動重載
  api.on('config:onChanged', (d) => {
    const keys = (d as { keys?: unknown }).keys;
    if (Array.isArray(keys) && keys.includes('vrmPath')) {
      void loadFromConfig().catch(() => {});
    }
  });
} else {
  stage.showPlaceholder();
  say('preload 未就緒（瀏覽器直開除錯模式）');
}

// ---- TTS 播放 + 口型 ----
// 每句用新的 <audio>；MediaElementSource 只能綁一個 element，故每句重綁。
// AudioContext.resume 需手勢；overlay 無手勢時可能 suspended → analyser 全零、口型閉合（需驗證）。
const bubble = new Bubble(document);
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let mediaSrc: MediaElementAudioSourceNode | null = null;
let boundElement: HTMLAudioElement | null = null;

const ttsPlayer = new TTSPlayer({
  createAudio: () => {    const a = document.createElement('audio');
    ensureAnalyser(a);
    let target = '';
    return {
      get src(): string {
        return target;
      },
      set src(v: string) {
        target = v;
        a.src = v;
      },
      onended: null,
      onerror: null,
      play: () => a.play(),
      pause: () => a.pause(),
    };
  },
  onMouth: (v, w) => avatar.setMouth(v, w),
  onPlayingChange: (playing) => {
    api?.send('tts:notify', { playing });
  },
  onError: (id, msg) => say(`語音播放失敗（${id}）：${msg}`),
  // asset:// 經 fetch→blob 轉給 <audio>（file:// 在 dev/打包皆不可靠）
  resolveUrl: async (url) => {
    if (!url.startsWith('asset:')) return url;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`asset 載入失敗 ${res.status}`);
    return URL.createObjectURL(await res.blob());
  },
  revokeUrl: (url) => URL.revokeObjectURL(url),
});

function ensureAnalyser(audio: HTMLAudioElement): void {
  try {
    if (audioCtx === null) audioCtx = new AudioContext();
    void audioCtx.resume().catch(() => {});
    if (boundElement !== audio) {
      try {
        mediaSrc?.disconnect();
      } catch {
        // 忽略
      }
      mediaSrc = audioCtx.createMediaElementSource(audio);
      if (analyser === null) {
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.connect(audioCtx.destination);
      }
      mediaSrc.connect(analyser);
      boundElement = audio;
      const an = analyser;
      ttsPlayer.setAnalyser({
        binCount: an.frequencyBinCount,
        getData: (arr) => an.getByteFrequencyData(arr as Uint8Array<ArrayBuffer>),
      });
    }
  } catch {
    ttsPlayer.setAnalyser(null);
  }
}

if (api !== undefined) {
  api.on('tts:file', (d) => {
    const f = d as { id: string; path: string; url?: string };
    ttsPlayer.speakFile(f.id, f.url ?? f.path);
  });
  // TTS 斷網降級：只顯示文字氣泡（reply 文字由階段 7 的對話編排附帶，這裡先顯示錯誤）
  api.on('tts:error', (d) => {
    const e = d as { id: string; code: string; message: string };
    bubble.show(`語音暫時不可用（${e.code}），先用文字回你喔`);
    say(`tts.error ${e.code}: ${e.message}`);
  });
  api.on('tts:cancel', () => ttsPlayer.cancel());
  api.on('stt:bargein', () => ttsPlayer.cancel());
}
let outfitIndex = -1;

function probeHit(clientX: number, clientY: number): HitPart {  const active = avatar.hitRoot() !== null ? vrmProxies : stage.pickProxies();
  if (active.head === null && active.body === null) return 'none';
  const rect = canvas.getBoundingClientRect();
  return pickPart(toNdc(clientX, clientY, rect), stage.camera, active);
}

const menu = new RadialMenu(
  document,
  (id) => interaction.onMenuSelect(id),
  () => {
    // 選單關閉：強制下一次 mousemove 重算穿透（恢復穿透）
    lastProbe = 0;
  },
);
const engine = new GestureEngine((g) => interaction.onGesture(g));
const interaction = new InteractionController(avatar, {
  sendDrag: (dx, dy) => api?.send('win:dragMove', { dx, dy }),
  probeHit,
  menu,
  muted: () => muted,
  onMenuOpened: () => {
    // 選單開著時強制接收事件（按鈕多在透明區，否則 click 被穿透吃掉）
    api?.send('win:hitTest', { hit: true });
    lastHit = true;
  },
  onOutfit: () => {
    if (outfits.length === 0) {
      say('沒有可用換裝（在設定頁加入 outfits，階段 8）');
      return;
    }
    outfitIndex = (outfitIndex + 1) % outfits.length;
    const next = outfits[outfitIndex];
    if (next === undefined) return;
    say(`換裝：${next.name}…`);
    void avatar.loadModel(next.vrmPath).then(
      () => {
        stage.hidePlaceholder();
        refreshProxies();
        avatar.slideDistance = stage.offscreenDistance();
        say(`換裝：${next.name}`);
      },
      (err) => say(`換裝失敗，已保留原角色：${(err as Error).message}`),
    );
  },
  onSettings: () => api?.send('win:showSettings'),
  onToggleMute: () => {
    muted = !muted;
    if (muted) ttsPlayer.cancel();
    say(muted ? '已靜音' : '取消靜音');
  },
  onLeave: () => avatar.playAction('leave'),
});

// DOM 指標事件 → 手勢引擎（pointer capture 保證拖出窗外仍收到 move）
canvas.addEventListener('pointerdown', (e) => {
  menu.close();
  canvas.setPointerCapture(e.pointerId);
  engine.down(e.clientX, e.clientY, performance.now());
  idleTimer = 0;
  stage.setIdle(false);
});
canvas.addEventListener('pointermove', (e) => {
  engine.move(e.clientX, e.clientY, performance.now());
});
const endPointer = (e: PointerEvent): void => {
  engine.up(e.clientX, e.clientY, performance.now());
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', () => engine.cancel());

// 穿透探針：命中變化才送 main（15Hz 節流，碰撞體-only）
let lastHit = false;
let lastProbe = 0;
document.addEventListener('mousemove', (e) => {
  if (api === undefined || menu.isOpen) return; // 選單開著時保持接收事件
  const now = performance.now();
  if (now - lastProbe < 66) return;
  lastProbe = now;
  const hit = probeHit(e.clientX, e.clientY) !== 'none';
  if (hit !== lastHit) {
    lastHit = hit;
    api.send('win:hitTest', { hit });
  }
});

// 主迴圈
let last = performance.now();
let idleTimer = 0;
function loop(now: number): void {
  requestAnimationFrame(loop);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  engine.tick(now);
  avatar.update(dt);
  ttsPlayer.update(dt);
  stage.render(now);
  idleTimer += dt;
  if (idleTimer > 5) {
    stage.setIdle(true);
  }
}
requestAnimationFrame(loop);
