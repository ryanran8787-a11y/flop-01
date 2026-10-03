/**
 * 設定頁（settings.html 專用入口）。vanilla DOM，無框架。
 * 讀寫經 preload 白名單；無 electron 直引。
 */
import { HARDWARE_PRESETS } from '../../../shared/config-schema.js';
import { checkVram, estimateWhisperMiB, presetToPatch, recommendPreset } from '../../../shared/hardware.js';

interface Api {
  send: (ch: string, data?: unknown) => void;
  on: (ch: string, cb: (d: unknown) => void) => () => void;
  invoke: (ch: string, data?: unknown) => Promise<unknown>;
}

const rawApi = (window as unknown as { api?: Api }).api;
if (rawApi === undefined) {
  fail('preload 未就緒');
}
const api = rawApi as Api;
const app = document.getElementById('app') as HTMLElement;

type Config = Record<string, any>;

function fail(msg: string): void {
  app.innerHTML = `<h1>設定</h1><p class="err">${msg}</p>`;
}

if (api === undefined) {
  fail('preload 未就緒');
} else {
  void boot().catch((e) => fail(`載入失敗：${(e as Error).message}`));
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text) e.textContent = text;
  return e;
}

function section(title: string): HTMLElement {
  const s = el('section');
  s.appendChild(el('h2', {}, title));
  app.appendChild(s);
  return s;
}

function hint(parent: HTMLElement, text: string, cls = ''): HTMLElement {
  const d = el('div', { class: `hint ${cls}` }, text);
  parent.appendChild(d);
  return d;
}

function field(parent: HTMLElement, label: string, input: HTMLElement): void {
  parent.appendChild(el('label', {}, label));
  parent.appendChild(input);
}

function textInput(value: string): HTMLInputElement {
  const i = el('input', { type: 'text' }) as HTMLInputElement;
  i.value = value ?? '';
  return i;
}

function numInput(value: number, min?: number, max?: number): HTMLInputElement {
  const i = el('input', { type: 'number' }) as HTMLInputElement;
  i.value = String(value ?? 0);
  if (min !== undefined) i.min = String(min);
  if (max !== undefined) i.max = String(max);
  return i;
}

function selectInput(options: string[], value: string): HTMLSelectElement {
  const s = el('select') as HTMLSelectElement;
  for (const o of options) {
    const op = el('option', { value: o }, o) as HTMLOptionElement;
    if (o === value) op.selected = true;
    s.appendChild(op);
  }
  return s;
}

async function boot(): Promise<void> {
  const cfg = (await api.invoke('config:get')) as Config;
  app.innerHTML = '<h1>設定</h1>';
  const save = async (patch: Record<string, unknown>): Promise<Config> =>
    (await api.invoke('config:set', patch)) as Config;
  await Promise.all([
    buildOllama(save, cfg),
    buildWhisper(save, cfg),
    buildVoice(save, cfg),
    buildAvatar(save, cfg),
    buildPersona(save, cfg),
    buildHardware(save, cfg),
    buildMemory(),
  ]);
}

// ---------- 1. Ollama / LLM ----------

async function buildOllama(save: (p: Record<string, unknown>) => Promise<Config>, cfg: Config): Promise<void> {
  const s = section('語言模型（Ollama）');
  const url = textInput(cfg.ollamaUrl);
  field(s, 'Ollama 位址', url);
  url.addEventListener('change', () => void save({ ollamaUrl: url.value }));

  const row = el('div', { class: 'row' });
  const modelSel = el('select') as HTMLSelectElement;
  const manual = textInput(cfg.llmModel);
  manual.placeholder = '手動輸入（尚未下載的模型）';
  const reloadBtn = el('button', { class: 'ghost' }, '重新整理');
  row.append(modelSel, manual, reloadBtn);
  field(s, '本機已安裝模型', row);
  const status = hint(s, '');

  const profiles = (cfg.modelProfiles ?? {}) as Record<string, any>;
  const temp = numInput(0.7, 0, 2);
  const ctx = numInput(8192, 2048, 131072);
  const think = selectInput(['未設定', '開啟', '關閉'], '未設定');
  const prow = el('div', { class: 'row' });
  prow.append(temp, ctx, think);
  field(s, 'temperature / num_ctx / think（此模型獨立）', prow);

  const applyBtn = el('button', {}, '切換模型');
  s.appendChild(applyBtn);

  async function refresh(): Promise<void> {
    status.textContent = '讀取中…';
    status.className = 'hint';
    try {
      const r = (await api.invoke('llm:listModels')) as { models?: string[]; current?: string; error?: string };
      const models = r.models ?? [];
      modelSel.innerHTML = '';
      const cur = (r.current ?? cfg.llmModel) as string;
      // 首次啟動預設模型未安裝 → 顯示已安裝清單引導（不報錯）
      const list = models.includes(cur) ? models : [...models];
      if (list.length === 0) {
        modelSel.appendChild(el('option', { value: '' }, '（本機無模型，請先 ollama pull）'));
      }
      for (const m of list) {
        const op = el('option', { value: m }, m) as HTMLOptionElement;
        if (m === cur) op.selected = true;
        modelSel.appendChild(op);
      }
      manual.value = cur;
      loadProfile(cur);
      status.textContent = r.error !== undefined ? `Ollama 錯誤：${r.error}` : `目前：${cur}（共 ${models.length} 個）`;
      if (r.error !== undefined) status.classList.add('err');
    } catch (e) {
      status.textContent = `讀取失敗：${(e as Error).message}`;
      status.classList.add('err');
    }
  }

  function loadProfile(model: string): void {
    const p = profiles[model] ?? {};
    temp.value = String(p.temperature ?? 0.7);
    ctx.value = String(p.num_ctx ?? 8192);
    think.value = p.think === true ? '開啟' : p.think === false ? '關閉' : '未設定';
  }

  modelSel.addEventListener('change', () => {
    manual.value = modelSel.value;
    loadProfile(modelSel.value);
  });
  reloadBtn.addEventListener('click', () => void refresh());
  applyBtn.addEventListener('click', () => {
    const model = manual.value.trim();
    if (!model) return;
    const patch: Record<string, unknown> = {
      llmModel: model,
      modelProfiles: {
        ...profiles,
        [model]: {
          temperature: Number(temp.value),
          num_ctx: Number(ctx.value),
          ...(think.value === '開啟' ? { think: true } : think.value === '關閉' ? { think: false } : {}),
        },
      },
    };
    status.textContent = '切換中（思考中、釋放舊模型）…';
    void save(patch)
      .then(() => api.invoke('llm:switch', { model }))
      .then((r) => {
        const ok = (r as { ok?: boolean; error?: string }).ok === true;
        status.textContent = ok ? `已切換：${model}` : `切換失敗，已退回：${(r as { error?: string }).error ?? ''}`;
        status.className = `hint ${ok ? 'ok' : 'err'}`;
      })
      .catch((e) => {
        status.textContent = `切換失敗：${(e as Error).message}`;
        status.className = 'hint err';
      });
  });
  await refresh();
}

// ---------- 2. Whisper ----------

async function buildWhisper(save: (p: Record<string, unknown>) => Promise<Config>, cfg: Config): Promise<void> {
  const s = section('語音辨識（Whisper）');
  const sizes = ['tiny', 'base', 'small', 'medium', 'large-v3', 'large-v3-turbo'];
  const size = selectInput(sizes, cfg.whisper?.size ?? 'small');
  const device = selectInput(['cuda', 'cpu'], cfg.whisper?.device ?? 'cuda');
  const compute = selectInput(['float16', 'int8_float16', 'int8'], cfg.whisper?.compute ?? 'float16');
  const row = el('div', { class: 'row' });
  row.append(size, device, compute);
  field(s, '大小 / 裝置 / 精度', row);
  const applyBtn = el('button', {}, '重新載入');
  const cancelBtn = el('button', { class: 'ghost' }, '取消下載');
  const brow = el('div', { class: 'row' });
  brow.append(applyBtn, cancelBtn);
  s.appendChild(brow);
  const bar = el('progress', { max: '100', value: '0' }) as HTMLProgressElement;
  s.appendChild(bar);
  const status = hint(s, '');
  hint(s, '首次使用需下載模型（進度如上）；CUDA 不可用自動退 CPU int8 並提示。');

  const est = estimateWhisperMiB(size.value, compute.value);
  const estLine = hint(s, est !== null ? `估計 VRAM：約 ${(est / 1024).toFixed(1)}GB（估計值）` : '');
  const refreshEst = (): void => {
    const e = estimateWhisperMiB(size.value, compute.value);
    estLine.textContent = e !== null ? `估計 VRAM：約 ${(e / 1024).toFixed(1)}GB（估計值）` : '';
  };
  size.addEventListener('change', refreshEst);
  compute.addEventListener('change', refreshEst);

  applyBtn.addEventListener('click', () => {
    status.textContent = '載入中…';
    status.className = 'hint';
    void save({ whisper: { size: size.value, device: device.value, compute: compute.value } })
      .then(() => api.invoke('whisper:reload', { size: size.value, device: device.value, compute: compute.value }))
      .catch((e) => {
        status.textContent = `送出失敗：${(e as Error).message}`;
        status.className = 'hint err';
      });
  });
  cancelBtn.addEventListener('click', () => {
    void api.invoke('whisper:cancelDownload').catch(() => {});
  });
  api.on('whisper:progress', (d) => {
    const p = d as { pct?: number };
    bar.value = p.pct ?? 0;
    status.textContent = `下載/載入中… ${p.pct ?? 0}%`;
  });
  api.on('whisper:ready', (d) => {
    const r = d as { size?: string; device?: string; compute?: string };
    bar.value = 100;
    const fellBack = r.device !== device.value || r.compute !== compute.value;
    status.textContent = fellBack
      ? `已載入（退回）：${r.size} / ${r.device} / ${r.compute}（CUDA 不可用或載入失敗）`
      : `已載入：${r.size} / ${r.device} / ${r.compute}`;
    status.className = `hint ${fellBack ? 'warn' : 'ok'}`;
  });
  api.on('whisper:error', (d) => {
    const e = d as { code?: string; message?: string };
    status.textContent = `失敗，已保留上一組：${e.code ?? ''} ${e.message ?? ''}`;
    status.className = 'hint err';
  });
}

// ---------- 3. TTS / STT ----------

async function buildVoice(save: (p: Record<string, unknown>) => Promise<Config>, cfg: Config): Promise<void> {
  const s = section('語音合成 / 輸入');
  const voice = selectInput(
    ['zh-TW-HsiaoChenNeural', 'zh-CN-XiaoxiaoNeural'],
    cfg.ttsVoice ?? 'zh-TW-HsiaoChenNeural',
  );
  field(s, 'TTS 語音（需連網，斷網降級文字氣泡）', voice);
  voice.addEventListener('change', () => void save({ ttsVoice: voice.value }));
  const mode = selectInput(['ptt', 'vad'], cfg.stt?.mode ?? 'ptt');
  field(s, 'STT 模式（ptt=按鍵說話，vad=持續監聽）', mode);
  mode.addEventListener('change', () => void save({ stt: { mode: mode.value } }));
  const ptt = textInput(cfg.hotkeys?.ptt ?? 'F9');
  const mute = textInput(cfg.hotkeys?.mute ?? 'F10');
  const row = el('div', { class: 'row' });
  row.append(ptt, mute);
  field(s, '快捷鍵（說話 / 靜音；PTT 為 toggle，按一下開始再按一下結束）', row);
  const saveKeys = el('button', { class: 'ghost' }, '儲存快捷鍵');
  s.appendChild(saveKeys);
  saveKeys.addEventListener('click', () => void save({ hotkeys: { ptt: ptt.value, mute: mute.value } }));
}

// ---------- 4. 角色 / VRM ----------

async function buildAvatar(save: (p: Record<string, unknown>) => Promise<Config>, cfg: Config): Promise<void> {
  const s = section('角色');
  const backend = selectInput(['vrm', 'live2d-stub'], cfg.avatar?.backend ?? 'vrm');
  field(s, '渲染後端（live2d 僅 stub）', backend);
  backend.addEventListener('change', () => void save({ avatar: { backend: backend.value } }));
  const vrmPath = textInput(cfg.vrmPath ?? '');
  vrmPath.placeholder = 'asset://models/xxx.vrm';
  field(s, 'VRM（asset URL，切換即時生效，失敗保留原角色）', vrmPath);
  const brow = el('div', { class: 'row' });
  const browseBtn = el('button', {}, '選擇檔案…');
  const applyBtn = el('button', { class: 'ghost' }, '套用路徑');
  brow.append(browseBtn, applyBtn);
  s.appendChild(brow);
  const status = hint(s, '');
  browseBtn.addEventListener('click', () => {
    void api
      .invoke('vrm:browse')
      .then((r) => {
        const res = r as { ok?: boolean; url?: string };
        if (res.ok === true && typeof res.url === 'string') {
          vrmPath.value = res.url;
          return save({ vrmPath: res.url });
        }
        return undefined;
      })
      .then(() => {
        status.textContent = '已套用並即時切換';
        status.className = 'hint ok';
      })
      .catch((e) => {
        status.textContent = `失敗：${(e as Error).message}`;
        status.className = 'hint err';
      });
  });
  applyBtn.addEventListener('click', () => {
    if (!vrmPath.value.trim()) return;
    void save({ vrmPath: vrmPath.value.trim() }).catch((e) => {
      status.textContent = `失敗：${(e as Error).message}`;
      status.className = 'hint err';
    });
  });
  const fps = numInput(cfg.fpsCap ?? 60, 10, 120);
  field(s, 'FPS 上限', fps);
  fps.addEventListener('change', () => void save({ fpsCap: Number(fps.value) }));
}

// ---------- 5. 人設 ----------

async function buildPersona(save: (p: Record<string, unknown>) => Promise<Config>, cfg: Config): Promise<void> {
  const s = section('人設');
  const p = cfg.persona ?? {};
  const name = textInput(p.name ?? '');
  const userTitle = textInput(p.userTitle ?? '');
  const traits = textInput(p.traits ?? '');
  const speech = textInput(p.speech ?? '');
  const taboos = textInput(p.taboos ?? '');
  field(s, '名字', name);
  field(s, '對使用者的稱呼', userTitle);
  field(s, '性格', traits);
  field(s, '說話習慣', speech);
  field(s, '禁忌', taboos);
  const saveBtn = el('button', {}, '儲存人設');
  s.appendChild(saveBtn);
  const status = hint(s, '');
  saveBtn.addEventListener('click', () => {
    void save({
      persona: { name: name.value, userTitle: userTitle.value, traits: traits.value, speech: speech.value, taboos: taboos.value },
    })
      .then(() => {
        status.textContent = '已儲存（下輪對話生效）';
        status.className = 'hint ok';
      })
      .catch((e) => {
        status.textContent = `失敗：${(e as Error).message}`;
        status.className = 'hint err';
      });
  });
  const disturb = el('input', { type: 'checkbox' }) as HTMLInputElement;
  disturb.checked = cfg.disturb?.enabled !== false;
  const quiet = textInput(cfg.disturb?.quietHours ?? '23:00-08:00');
  field(s, '勿擾（勾選啟用）', disturb);
  field(s, '勿擾時段', quiet);
  const saveD = el('button', { class: 'ghost' }, '儲存勿擾');
  s.appendChild(saveD);
  saveD.addEventListener('click', () => {
    void save({ disturb: { enabled: disturb.checked, quietHours: quiet.value } }).catch(() => {});
  });
}

// ---------- 6. 硬體 / VRAM ----------

async function buildHardware(save: (p: Record<string, unknown>) => Promise<Config>, cfg: Config): Promise<void> {
  const s = section('顯示卡 / 記憶體');
  const info = hint(s, '讀取中…');
  const warnLine = hint(s, '');
  const btnRow = el('div', { class: 'row' });
  s.appendChild(btnRow);
  for (const p of HARDWARE_PRESETS) {
    const b = el('button', { class: 'ghost' }, `套用：${p.label}`) as HTMLButtonElement;
    b.title = p.note;
    b.addEventListener('click', () => {
      const patch = presetToPatch(p);
      void save({ llmModel: patch.llmModel, whisper: patch.whisper }).then(() => {
        warnLine.textContent = `已套用 ${p.label}（模型切換請到第 1 節按切換）`;
        warnLine.className = 'hint ok';
      });
    });
    btnRow.appendChild(b);
  }

  async function refresh(): Promise<void> {
    try {
      const st = (await api.invoke('system:stats')) as {
        gpu?: { vramTotalMiB?: number | null; vramUsedMiB?: number | null; hasNvidia?: boolean } | null;
        ollama?: Array<{ name?: string; sizeVram?: number }> | null;
        ollamaError?: string;
      };
      const g = st.gpu;
      const totalGB = g?.vramTotalMiB != null ? `${(g.vramTotalMiB / 1024).toFixed(1)}GB` : '未知';
      const usedGB = g?.vramUsedMiB != null ? `${(g.vramUsedMiB / 1024).toFixed(1)}GB` : '未知';
      const ollamaGB =
        st.ollama != null && st.ollama.length > 0
          ? st.ollama.map((m) => `${m.name}（${((m.sizeVram ?? 0) / 1024 / 1024 / 1024).toFixed(1)}GB）`).join('、')
          : st.ollamaError !== undefined
            ? `Ollama 未啟動：${st.ollamaError}`
            : '無載入模型';
      info.textContent = `GPU VRAM：${usedGB} / ${totalGB}；Ollama 載入：${ollamaGB}`;
      const rec = recommendPreset(g?.vramTotalMiB ?? null);
      const chk = checkVram(
        { llmModel: String(cfg.llmModel ?? ''), whisper: { size: String(cfg.whisper?.size ?? ''), compute: String(cfg.whisper?.compute ?? '') } },
        { vramTotalMiB: g?.vramTotalMiB ?? null },
      );
      warnLine.textContent = `${chk.message}推薦：${rec.label}。${rec.note}`;
      warnLine.className = `hint ${chk.warn ? 'warn' : ''}`;
    } catch (e) {
      info.textContent = `讀取失敗：${(e as Error).message}`;
    }
  }
  const rb = el('button', { class: 'ghost' }, '重新整理');
  s.appendChild(rb);
  rb.addEventListener('click', () => void refresh());
  await refresh();
}

// ---------- 7. 記憶 ----------

async function buildMemory(): Promise<void> {
  const s = section('長期記憶（本機 SQLite，不存密碼卡號）');
  const table = el('table');
  s.appendChild(table);
  const status = hint(s, '');

  async function refresh(): Promise<void> {
    const rows = (await api.invoke('memory:list', { limit: 200 })) as Array<{
      id: number;
      kind: string;
      fact: string;
    }>;
    table.innerHTML = '';
    const head = el('tr');
    head.append(el('th', {}, '種類'), el('th', {}, '內容'), el('th', {}, '操作'));
    table.appendChild(head);
    for (const r of rows) {
      const tr = el('tr');
      tr.appendChild(el('td', {}, r.kind));
      const input = el('input', { type: 'text', class: 'mem-input' }) as HTMLInputElement;
      input.value = r.fact;
      const td = el('td');
      td.appendChild(input);
      const ops = el('td');
      const saveB = el('button', { class: 'ghost' }, '存');
      saveB.addEventListener('click', () => {
        void api
          .invoke('memory:update', { id: r.id, fact: input.value })
          .then(() => void refresh())
          .catch((e) => {
            status.textContent = `儲存失敗：${(e as Error).message}`;
            status.className = 'hint err';
          });
      });
      const delB = el('button', { class: 'danger' }, '刪');
      delB.addEventListener('click', () => {
        void api
          .invoke('memory:delete', { id: r.id })
          .then(() => void refresh())
          .catch(() => {});
      });
      ops.append(saveB, delB);
      tr.append(td, ops);
      table.appendChild(tr);
    }
    status.textContent = `共 ${rows.length} 條`;
    status.className = 'hint';
  }

  const row = el('div', { class: 'row' });
  const rb = el('button', { class: 'ghost' }, '重新整理');
  const ex = el('button', { class: 'ghost' }, '匯出 JSON');
  row.append(rb, ex);
  s.appendChild(row);
  rb.addEventListener('click', () => void refresh());
  ex.addEventListener('click', () => {
    void api.invoke('memory:export').then((data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'memory-export.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
  });
  await refresh();
}
