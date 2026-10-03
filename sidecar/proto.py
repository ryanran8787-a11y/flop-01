"""WS 控制面訊息建構與基本驗證（只用標準庫，可獨立測試）。"""
from __future__ import annotations

import time
from typing import Any


def now_ms() -> int:
    return int(time.time() * 1000)


def stt_final(text: str) -> dict[str, Any]:
    return {"t": "stt.final", "text": text, "at": now_ms()}


def stt_error(code: str, message: str) -> dict[str, Any]:
    return {"t": "stt.error", "code": code, "message": message}


def stt_state(listening: bool, mode: str) -> dict[str, Any]:
    return {"t": "stt.state", "listening": listening, "mode": mode}


def stt_bargein() -> dict[str, Any]:
    return {"t": "stt.bargein", "at": now_ms()}


def tts_file_msg(uid: str, path: str) -> dict[str, Any]:
    return {"t": "tts.file", "id": uid, "path": path}


def tts_error(uid: str, code: str, message: str) -> dict[str, Any]:
    return {"t": "tts.error", "id": uid, "code": code, "message": message}


def whisper_progress(pct: float, total_bytes: int | None = None) -> dict[str, Any]:
    msg: dict[str, Any] = {"t": "whisper.progress", "pct": round(max(0.0, min(100.0, pct)), 1)}
    if total_bytes is not None:
        msg["bytes"] = total_bytes
    return msg


def whisper_ready(size: str, device: str, compute: str) -> dict[str, Any]:
    return {"t": "whisper.ready", "size": size, "device": device, "compute": compute}


def whisper_error(code: str, message: str) -> dict[str, Any]:
    return {"t": "whisper.error", "code": code, "message": message}


def gpu_stats_msg(total: int | None, used: int | None, has_nvidia: bool) -> dict[str, Any]:
    return {
        "t": "gpu.stats",
        "vramTotalMiB": total,
        "vramUsedMiB": used,
        "hasNvidia": has_nvidia,
        "at": now_ms(),
    }


def is_valid_incoming(msg: Any) -> bool:
    """main→side 訊息形狀快篩（深度驗證各 handler 做）。"""
    if not isinstance(msg, dict):
        return False
    t = msg.get("t")
    return isinstance(t, str) and len(t) > 0
