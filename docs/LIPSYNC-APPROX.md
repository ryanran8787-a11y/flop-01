# 口型同步：近似方案說明

本專案的口型是**啟發式近似**，不是音素對齊。

## 做法

1. TTS 音檔由 renderer `<audio>` 播放，經 `MediaElementSource → AnalyserNode（fftSize 1024）` 取頻譜。
2. 每幀取 `getByteFrequencyData`（512 bins），算四個頻段均值：
   low 150–500 / mid1 500–1000 / mid2 1000–2500 / hi 2500–6000 Hz。
3. 整體能量過噪音閘（預設 0.08）才開口；按頻段比例分配
   aa（中頻）/ ee·ih（高頻）/ oh·ou（低頻）。
4. attack 40ms / release 100ms 指數平滑；每幀只送**主導 viseme**（配
   ExpressionController 的嘴部獨寫語義）；播放結束送 `closed`。

## 已知限制

- 不分語言、不認音素；清輔音（s/sh）易誤判 ee；背景音樂會帶偏。
- `AudioContext.resume()` 在 overlay 無手勢時可能保持 suspended，
  此時頻譜全零、嘴巴全程閉合（有聲無口型）。
- 每句新建 `<audio>` + 重綁 MediaElementSource（同 element 不可重複綁）。

## 降級

`LipSyncMapper(simple: true)`：只用整體音量驅動 `aa`。
下列情況自動視為降級：無 analyser（AudioContext 建不起）、能量全零。
TTS 斷網（`tts.error offline`）時不播聲音，只顯示文字氣泡。
