"""Python sidecar 主程式：STT + TTS + GPU 資訊，本機 WebSocket + 啟動 token。

啟動：python app.py --host 127.0.0.1 --port 0 --token XXX --data-dir DIR
  [--whisper-size small --whisper-device cuda --whisper-compute float16]
stdout 會印 SIDECAR_PORT=<port> 與 SIDECAR_READY（main 據此接線）。
host 非 loopback 一律拒絕啟動。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import audio_in
import gpu_info
import proto
import stt_engine
import tts_engine

try:
    from websockets.asyncio.server import serve  # websockets 新版路徑（需驗證 17.x）
except ImportError:  # pragma: no cover
    from websockets import serve  # type: ignore[no-redef]

logging.basicConfig(level=logging.INFO, format="[sidecar] %(message)s")
log = logging.getLogger("sidecar")

ALLOWED_HOSTS = ("127.0.0.1", "localhost", "::1")


class Sidecar:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.data_dir = args.data_dir
        self.tts_dir = os.path.join(self.data_dir, "tts")
        self.models_dir = os.path.join(self.data_dir, "whisper-models")
        os.makedirs(self.tts_dir, exist_ok=True)
        self.whisper = stt_engine.WhisperEngine(self.models_dir)
        self.rec: audio_in.MicRecorder | None = None
        self.mode: str = "ptt"
        self.listening = False
        self.tts_playing = False
        self.seg = audio_in.Segmenter()
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="side")
        self.loop: asyncio.AbstractEventLoop | None = None
        self.ws: Any | None = None
        self._rec_thread: threading.Thread | None = None
        self._stop_rec = threading.Event()
        self._ptt_buf = bytearray()
        self._barge_sent = False
        self._mem_thread = threading.Thread(target=self._mem_loop, daemon=True)
        self._mem_thread.start()

    # ---------- 對外 ----------

    async def send(self, msg: dict[str, Any]) -> None:
        if self.ws is None:
            return
        try:
            await self.ws.send(json.dumps(msg, ensure_ascii=False))
        except Exception as e:
            log.warning("send failed: %s", e)

    def send_threadsafe(self, msg: dict[str, Any]) -> None:
        if self.loop is not None:
            asyncio.run_coroutine_threadsafe(self.send(msg), self.loop)

    # ---------- 訊息路由 ----------

    async def handle(self, msg: dict[str, Any]) -> None:
        t = msg.get("t")
        if t == "stt.start":
            await self.cmd_stt_start(str(msg.get("mode", "ptt")))
        elif t == "stt.stop":
            await self.cmd_stt_stop()
        elif t == "tts.speak":
            self.cmd_tts_speak(str(msg.get("id", "")), str(msg.get("text", "")), str(msg.get("voice", "")))
        elif t == "tts.cancel":
            await self.send({"t": "tts.end", "id": str(msg.get("id", "")), "reason": "cancelled"})
        elif t == "tts.notify":
            self.tts_playing = bool(msg.get("playing", False))
            if not self.tts_playing:
                self._barge_sent = False
        elif t == "whisper.reload":
            self.cmd_whisper_reload(str(msg.get("size", "")), str(msg.get("device", "")), str(msg.get("compute", "")))
        elif t == "whisper.cancelDownload":
            self.whisper.cancel_download()
        elif t == "gpu.stats":
            s = gpu_info.read_stats()
            await self.send(proto.gpu_stats_msg(s.get("total"), s.get("used"), bool(s.get("has_nvidia"))))  # type: ignore[arg-type]
        elif t == "ping":
            await self.send({"t": "pong", "at": msg.get("at")})

    # ---------- STT ----------

    async def cmd_stt_start(self, mode: str) -> None:
        if mode not in ("ptt", "vad"):
            mode = "ptt"
        if self.tts_playing and mode == "ptt":
            # 明確按鍵 = 打斷意圖
            await self.send(proto.stt_bargein())
        try:
            if self.rec is None:
                self.rec = audio_in.MicRecorder()
                self.rec.start()
                self.seg.noise_floor = self.rec.calibrate(0.6)
        except audio_in.MicError as e:
            self.rec = None
            await self.send(proto.stt_error("mic-denied", str(e)))
            return
        self.mode = mode
        self.listening = True
        self.seg.reset()
        self._ptt_buf = bytearray()
        self._stop_rec.clear()
        if self._rec_thread is None or not self._rec_thread.is_alive():
            self._rec_thread = threading.Thread(target=self._rec_loop, daemon=True)
            self._rec_thread.start()
        await self.send(proto.stt_state(True, mode))

    async def cmd_stt_stop(self) -> None:
        self.listening = False
        self._stop_rec.set()
        if self.rec is not None and self.mode == "ptt" and len(self._ptt_buf) > 0:
            pcm = bytes(self._ptt_buf)
            self._ptt_buf = bytearray()
            self.pool.submit(self._transcribe_and_send, pcm)
        await self.send(proto.stt_state(False, self.mode))

    def _rec_loop(self) -> None:
        assert self.rec is not None
        while not self._stop_rec.is_set():
            frame = self.rec.read_frame(timeout=0.5)
            if frame is None or not self.listening:
                continue
            if self.mode == "ptt":
                self._ptt_buf += frame
                continue
            # vad 模式
            if self.tts_playing and self.seg.is_barge(frame) and not self._barge_sent:
                self._barge_sent = True
                self.send_threadsafe(proto.stt_bargein())
                self.seg.reset()
                continue
            seg = self.seg.feed(frame, self.tts_playing)
            if seg is not None:
                self.pool.submit(self._transcribe_and_send, seg)

    def _transcribe_and_send(self, pcm: bytes) -> None:
        try:
            text = self.whisper.transcribe(pcm)
        except Exception as e:
            if "尚未載入" in str(e):
                self.send_threadsafe(proto.stt_error("model-missing", str(e)))
            else:
                self.send_threadsafe(proto.stt_error("model-load-failed", str(e)))
            return
        if text:
            self.send_threadsafe(proto.stt_final(text))

    # ---------- TTS ----------

    def cmd_tts_speak(self, uid: str, text: str, voice: string) -> None:
        if not text.strip():
            self.send_threadsafe(proto.tts_error(uid, "failed", "empty text"))
            return

        def _run() -> None:
            try:
                path = tts_engine.synthesize(text, voice, self.tts_dir)
            except tts_engine.TTSError as e:
                self.send_threadsafe(proto.tts_error(uid, e.code, str(e)))
            except Exception as e:  # pragma: no cover
                self.send_threadsafe(proto.tts_error(uid, "failed", str(e)))
            else:
                self.send_threadsafe(proto.tts_file_msg(uid, path))

        self.pool.submit(_run)

    # ---------- Whisper 熱切換 ----------

    def cmd_whisper_reload(self, size: str, device: str, compute: str) -> None:
        def _run() -> None:
            def _progress(pct: float, total: int | None) -> None:
                self.send_threadsafe(proto.whisper_progress(pct, total))

            try:
                actual = self.whisper.reload(size, device, compute, _progress)
            except InterruptedError:
                self.send_threadsafe(proto.whisper_error("cancelled", "download cancelled"))
            except ValueError as e:
                self.send_threadsafe(proto.whisper_error("model-missing", str(e)))
            except Exception as e:
                self.send_threadsafe(proto.whisper_error("model-load-failed", str(e)))
            else:
                self.send_threadsafe(proto.whisper_ready(*actual))

        threading.Thread(target=_run, daemon=True).start()

    # ---------- 記憶體自記 ----------

    def _mem_loop(self) -> None:
        while True:
            time.sleep(60)
            try:
                import psutil  # type: ignore

                rss = psutil.Process().memory_info().rss // (1024 * 1024)
                log.info("self-rss=%dMiB", rss)
            except Exception:
                pass


async def _client(ws: Any, path: Any, box: dict[str, Any]) -> None:
    token: str = box["token"]
    sidecar: Sidecar = box["sidecar"]
    try:
        raw = await asyncio.wait_for(ws.recv(), timeout=10)
    except Exception:
        await ws.close()
        return
    try:
        first = json.loads(raw)
    except Exception:
        await ws.close()
        return
    if not isinstance(first, dict) or first.get("t") != "auth" or first.get("token") != token:
        await ws.close()
        return
    sidecar.ws = ws
    sidecar.loop = asyncio.get_running_loop()
    await sidecar.send({"t": "ready", "version": "0.1.0"})
    try:
        async for raw_msg in ws:
            try:
                msg = json.loads(raw_msg)
            except Exception:
                continue
            if proto.is_valid_incoming(msg):
                await sidecar.handle(msg)
    finally:
        if sidecar.ws is ws:
            sidecar.ws = None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--token", required=True)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--whisper-size", default="small")
    ap.add_argument("--whisper-device", default="cuda")
    ap.add_argument("--whisper-compute", default="float16")
    args = ap.parse_args()

    if args.host not in ALLOWED_HOSTS:
        print(f"refuse non-loopback host: {args.host}", file=sys.stderr)
        return 2
    os.makedirs(args.data_dir, exist_ok=True)
    box = {"token": args.token, "sidecar": Sidecar(args)}

    async def _run() -> None:
        # 需驗證：websockets 17 serve 簽章（handler 單參數）
        async with serve(lambda ws: _client(ws, None, box), args.host, args.port) as server:  # type: ignore[arg-type]
            port = server.sockets[0].getsockname()[1] if server.sockets else args.port
            print(f"SIDECAR_PORT={port}", flush=True)
            print("SIDECAR_READY", flush=True)
            # 初始 Whisper 預載（背景，避免擋 ready）
            threading.Thread(
                target=lambda: box["sidecar"].cmd_whisper_reload(
                    args.whisper_size, args.whisper_device, args.whisper_compute
                ),
                daemon=True,
            ).start()
            await server.serve_forever()

    asyncio.run(_run())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
