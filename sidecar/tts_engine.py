"""Edge-TTS 合成到本機 mp3（renderer <audio> 播放，供 AnalyserNode 口型用）。

失敗分類：連線類 → offline；其餘 → failed（附原始訊息）。
edge-tts 需連網；斷網降級由 main/renderer 顯示文字氣泡（階段 6/7）。
"""
from __future__ import annotations

import asyncio
import os
import uuid


def classify_error(e: Exception) -> str:
    name = type(e).__name__
    msg = str(e).lower()
    network_markers = (
        "connect", "network", "timeout", "unreachable", "dns",
        "ClientConnectorError".lower(), "WebSocketError".lower(),
        "ssl", "socket",
    )
    if name in ("ClientConnectorError", "ClientConnectionError", "WebSocketError",
                "TimeoutError", "ConnectionError", "OSError") or any(m in msg for m in network_markers):
        return "offline"
    return "failed"


async def _synthesize(text: str, voice: string, out_path: str) -> None:
    try:
        import edge_tts  # type: ignore  # noqa: PLC0415
    except Exception as e:
        raise RuntimeError(f"edge-tts 不可用：{e}")
    # 需驗證：Communicate(text, voice).save(path)（7.2.8 已核實存在）
    await edge_tts.Communicate(text, voice).save(out_path)


def synthesize(text: str, voice: str, out_dir: str, timeout_s: float = 30.0) -> str:
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"tts-{uuid.uuid4().hex}.mp3")
    try:
        asyncio.run(asyncio.wait_for(_synthesize(text, voice, path), timeout_s))
    except Exception as e:
        try:
            if os.path.exists(path):
                os.remove(path)
        except Exception:
            pass
        code = classify_error(e) if not isinstance(e, RuntimeError) else "failed"
        raise TTSError(code, str(e) or type(e).__name__)
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        raise TTSError("failed", "no audio received")
    return path


class TTSError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
