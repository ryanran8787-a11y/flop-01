# 3D 桌面 AI 虛擬伴侶（Windows）

透明 overlay 角色 + 語音對話 + 長期記憶。Electron + Three.js/VRM + Python sidecar + Ollama。

## 前置

1. **Ollama**：安裝並啟動（預設 `http://127.0.0.1:11434`），至少 `ollama pull qwen3:8b` 一個模型。
2. **Python 3.12**（語音用）：
   ```bat
   cd sidecar
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   ```
   main 預設用 `python` 指令；若找不到請確認 PATH。
3. **Node**：`npm install`。

## 開發執行

```bat
npm run dev     :: electron-vite dev（需 Electron 二進位首次下載）
npm test        :: vitest 全量
npm run typecheck
python sidecar/tests/test_sidecar.py
```

## 首次啟動

1. 角色區顯示佔位 → 系統匣/環形選單開**設定** → 選本機 VRM（自動複製進使用者目錄，即時切換）。
2. 設定頁第 1 節從已安裝模型下拉選擇（預設模型未安裝不會報錯，引導選擇）。
3. PTT 預設 F9（toggle：按一下開始、再按一下結束；globalShortcut 無 key-up 如實降級），VAD 可切持續監聽。
4. 無 NVIDIA 時 CUDA 選項隱藏並走 CPU 預設；VRAM 超標只警告不阻擋（皆為估計值）。

## 打包

```bat
npm run dist
```

注意：`better-sqlite3` 需對 Electron ABI 重編（`npmRebuild`，需驗證目標機流程）；
sidecar 以 extraResources 帶出；圖示在 `assets/`（`scripts/make-icons.mjs` 可重生）。

## 文件

- `docs/LIPSYNC-APPROX.md`：口型近似方案聲明
- `sidecar/README.md`：語音服務細節
- 各階段「需驗證」集中在真機行為（穿透轉發、異 DPI、Ollama 模型名、打包路徑）。
