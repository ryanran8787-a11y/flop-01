"""麥克風擷取 + VAD 切分 + 回音閘（sounddevice/numpy 延遲 import）。

模式：
- ptt：start() 錄、stop() 結束並回傳整段 PCM（打斷語音由按鍵本身表達）。
- vad：連續錄，尾端靜音 ≥0.8s 且語音 ≥0.5s 即切段回傳；播放中（tts_playing）
  提高門檻並要求 ≥0.3s 語音，觸發 barge-in（近似回音抑制；精確 AEC 留待後續）。

實作說明：能量門檻啟動時自動量測 1s 底噪；faster-whisper 的 vad_filter
在轉錄時再做一次 Silero 過濾，此處只負責切分。
"""
from __future__ import annotations

import queue
import threading
import time
from dataclasses import dataclass, field

SAMPLE_RATE = 16000
FRAME_MS = 30
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000  # 480


@dataclass
class Segmenter:
    silence_need_s: float = 0.8
    speech_need_s: float = 0.5
    barge_speech_need_s: float = 0.3
    noise_floor: float = 300.0
    _buf: bytearray = field(default_factory=bytearray, repr=False)
    _silence_s: float = 0.0
    _speech_s: float = 0.0

    def reset(self) -> None:
        self._buf = bytearray()
        self._silence_s = 0.0
        self._speech_s = 0.0

    def feed(self, pcm16: bytes, tts_playing: bool) -> bytes | None:
        """餵一幀；回傳切好的段（bytes）或 None。barge 由呼叫方另行判斷。"""
        import numpy as np

        frame = np.frombuffer(pcm16, dtype=np.int16).astype(float)
        rms = float((frame**2).mean() ** 0.5) if len(frame) else 0.0
        thresh = self.noise_floor * (3.0 if tts_playing else 1.8)
        is_speech = rms > thresh
        self._buf += pcm16
        if is_speech:
            self._speech_s += FRAME_MS / 1000.0
            self._silence_s = 0.0
        else:
            self._silence_s += FRAME_MS / 1000.0
        need_speech = self.barge_speech_need_s if tts_playing else self.speech_need_s
        if self._speech_s >= need_speech and self._silence_s >= self.silence_need_s:
            out = bytes(self._buf)
            self.reset()
            return out
        # 防爆：單段超過 30s 強制切
        if len(self._buf) > SAMPLE_RATE * 30 * 2:
            out = bytes(self._buf)
            self.reset()
            return out
        return None

    def is_barge(self, pcm16: bytes) -> bool:
        import numpy as np

        frame = np.frombuffer(pcm16, dtype=np.int16).astype(float)
        rms = float((frame**2).mean() ** 0.5) if len(frame) else 0.0
        return rms > self.noise_floor * 3.0


class MicRecorder:
    """sounddevice 輸入串流封裝。無裝置/被拒時 raise MicError（main 轉 stt.error）。"""

    def __init__(self) -> None:
        self._q: queue.Queue[bytes] = queue.Queue()
        self._stream: object | None = None
        self._stop = threading.Event()

    def start(self) -> None:
        try:
            import sounddevice as sd
        except Exception as e:
            raise MicError(f"sounddevice 不可用：{e}")
        try:
            self._stop.clear()
            self._stream = sd.InputStream(
                samplerate=SAMPLE_RATE, channels=1, dtype="int16",
                blocksize=FRAME_SAMPLES, callback=self._cb,
            )
            self._stream.start()  # type: ignore[attr-defined]
        except Exception as e:
            raise MicError(f"麥克風開啟失敗（可能被拒或無裝置）：{e}")

    def _cb(self, indata: object, frames: int, time_info: object, status: object) -> None:
        try:
            import numpy as np

            arr = np.asarray(indata)
            self._q.put(bytes(arr.tobytes()))
        except Exception:
            pass

    def read_frame(self, timeout: float = 1.0) -> bytes | None:
        try:
            return self._q.get(timeout=timeout)
        except queue.Empty:
            return None

    def calibrate(self, seconds: float = 1.0) -> float:
        """量測底噪 RMS（呼叫前需 start）。"""
        import numpy as np

        vals: list[float] = []
        deadline = time.time() + seconds
        while time.time() < deadline:
            f = self.read_frame(timeout=0.2)
            if f:
                a = np.frombuffer(f, dtype=np.int16).astype(float)
                vals.append(float((a**2).mean() ** 0.5))
        return max(150.0, (sum(vals) / len(vals) if vals else 300.0))

    def stop(self) -> None:
        self._stop.set()
        try:
            if self._stream is not None:
                self._stream.stop()  # type: ignore[attr-defined]
                self._stream.close()  # type: ignore[attr-defined]
        except Exception:
            pass
        self._stream = None


class MicError(Exception):
    pass
