# Python sidecar：STT（faster-whisper）+ TTS（edge-tts）+ GPU（pynvml）

本機 WebSocket 控制面，Electron main 啟動並持有 token。

## 環境

```bat
cd sidecar
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## 手動啟動（main 會自動做，這裡只供除錯）

```bat
python app.py --host 127.0.0.1 --port 0 --token debug --data-dir %APPDATA%\desktop-ai-companion
```

看到 `SIDECAR_PORT=<port>` + `SIDECAR_READY` 即成功；首訊必須是
`{"t":"auth","token":"…"}`，否則斷線。

## Whisper 模型

- 首次使用自動從 Hugging Face 下載到 `<data-dir>/whisper-models/<size>`，
  進度經 `whisper.progress` 回報，可 `whisper.cancelDownload` 取消。
- 大小→repo 對照見 `whisper_models.py`（抄自 faster-whisper 1.2.1 `_MODELS`）。
- 要求 cuda 但無裝置 → 自動退回 `cpu/int8`（以 `whisper.ready` 實際值為準）。

## TTS

- 合成 mp3 到 `<data-dir>/tts/`，經 `tts.file` 回傳路徑，由 renderer `<audio>` 播放。
- edge-tts 需連網；斷網回 `tts.error {code: offline}`，上層降級顯示文字氣泡。

## 回音/打斷

- 播放中暫停收音由 `tts.notify {playing}` 驅動（renderer 在階段 6 回報實際播放狀態）。
- VAD 模式播放中提高能量門檻，觸發即送 `stt.bargein`；PTT 按鍵本身即打斷。
- 精確 AEC 留待後續，屬近似方案。
