"""GPU 資訊（pynvml 延遲 import；無 N 卡/未安裝時回退 hasNvidia=False）。"""
from __future__ import annotations


def read_stats() -> dict[str, object]:
    try:
        import pynvml  # type: ignore
    except Exception:
        return {"total": None, "used": None, "has_nvidia": False}
    try:
        pynvml.nvmlInit()
    except Exception:
        return {"total": None, "used": None, "has_nvidia": False}
    try:
        count = pynvml.nvmlDeviceGetCount()
        if count == 0:
            return {"total": None, "used": None, "has_nvidia": False}
        total = 0
        used = 0
        for i in range(count):
            handle = pynvml.nvmlDeviceGetHandleByIndex(i)
            mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
            total += int(mem.total)
            used += int(mem.used)
        mib = 1024 * 1024
        return {"total": total // mib, "used": used // mib, "has_nvidia": True}
    except Exception:
        return {"total": None, "used": None, "has_nvidia": False}
    finally:
        try:
            pynvml.nvmlShutdown()
        except Exception:
            pass
