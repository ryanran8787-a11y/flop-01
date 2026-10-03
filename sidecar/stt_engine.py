"""Whisper 引擎：熱切換、下載進度、可取消、CUDA 退回（faster-whisper 延遲 import）。

流程：whisper.reload →（背景執行緒）snapshot_download 帶進度 → WhisperModel 載入。
- 同組態 no-op；失敗保留舊模型並回 whisper.error。
- 要求 cuda 但無裝置 → 自動 cpu/int8，並以實際值回 whisper.ready。
- huggingface-hub 2.x 的 snapshot_download 簽章若與預期不同（tqdm_class），
  退回無進度下載（仍可用，只是無百分比）。
"""
from __future__ import annotations

import os
import threading
from collections.abc import Callable


class WhisperEngine:
    def __init__(self, models_dir: str) -> None:
        self.models_dir = models_dir
        os.makedirs(models_dir, exist_ok=True)
        self.size: str | None = None
        self.device: str | None = None
        self.compute: str | None = None
        self._model: object | None = None
        self._lock = threading.Lock()
        self._cancel = threading.Event()
        self._downloading = False

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def cancel_download(self) -> None:
        self._cancel.set()

    def is_downloading(self) -> bool:
        with self._lock:
            return self._downloading

    def cuda_devices(self) -> int:
        try:
            import ctranslate2  # type: ignore

            return int(ctranslate2.get_cuda_device_count())
        except Exception:
            return 0

    def reload(
        self,
        size: str,
        device: str,
        compute: str,
        progress_cb: Callable[[float, int | None], None] | None = None,
    ) -> tuple[str, str, str]:
        """回傳實際生效 (size, device, compute)。"""
        from whisper_models import EST_VRAM_MIB, repo_for  # noqa: PLC0415

        if (size, device, compute) == (self.size, self.device, self.compute) and self.loaded:
            return (size, device, compute)

        # CUDA 不可用 → 退回 CPU int8（UI 會看到實際值）
        if device == "cuda" and self.cuda_devices() == 0:
            device, compute = "cpu", "int8"

        repo = repo_for(size)
        dest = os.path.join(self.models_dir, size)
        self._cancel.clear()
        with self._lock:
            self._downloading = True
        try:
            self._download(repo, dest, progress_cb)
            if self._cancel.is_set():
                raise InterruptedError("cancelled")
            model = self._load(dest, device, compute)
        finally:
            with self._lock:
                self._downloading = False
        with self._lock:
            self._model = model
            self.size, self.device, self.compute = size, device, compute
        _ = EST_VRAM_MIB
        return (size, device, compute)

    def _download(
        self,
        repo: str,
        dest: str,
        progress_cb: Callable[[float, int | None], None] | None,
    ) -> None:
        try:
            from huggingface_hub import snapshot_download  # noqa: PLC0415
        except Exception as e:
            raise RuntimeError(f"huggingface-hub 不可用：{e}")

        cb = progress_cb
        cancel = self._cancel

        class _Tqdm:
            def __init__(self, *a: object, **k: object) -> None:
                self.total = k.get("total") or 0
                self.n = 0

            def update(self, n: int) -> None:
                self.n += n
                if cb is not None and not cancel.is_set():
                    total = self.total if isinstance(self.total, int) and self.total > 0 else None
                    pct = (self.n / total * 100.0) if total else 0.0
                    cb(pct, total)

            def close(self) -> None:
                pass

            def __enter__(self) -> _Tqdm:
                return self

            def __exit__(self, *a: object) -> None:
                pass

        # 需驗證：huggingface-hub 2.x snapshot_download(tqdm_class=…, local_dir=…) 簽章
        try:
            snapshot_download(repo, local_dir=dest, tqdm_class=_Tqdm)  # type: ignore[arg-type]
        except TypeError:
            snapshot_download(repo, local_dir=dest)
        if cancel.is_set():
            raise InterruptedError("cancelled")

    def _load(self, dest: str, device: str, compute: str) -> object:
        try:
            from faster_whisper import WhisperModel  # noqa: PLC0415
        except Exception as e:
            raise RuntimeError(f"faster-whisper 不可用：{e}")
        try:
            return WhisperModel(dest, device=device, compute_type=compute)
        except Exception as e:
            # 顯卡相關失敗最後退回 CPU（例如驅動/cuDNN 不合）
            if device == "cuda":
                return WhisperModel(dest, device="cpu", compute_type="int8")
            raise RuntimeError(f"模型載入失敗：{e}")

    def transcribe(self, pcm16: bytes, sample_rate: int = 16000) -> str:
        import numpy as np  # noqa: PLC0415

        with self._lock:
            model = self._model
        if model is None:
            raise RuntimeError("whisper 尚未載入")
        audio = np.frombuffer(pcm16, dtype=np.int16).astype("float32") / 32768.0
        segments, _info = model.transcribe(  # type: ignore[attr-defined]
            audio, language="zh", vad_filter=True, beam_size=1
        )
        return "".join(s.text for s in segments).strip()
