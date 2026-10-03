"""Whisper 模型別名→HF repo 對照（逐字抄自 faster-whisper 1.2.1 utils.py _MODELS）。
設定頁下拉只列 SIZES；turbo 是否顯示由 main 依已安裝 faster-whisper 版本決定。
"""
from __future__ import annotations

REPOS: dict[str, str] = {
    "tiny": "Systran/faster-whisper-tiny",
    "base": "Systran/faster-whisper-base",
    "small": "Systran/faster-whisper-small",
    "medium": "Systran/faster-whisper-medium",
    "large-v3": "Systran/faster-whisper-large-v3",
    "large-v3-turbo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
}

SIZES: tuple[str, ...] = ("tiny", "base", "small", "medium", "large-v3", "large-v3-turbo")

# 粗估 VRAM（float16，僅供設定頁警告用，標註估計值；int8 約省 40%）
EST_VRAM_MIB: dict[str, int] = {
    "tiny": 300,
    "base": 600,
    "small": 1200,
    "medium": 2500,
    "large-v3": 3100,
    "large-v3-turbo": 1800,
}


def repo_for(size: str) -> str:
    if size not in REPOS:
        raise ValueError(f"unknown whisper size: {size}")
    return REPOS[size]
