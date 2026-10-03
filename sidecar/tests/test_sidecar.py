"""sidecar 自檢（只用標準庫；重型依賴缺席時測 fallback 路徑）。"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import gpu_info
import proto
import whisper_models


def test_proto_shapes() -> None:
    m = proto.stt_final("嗨")
    assert m["t"] == "stt.final" and m["text"] == "嗨"
    json.dumps(m, ensure_ascii=False)
    assert proto.whisper_progress(33.333)["pct"] == 33.3
    assert proto.tts_error("1", "offline", "x")["code"] == "offline"
    assert proto.is_valid_incoming({"t": "stt.stop"})
    assert not proto.is_valid_incoming({"nope": 1})
    assert not proto.is_valid_incoming("str")
    print("proto ok")


def test_model_map() -> None:
    # 與 faster-whisper 1.2.1 _MODELS 一致（含 turbo）
    assert whisper_models.repo_for("large-v3") == "Systran/faster-whisper-large-v3"
    assert whisper_models.repo_for("large-v3-turbo") == "mobiuslabsgmbh/faster-whisper-large-v3-turbo"
    try:
        whisper_models.repo_for("nope")
    except ValueError:
        pass
    else:
        raise AssertionError("unknown size 應拋錯")
    assert set(whisper_models.SIZES) >= {"tiny", "base", "small", "medium", "large-v3", "large-v3-turbo"}
    print("models ok")


def test_gpu_fallback() -> None:
    s = gpu_info.read_stats()
    assert set(s) == {"total", "used", "has_nvidia"}
    # 本機若無 pynvml/N 卡 → 明確 fallback（不斷言有卡，只斷言形狀）
    print(f"gpu ok: {s}")


def test_segmenter_pure() -> None:
    import audio_in

    seg = audio_in.Segmenter(silence_need_s=0.09, speech_need_s=0.06)
    seg.noise_floor = 100.0
    import struct

    loud = struct.pack("<480h", *([2000] * 480))
    quiet = struct.pack("<480h", *([10] * 480))
    out = None
    for _ in range(4):
        out = seg.feed(loud, False) or out
    assert out is None  # 還沒靜音，不切
    for _ in range(4):
        out = seg.feed(quiet, False) or out
    assert out is not None and len(out) > 0
    assert seg.is_barge(loud) and not seg.is_barge(quiet)
    print("segmenter ok")


if __name__ == "__main__":
    test_proto_shapes()
    test_model_map()
    test_gpu_fallback()
    test_segmenter_pure()
    print("ALL SIDECAR SELF-TESTS PASSED")
