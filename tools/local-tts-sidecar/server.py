#!/usr/bin/env python3
"""SongHost local TTS sidecar — Chatterbox-Turbo on the laptop GPU.

GET /health       → { ok, model, gpu, vramNote? }
POST /v1/speech   → { text, voiceSlot?, instructions? } → audio/wav
POST /v1/cancel   → { jobId? } → { ok, cancelledJobId }

Binds 127.0.0.1 only. Fail-closed if CUDA or the model is unavailable.
Does not fall back to OpenAI or to the Phase A beep.
Disconnect or /v1/cancel discards the WAV; CUDA cannot be preempted mid-forward.
"""

from __future__ import annotations

import json
import os
import select
import socket
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path

HOST = "127.0.0.1"
PORT = int(os.environ.get("LOCAL_TTS_PORT") or "7860")
DEVICE = (os.environ.get("LOCAL_TTS_DEVICE") or "cuda").strip().lower()
MODEL_NAME = "chatterbox-turbo"
MODEL_DIR = (os.environ.get("LOCAL_TTS_MODEL_DIR") or "").strip()
SIDECAR_ROOT = Path(__file__).resolve().parent
VOICES_DIR = Path(os.environ.get("LOCAL_TTS_VOICES_DIR") or SIDECAR_ROOT / "voices")
DEFAULT_MODEL_DIR = SIDECAR_ROOT / "models" / "chatterbox-turbo"
# Hugging Face cache uses symlinks; Windows without Developer Mode raises WinError 1314.
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

_state_lock = threading.Lock()
_infer_lock = threading.Lock()
_job_lock = threading.Lock()
_job_seq = 0
_active_job_id = 0
_cancelled_job_ids: set[int] = set()
_model = None
_ready = False
_gpu = False
_load_error: str | None = "Model has not finished loading."
_vram_note = "GPU status unknown."
# Reuse prepared speaker conditionals so each request does not reload the WAV.
_conds_by_slot: dict[int, object] = {}

# Local Director's Cut cap is 62 words (~430 chars). Reject lecture-length jobs.
MAX_INPUT_CHARS = 520
# Chatterbox-Turbo already uses a 1-step decoder + 2 CFM steps — no extra
# "fewer steps" knob. `mode=preview` is accepted for logging / future knobs.


def _json_bytes(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=True).encode("utf-8")


def _vram_note_now() -> str:
    try:
        import torch

        if not torch.cuda.is_available():
            return "CUDA is not available."
        props = torch.cuda.get_device_properties(0)
        total_gb = props.total_memory / (1024 ** 3)
        free_b, _total_b = torch.cuda.mem_get_info()
        free_gb = free_b / (1024 ** 3)
        return (
            f"{props.name}, {total_gb:.1f} GB total, {free_gb:.1f} GB free. "
            "On 8 GB laptops close extra Chrome/Cursor windows before loading."
        )
    except Exception as exc:  # noqa: BLE001 — health must still answer
        return f"Could not read GPU memory ({exc})."


def _health_payload() -> dict:
    with _state_lock:
        return {
            "ok": _ready and _gpu,
            "model": MODEL_NAME,
            "gpu": _gpu,
            "vramNote": _vram_note,
            **({"error": _load_error} if _load_error else {}),
        }


def _parse_voice_slot(raw) -> int | None:
    if raw is None or raw == "":
        return 1
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        slot = int(raw)
        return slot if slot in (1, 2, 3, 4) else None
    if not isinstance(raw, str):
        return None
    text = raw.strip().lower().replace("_", "-")
    for prefix in ("slot-", "slot", "voice-", "voice"):
        if text.startswith(prefix):
            text = text[len(prefix) :]
            break
    if text.isdigit():
        slot = int(text)
        return slot if slot in (1, 2, 3, 4) else None
    return None


def _slot_dir(slot: int) -> Path:
    return VOICES_DIR / f"slot-{slot}"


def _pick_reference_wav(slot: int) -> Path | None:
    folder = _slot_dir(slot)
    if not folder.is_dir():
        return None
    wavs = sorted(
        [path for path in folder.iterdir() if path.is_file() and path.suffix.lower() == ".wav"],
        key=lambda path: path.name.lower(),
    )
    if not wavs:
        return None
    preferred = [path for path in wavs if not path.name.upper().startswith("SAMPLE")]
    return (preferred or wavs)[0]


def _wav_bytes(wav_tensor, sample_rate: int) -> bytes:
    import torchaudio as ta

    buf = BytesIO()
    ta.save(buf, wav_tensor.detach().cpu(), sample_rate, format="wav")
    return buf.getvalue()


def _client_gone(exc: BaseException) -> bool:
    if isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
        return True
    return getattr(exc, "winerror", None) == 10053


def _new_job_id() -> int:
    global _job_seq, _active_job_id
    with _job_lock:
        _job_seq += 1
        _active_job_id = _job_seq
        return _job_seq


def _cancel_job(job_id: int | None = None) -> int:
    with _job_lock:
        target = int(job_id or _active_job_id)
        if target:
            _cancelled_job_ids.add(target)
        return target


def _is_cancelled(job_id: int) -> bool:
    with _job_lock:
        return job_id in _cancelled_job_ids


def _finish_job(job_id: int) -> None:
    global _active_job_id
    with _job_lock:
        _cancelled_job_ids.discard(job_id)
        if _active_job_id == job_id:
            _active_job_id = 0


def _socket_closed(handler: BaseHTTPRequestHandler) -> bool:
    """True when the SongHost client has hung up (skip / timeout / station change)."""
    try:
        sock = handler.connection
        ready, _, _ = select.select([sock], [], [], 0)
        if not ready:
            return False
        data = sock.recv(1, socket.MSG_PEEK)
        return len(data) == 0
    except Exception:
        return True


def _synthesize(text: str, voice_slot: int, job_id: int = 0) -> bytes | None:
    with _state_lock:
        if not _ready or _model is None or not _gpu:
            raise RuntimeError(_load_error or "Local TTS model is not ready. No OpenAI fallback.")
        model = _model

    reference = _pick_reference_wav(voice_slot)
    with _infer_lock:
        if job_id and _is_cancelled(job_id):
            return None
        cached = _conds_by_slot.get(voice_slot)
        if cached is not None:
            model.conds = cached
        elif reference is not None:
            # prepare_conditionals already truncates refs to ~10s decoder / ~15s
            # encoder. Use a 6–12s clean WAV so librosa does not load a long file.
            model.prepare_conditionals(str(reference))
            _conds_by_slot[voice_slot] = model.conds
        elif voice_slot == 1 and getattr(model, "conds", None) is not None:
            # Turbo ships a built-in conds.pt — slot 1 may use it when no WAV is present.
            _conds_by_slot[voice_slot] = model.conds
        else:
            raise FileNotFoundError(
                f"Voice slot {voice_slot} has no reference WAV. "
                f"Drop a clean 6–12 second .wav into { _slot_dir(voice_slot) }."
            )
        wav = model.generate(text=text)
        if job_id and _is_cancelled(job_id):
            print(
                f"[local-tts] abort reason=discard_result job={job_id} "
                "(CUDA forward is not preemptable; result dropped, lock released)",
                flush=True,
            )
            return None
    return _wav_bytes(wav, model.sr)


def _load_model() -> None:
    global _model, _ready, _gpu, _load_error, _vram_note

    if DEVICE != "cuda":
        with _state_lock:
            _ready = False
            _gpu = False
            _load_error = "LOCAL_TTS_DEVICE must be cuda. CPU is not a production path."
            _vram_note = _vram_note_now()
        return

    try:
        import torch
        from chatterbox.tts_turbo import ChatterboxTurboTTS
    except Exception as exc:  # noqa: BLE001
        with _state_lock:
            _ready = False
            _gpu = False
            _load_error = f"Chatterbox-Turbo failed to import ({exc}). No OpenAI fallback."
            _vram_note = _vram_note_now()
        return

    if not torch.cuda.is_available():
        with _state_lock:
            _ready = False
            _gpu = False
            _load_error = "CUDA is not available. No OpenAI fallback."
            _vram_note = _vram_note_now()
        return

    try:
        print(f"[local-tts] Loading {MODEL_NAME} on cuda... first run downloads weights.", flush=True)
        if MODEL_DIR:
            model = ChatterboxTurboTTS.from_local(MODEL_DIR, device="cuda")
        else:
            # Copy files into the sidecar folder so Windows does not need symlink privilege.
            from huggingface_hub import snapshot_download

            local_path = snapshot_download(
                repo_id="ResembleAI/chatterbox-turbo",
                local_dir=str(DEFAULT_MODEL_DIR),
                allow_patterns=["*.safetensors", "*.json", "*.txt", "*.pt", "*.model"],
                token=os.getenv("HF_TOKEN") or None,
            )
            model = ChatterboxTurboTTS.from_local(local_path, device="cuda")
        # Touch CUDA so /health can report free VRAM after load.
        torch.cuda.synchronize()
        with _state_lock:
            _model = model
            _ready = True
            _gpu = True
            _load_error = None
            _vram_note = _vram_note_now()
        print(f"[local-tts] Ready. {_vram_note}", flush=True)
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        with _state_lock:
            _model = None
            _ready = False
            _gpu = torch.cuda.is_available()
            _load_error = f"Chatterbox-Turbo failed to load ({exc}). No OpenAI fallback."
            _vram_note = _vram_note_now()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:  # noqa: BLE001 — client may already be gone
            if _client_gone(exc):
                print("[local-tts] Client gone while writing response.", flush=True)
                return
            raise

    def _send_json(self, status: int, payload: dict) -> None:
        self._send(status, _json_bytes(payload), "application/json; charset=utf-8")

    def do_GET(self) -> None:  # noqa: N802 — BaseHTTPRequestHandler API
        path = self.path.split("?", 1)[0]
        if path != "/health":
            self._send_json(404, {"error": "Not found"})
            return
        payload = _health_payload()
        self._send_json(200 if payload["ok"] else 503, payload)

    def do_POST(self) -> None:  # noqa: N802 — BaseHTTPRequestHandler API
        path = self.path.split("?", 1)[0]
        if path == "/v1/cancel":
            self._handle_cancel()
            return
        if path != "/v1/speech":
            self._send_json(404, {"error": "Not found"})
            return

        health = _health_payload()
        if not health["ok"]:
            self._send_json(503, {"error": health.get("error") or "Local TTS is not ready. No OpenAI fallback."})
            return

        parsed = self._read_json_body()
        if parsed is None:
            return

        text = parsed.get("text")
        if not isinstance(text, str) or not text.strip():
            self._send_json(400, {"error": "text is required"})
            return

        spoken = text.strip()
        if len(spoken) > MAX_INPUT_CHARS:
            self._send_json(
                400,
                {
                    "error": (
                        f"text exceeds {MAX_INPUT_CHARS} characters. "
                        "Shorten the lore clip instead of running a multi-minute job."
                    )
                },
            )
            return

        slot = _parse_voice_slot(parsed.get("voiceSlot"))
        if slot is None:
            self._send_json(400, {"error": "voiceSlot must be 1, 2, 3, or 4"})
            return

        mode_raw = parsed.get("mode")
        mode = mode_raw.strip().lower() if isinstance(mode_raw, str) else "break"
        if mode not in {"break", "preview"}:
            mode = "break"

        # `instructions` is accepted for SongHost parity and ignored — Turbo has no OpenAI-style steer.
        job_id = _new_job_id()
        started = time.perf_counter()
        box: dict = {}
        done = threading.Event()

        def worker() -> None:
            try:
                wav = _synthesize(spoken, slot, job_id)
                box["wav"] = wav
                box["cancelled"] = _is_cancelled(job_id) or wav is None
            except FileNotFoundError as exc:
                box["status"] = 400
                box["error"] = str(exc)
            except Exception as exc:  # noqa: BLE001
                traceback.print_exc()
                box["status"] = 503
                box["error"] = f"Local TTS generation failed ({exc}). No OpenAI fallback."
            finally:
                done.set()
                _finish_job(job_id)

        threading.Thread(target=worker, daemon=True, name=f"tts-job-{job_id}").start()

        while not done.wait(0.25):
            if _socket_closed(self) or _is_cancelled(job_id):
                reason = "client_disconnect" if _socket_closed(self) else "cancel_endpoint"
                _cancel_job(job_id)
                print(
                    f"[local-tts] abort reason={reason} job={job_id}",
                    flush=True,
                )
                try:
                    self._send_json(499, {"error": "cancelled", "reason": reason, "jobId": job_id})
                except Exception as exc:  # noqa: BLE001
                    if not _client_gone(exc):
                        raise
                return

        duration_ms = int((time.perf_counter() - started) * 1000)
        cancelled = bool(box.get("cancelled"))
        print(
            f"[local-tts] synth duration_ms={duration_ms} chars={len(spoken)} "
            f"slot={slot} mode={mode} job={job_id} cancelled={cancelled}",
            flush=True,
        )

        if cancelled:
            try:
                self._send_json(499, {"error": "cancelled", "reason": "discard_result", "jobId": job_id})
            except Exception as exc:  # noqa: BLE001
                if not _client_gone(exc):
                    raise
            return

        if "error" in box:
            self._send_json(int(box.get("status") or 503), {"error": box["error"]})
            return

        wav = box.get("wav")
        if not wav:
            self._send_json(503, {"error": "Local TTS returned empty audio. No OpenAI fallback."})
            return

        self._send(200, wav, "audio/wav")

    def _handle_cancel(self) -> None:
        parsed = self._read_json_body(allow_empty=True) or {}
        raw_id = parsed.get("jobId") if isinstance(parsed, dict) else None
        job_id = None
        if isinstance(raw_id, (int, float)) and not isinstance(raw_id, bool):
            job_id = int(raw_id)
        cancelled = _cancel_job(job_id)
        print(f"[local-tts] abort reason=cancel_endpoint job={cancelled}", flush=True)
        self._send_json(200, {"ok": True, "cancelledJobId": cancelled})

    def _read_json_body(self, allow_empty: bool = False) -> dict | None:
        length_raw = self.headers.get("Content-Length", "")
        try:
            length = int(length_raw) if length_raw else 0
        except ValueError:
            if allow_empty:
                return {}
            self._send_json(400, {"error": "JSON body required"})
            return None
        if length <= 0:
            if allow_empty:
                return {}
            self._send_json(400, {"error": "JSON body required"})
            return None
        if length > 1_000_000:
            self._send_json(400, {"error": "JSON body required"})
            return None
        try:
            parsed = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            self._send_json(400, {"error": "JSON body required"})
            return None
        if parsed is None and allow_empty:
            return {}
        if not isinstance(parsed, dict):
            self._send_json(400, {"error": "JSON body required"})
            return None
        return parsed


def main() -> int:
    requested_host = (os.environ.get("LOCAL_TTS_HOST") or HOST).strip()
    if requested_host not in {"127.0.0.1", "localhost"}:
        print(
            f"[local-tts] Refusing to bind {requested_host!r}. This helper stays on 127.0.0.1.",
            flush=True,
        )
    print(f"[local-tts] Binding http://{HOST}:{PORT}", flush=True)
    print("[local-tts] Health: GET /health   Speech: POST /v1/speech   Cancel: POST /v1/cancel", flush=True)

    server = ThreadingHTTPServer((HOST, PORT), Handler)
    loader = threading.Thread(target=_load_model, name="chatterbox-load", daemon=True)
    loader.start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[local-tts] Stopped.", flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
