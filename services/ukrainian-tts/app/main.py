import asyncio
import hashlib
import io
import json
import os
import re
import shutil
import time
import urllib.request
import wave
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import torch
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from piper import PiperVoice, SynthesisConfig
from pydantic import BaseModel, Field

from app.accent import UkrainianAccentor
from app.language import adapt_mixed_latin, normalize_voice, segment_languages
from app.streaming_stt import DuplexSession, StreamingRecognizer, WakeWordRecognizer, decode_wav_pcm16


QUALITY_MODEL_ID = os.getenv("TTS_QUALITY_MODEL_ID", "silero-v5-ukrainian")
FAST_MODEL_ID = os.getenv("TTS_FAST_MODEL_ID", "piper-ukrainian")
SILERO_UKRAINIAN_URL = os.getenv(
    "TTS_SILERO_UKRAINIAN_URL",
    "https://web.archive.org/web/20260113194023id_/https://models.silero.ai/models/tts/ru/v5_cis_ext.pt,"
    "https://models.silero.ai/models/tts/ru/v5_cis_ext.pt",
)
SILERO_UKRAINIAN_PATH = Path(os.getenv("TTS_SILERO_UKRAINIAN_PATH", "/models/v5_cis_ext.pt"))
SILERO_ENGLISH_URL = os.getenv(
    "TTS_SILERO_ENGLISH_URL",
    "https://huggingface.co/Derur/silero-models/resolve/main/tts/en/en_v3/v3_en.pt,"
    "https://models.silero.ai/models/tts/en/v3_en.pt",
)
SILERO_ENGLISH_PATH = Path(os.getenv("TTS_SILERO_ENGLISH_PATH", "/models/v3_en.pt"))
PIPER_MODEL_URL = os.getenv(
    "TTS_PIPER_MODEL_URL",
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/uk/uk_UA/ukrainian_tts/medium/uk_UA-ukrainian_tts-medium.onnx",
)
PIPER_CONFIG_URL = os.getenv(
    "TTS_PIPER_CONFIG_URL",
    f"{PIPER_MODEL_URL}.json",
)
CACHE_ROOT = Path(os.getenv("TTS_CACHE_ROOT", "/home/tts/.cache/opencode-customs"))
MAX_INPUT_CHARS = int(os.getenv("TTS_MAX_INPUT_CHARS", "6000"))
CHUNK_CHARS = int(os.getenv("TTS_CHUNK_CHARS", "350"))
SAMPLE_RATE = int(os.getenv("TTS_SAMPLE_RATE", "48000"))
CPU_THREADS = int(os.getenv("TTS_CPU_THREADS", "4"))
DOWNLOAD_ATTEMPTS = int(os.getenv("TTS_DOWNLOAD_ATTEMPTS", "2"))
DOWNLOAD_TIMEOUT_SECONDS = int(os.getenv("TTS_DOWNLOAD_TIMEOUT_SECONDS", "30"))
UKRAINIAN_VOICES = ("kateryna", "lada", "mykyta", "oleksa", "tetiana")
ENGLISH_VOICE = os.getenv("TTS_ENGLISH_VOICE", "en_0")


class SpeechRequest(BaseModel):
    model: str
    input: str = Field(min_length=1)
    voice: str
    mode: str = "quality"
    response_format: str = "wav"
    speed: float = Field(default=1, ge=0.5, le=2)


class ModelUnavailableError(RuntimeError):
    pass


class SileroModel:
    def __init__(self, local_path: Path, urls: str, filename: str):
        path = resolve_model(local_path, urls, CACHE_ROOT / "models" / filename)
        self.model = torch.package.PackageImporter(str(path)).load_pickle("tts_models", "model")
        self.model.to(torch.device("cpu"))

    def synthesize(self, text: str, speaker: str, speed: float):
        audio = []
        chunks = split_text(text)
        for index, chunk in enumerate(chunks):
            waveform = self.model.apply_tts(text=chunk, speaker=speaker, sample_rate=SAMPLE_RATE)
            audio.append(np.asarray(waveform.cpu() if hasattr(waveform, "cpu") else waveform, dtype=np.float32))
            if index < len(chunks) - 1:
                audio.append(np.zeros(int(SAMPLE_RATE * 0.08), dtype=np.float32))
        return change_speed(np.concatenate(audio), speed)


class PiperModel:
    def __init__(self):
        path = download(PIPER_MODEL_URL, CACHE_ROOT / "models" / "uk_UA-ukrainian_tts-medium.onnx")
        download(PIPER_CONFIG_URL, Path(f"{path}.json"))
        self.voice = PiperVoice.load(str(path))

    def synthesize(self, text: str, speed: float):
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            self.voice.synthesize_wav(text, wav, syn_config=SynthesisConfig(length_scale=1 / speed))
        output.seek(0)
        with wave.open(output, "rb") as wav:
            audio = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype(np.float32) / 32767
            return resample(audio, wav.getframerate(), SAMPLE_RATE)


class SpeechEngine:
    def __init__(self):
        torch.set_num_threads(CPU_THREADS)
        self.ukrainian: SileroModel | None = None
        self.english: SileroModel | None = None
        self.piper: PiperModel | None = None
        self.loading = {"quality", "english", "fast"}
        self.errors: dict[str, str] = {}
        self.accentor = UkrainianAccentor(Path(__file__).with_name("pronunciations.json"))
        (CACHE_ROOT / "audio").mkdir(parents=True, exist_ok=True)

    async def load(self):
        await asyncio.gather(
            self.load_mode("quality", self.load_quality),
            self.load_mode("english", self.load_english),
            self.load_mode("fast", self.load_fast),
        )
        if self.status("quality")["ready"]:
            await asyncio.to_thread(self.synthesize, "Готово. OpenCode Customs is ready.", "kateryna", "quality", 1)
        if self.status("fast")["ready"]:
            await asyncio.to_thread(self.synthesize, "Швидкий голос готовий.", "ukrainian_tts", "fast", 1)

    async def load_mode(self, mode: str, loader):
        try:
            await asyncio.to_thread(loader)
        except Exception as error:
            self.errors[mode] = str(error)
        finally:
            self.loading.discard(mode)

    def load_quality(self):
        self.ukrainian = SileroModel(SILERO_UKRAINIAN_PATH, SILERO_UKRAINIAN_URL, "v5_cis_ext.pt")

    def load_english(self):
        self.english = SileroModel(SILERO_ENGLISH_PATH, SILERO_ENGLISH_URL, "v3_en.pt")

    def load_fast(self):
        self.piper = PiperModel()

    def status(self, mode: str):
        ready = self.piper is not None and self.english is not None if mode == "fast" else self.ukrainian is not None and self.english is not None
        errors = [self.errors.get(item) for item in (mode, "english")]
        return {
            "ready": ready,
            "loading": mode in self.loading or "english" in self.loading,
            "error": " | ".join(item for item in errors if item) or None,
        }

    def synthesize(self, text: str, voice: str, mode: str, speed: float):
        status = self.status(mode)
        if not status["ready"]:
            raise ModelUnavailableError(status["error"] or f"The '{mode}' voice model is unavailable.")
        normalized = re.sub(r"\s+", " ", text).strip()
        key = hashlib.sha256(
            json.dumps(
                {"version": 3, "mode": mode, "voice": voice, "speed": speed, "text": normalized},
                ensure_ascii=False,
                sort_keys=True,
            ).encode()
        ).hexdigest()
        path = CACHE_ROOT / "audio" / f"{key}.wav"
        if path.exists():
            return path.read_bytes(), True, 0.0, 0.0

        prepare_started = time.perf_counter()
        segments = adapt_mixed_latin(segment_languages(self.accentor.replace(normalized)))
        prepared = [
            (language, self.accentor.prepare(segment) if language == "uk" and mode == "quality" else segment)
            for language, segment in segments
        ]
        prepare_ms = (time.perf_counter() - prepare_started) * 1000
        synthesis_started = time.perf_counter()
        audio = []
        for index, (language, segment) in enumerate(prepared):
            if language == "en":
                assert self.english is not None
                waveform = self.english.synthesize(segment, ENGLISH_VOICE, speed)
            elif mode == "fast":
                assert self.piper is not None
                waveform = self.piper.synthesize(segment.lower(), speed)
            else:
                assert self.ukrainian is not None
                waveform = self.ukrainian.synthesize(segment, f"ukr_{voice}", speed)
            audio.append(waveform)
            if index < len(prepared) - 1:
                audio.append(np.zeros(int(SAMPLE_RATE * 0.06), dtype=np.float32))
        if not audio:
            raise ValueError("The text contains no characters supported by the configured TTS models.")
        wav = encode_wav(normalize(np.concatenate(audio)), SAMPLE_RATE)
        temporary = path.with_suffix(".tmp")
        temporary.write_bytes(wav)
        temporary.replace(path)
        return wav, False, prepare_ms, (time.perf_counter() - synthesis_started) * 1000


def resolve_model(local_path: Path, urls: str, path: Path):
    if local_path.is_file() and local_path.stat().st_size > 0:
        require_valid_model(local_path)
        return local_path
    return download(urls, path)


def download(urls: str, path: Path):
    if path.exists() and path.stat().st_size > 0:
        if valid_model(path):
            return path
        path.unlink()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.download")
    errors = []
    for url in [item.strip() for item in urls.split(",") if item.strip()]:
        for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
            try:
                request = urllib.request.Request(url, headers={"User-Agent": "OpenCode-Customs-TTS/2.0"})
                with urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
                    with temporary.open("wb") as output:
                        shutil.copyfileobj(response, output)
                if temporary.stat().st_size == 0:
                    raise RuntimeError("downloaded file is empty")
                require_valid_model(temporary, path.suffix)
                temporary.replace(path)
                return path
            except Exception as error:
                temporary.unlink(missing_ok=True)
                errors.append(f"{url} (attempt {attempt}/{DOWNLOAD_ATTEMPTS}): {error}")
                if attempt < DOWNLOAD_ATTEMPTS:
                    time.sleep(min(2**attempt, 8))
    raise ModelUnavailableError(
        f"Could not obtain model '{path.name}'. Mount it as /models/{path.name} or configure a reachable URL. "
        + " | ".join(errors)
    )


def valid_model(path: Path):
    try:
        require_valid_model(path)
        return True
    except (OSError, RuntimeError, zipfile.BadZipFile):
        return False


def require_valid_model(path: Path, expected_suffix: str | None = None):
    if (expected_suffix or path.suffix) != ".pt":
        return
    with zipfile.ZipFile(path) as package:
        if not package.namelist():
            raise RuntimeError(f"Model package '{path.name}' contains no records.")


def change_speed(audio: np.ndarray, speed: float):
    if speed == 1:
        return audio.astype(np.float32)
    length = max(1, round(len(audio) / speed))
    return np.interp(np.linspace(0, len(audio) - 1, length), np.arange(len(audio)), audio).astype(np.float32)


def split_text(text: str):
    sentences = [item.strip() for item in re.split(r"(?<=[.!?…])\s+", text) if item.strip()]
    chunks = []
    for sentence in sentences:
        words = sentence.split()
        current = ""
        for word in words:
            candidate = f"{current} {word}".strip()
            if len(candidate) <= CHUNK_CHARS:
                current = candidate
                continue
            if current:
                chunks.append(current)
            current = word
        if current:
            chunks.append(current)
    return chunks or [text]


def resample(audio: np.ndarray, source_rate: int, target_rate: int):
    if source_rate == target_rate:
        return audio.astype(np.float32)
    length = max(1, round(len(audio) * target_rate / source_rate))
    return np.interp(np.linspace(0, len(audio) - 1, length), np.arange(len(audio)), audio).astype(np.float32)


def normalize(audio: np.ndarray):
    peak = float(np.max(np.abs(audio)))
    return audio if peak == 0 else audio * (0.95 / peak)


def encode_wav(audio: np.ndarray, sampling_rate: int):
    output = io.BytesIO()
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sampling_rate)
        wav.writeframes(pcm.tobytes())
    return output.getvalue()


engine: SpeechEngine | None = None
recognizer: StreamingRecognizer | None = None
wake_recognizer: WakeWordRecognizer | None = None
generation_lock = asyncio.Lock()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global engine, recognizer, wake_recognizer
    engine = SpeechEngine()
    recognizer = StreamingRecognizer()
    wake_recognizer = WakeWordRecognizer()
    loading = [
        asyncio.create_task(engine.load()),
        asyncio.create_task(recognizer.load()),
        asyncio.create_task(wake_recognizer.load()),
    ]
    yield
    for task in loading:
        task.cancel()
    engine = None
    recognizer = None
    wake_recognizer = None


app = FastAPI(title="OpenCode Customs Local Voice Runtime", version="2.0.0", lifespan=lifespan)


@app.get("/health")
def health():
    modes = {
        "quality": {
            "model": QUALITY_MODEL_ID,
            "voices": list(UKRAINIAN_VOICES),
            "english_voice": ENGLISH_VOICE,
            **(engine.status("quality") if engine else {"ready": False, "loading": True, "error": None}),
        },
        "fast": {
            "model": FAST_MODEL_ID,
            "voices": ["ukrainian_tts"],
            **(engine.status("fast") if engine else {"ready": False, "loading": True, "error": None}),
        },
    }
    stt = recognizer.status() if recognizer else {"ready": False, "loading": True, "error": None}
    wake_stt = wake_recognizer.status() if wake_recognizer else {"ready": False, "loading": True, "error": None}
    components = [*modes.values(), stt]
    return {
        "status": (
            "ready"
            if all(item["ready"] for item in components)
            else "loading"
            if any(item["loading"] for item in components)
            else "degraded"
        ),
        "modes": modes,
        "sample_rate": SAMPLE_RATE,
        "cpu_threads": CPU_THREADS,
        "stt": stt,
        "wake_stt": wake_stt,
    }


@app.get("/v1/models")
def models():
    return {
        "object": "list",
        "data": [
            {"id": QUALITY_MODEL_ID, "object": "model", "owned_by": "local"},
            {"id": FAST_MODEL_ID, "object": "model", "owned_by": "local"},
        ],
    }


@app.post("/v1/audio/speech")
async def speech(request: SpeechRequest):
    if engine is None:
        raise HTTPException(status_code=503, detail="The local voice models are still loading.")
    expected = QUALITY_MODEL_ID if request.mode == "quality" else FAST_MODEL_ID if request.mode == "fast" else None
    if expected is None:
        raise HTTPException(status_code=400, detail="Mode must be 'quality' or 'fast'.")
    if request.model != expected:
        raise HTTPException(status_code=400, detail=f"Mode '{request.mode}' requires model '{expected}'.")
    voice = normalize_voice(request.mode, request.voice)
    if request.mode == "quality" and voice not in UKRAINIAN_VOICES:
        raise HTTPException(status_code=400, detail=f"Voice '{request.voice}' is unavailable for quality mode.")
    if request.mode == "fast" and voice != "ukrainian_tts":
        raise HTTPException(status_code=400, detail=f"Voice '{request.voice}' is unavailable for fast mode.")
    if request.response_format != "wav":
        raise HTTPException(status_code=400, detail="This backend supports response_format='wav' only.")
    if len(request.input) > MAX_INPUT_CHARS:
        raise HTTPException(status_code=413, detail=f"Input exceeds the {MAX_INPUT_CHARS}-character limit.")
    started = time.perf_counter()
    async with generation_lock:
        try:
            audio, cached, prepare_ms, synthesis_ms = await asyncio.to_thread(
                engine.synthesize, request.input, voice, request.mode, request.speed
            )
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except ModelUnavailableError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
    total_ms = (time.perf_counter() - started) * 1000
    return Response(
        content=audio,
        media_type="audio/wav",
        headers={
            "X-TTS-Mode": request.mode,
            "X-TTS-Model": request.model,
            "X-TTS-Voice": voice,
            "X-TTS-Cache": "hit" if cached else "miss",
            "X-TTS-Prepare-Ms": f"{prepare_ms:.1f}",
            "X-TTS-Synthesis-Ms": f"{synthesis_ms:.1f}",
            "X-TTS-Total-Ms": f"{total_ms:.1f}",
        },
    )


@app.websocket("/v1/audio/transcriptions/stream")
async def transcriptions(websocket: WebSocket):
    await websocket.accept()
    session = DuplexSession()
    partial_task: asyncio.Task | None = None
    send_lock = asyncio.Lock()

    async def send(payload: dict):
        async with send_lock:
            await websocket.send_json(payload)

    async def send_transcript(
        kind: str,
        pcm: bytes,
        mode: str,
        reference: str,
        generation: int,
        diagnostics: dict,
        wake: bool = False,
    ):
        if recognizer is None:
            await send({"type": "error", "error": "The local STT runtime is unavailable."})
            return
        started = time.perf_counter()
        try:
            text = await recognizer.transcribe(pcm, session.language)
        except Exception as error:
            await send({"type": "error", "error": str(error)})
            return
        if wake and not text.strip():
            await send(
                {
                    "type": "error",
                    "error": "The wake phrase was detected, but the following command could not be transcribed. No fallback was used.",
                }
            )
            return
        session.observe_transcript(text, generation)
        await send(
            {
                "type": kind,
                "text": text,
                "mode": mode,
                "reference": reference,
                "generation": generation,
                "wake": wake,
                "diagnostics": {
                    **diagnostics,
                    "transcription_ms": round((time.perf_counter() - started) * 1000),
                    "transcript_stability": max(
                        diagnostics.get("transcript_stability", 0),
                        session.transcript_stability,
                    ),
                },
            }
        )

    async def send_wake_candidate(
        pcm: bytes,
        mode: str,
        reference: str,
        generation: int,
        diagnostics: dict,
        phrases: list[str],
    ):
        if wake_recognizer is None or not wake_recognizer.status()["ready"]:
            error = wake_recognizer.status().get("error") if wake_recognizer else None
            await send(
                {
                    "type": "error",
                    "error": error or "The dedicated wake-word recognizer is unavailable. No full STT fallback was used.",
                }
            )
            return
        started = time.perf_counter()
        try:
            detection = await wake_recognizer.detect(pcm, session.language, phrases)
        except Exception as error:
            await send({"type": "error", "error": f"Wake-word recognition failed: {error}"})
            return
        wake_diagnostics = {
            **diagnostics,
            "wake_recognition_ms": round((time.perf_counter() - started) * 1000),
            "wake_model": wake_recognizer.model_name,
        }
        if not detection["matched"]:
            await send(
                {
                    "type": "wake_ignored",
                    "text": detection["text"],
                    "mode": mode,
                    "reference": reference,
                    "generation": generation,
                    "diagnostics": wake_diagnostics,
                }
            )
            return
        await send(
            {
                "type": "wake_detected",
                "text": detection["text"],
                "phrase": detection["phrase"],
                "confidence": detection["confidence"],
                "command": detection["has_command"],
                "mode": mode,
                "reference": reference,
                "generation": generation,
                "diagnostics": wake_diagnostics,
            }
        )
        if not detection["has_command"]:
            return
        await send_transcript(
            "final",
            detection["command_pcm"],
            mode,
            reference,
            generation,
            {**wake_diagnostics, "endpoint_reason": "wake_command"},
            True,
        )

    try:
        await send(
            {
                "type": "ready",
                **(recognizer.status() if recognizer else {}),
                "wake": wake_recognizer.status() if wake_recognizer else None,
            }
        )
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            if message.get("text") is not None:
                command = json.loads(message["text"])
                if command.get("type") == "configure":
                    session.configure(command.get("language"))
                    session.set_wake(
                        bool(command.get("wake_enabled")),
                        bool(command.get("wake_armed")),
                        command.get("wake_phrases") or [],
                    )
                    if session.wake_enabled and (wake_recognizer is None or not wake_recognizer.status()["ready"]):
                        error = wake_recognizer.status().get("error") if wake_recognizer else None
                        await send(
                            {
                                "type": "error",
                                "error": error
                                or "The dedicated wake-word recognizer is unavailable. No full STT fallback was used.",
                            }
                        )
                        continue
                    await send(
                        {
                            "type": "configured",
                            "language": session.language,
                            "wake_enabled": session.wake_enabled,
                            "wake_armed": session.wake_armed,
                        }
                    )
                    continue
                if command.get("type") == "wake":
                    session.set_wake(
                        bool(command.get("enabled")),
                        bool(command.get("armed")),
                        command.get("phrases") or [],
                    )
                    if session.wake_enabled and (wake_recognizer is None or not wake_recognizer.status()["ready"]):
                        error = wake_recognizer.status().get("error") if wake_recognizer else None
                        await send(
                            {
                                "type": "error",
                                "error": error
                                or "The dedicated wake-word recognizer is unavailable. No full STT fallback was used.",
                            }
                        )
                        continue
                    await send(
                        {
                            "type": "wake_state",
                            "wake_enabled": session.wake_enabled,
                            "wake_armed": session.wake_armed,
                        }
                    )
                    continue
                if command.get("type") == "state":
                    session.set_mode(command.get("mode", "paused"), command.get("reference", ""))
                    await send({"type": "state", "mode": session.mode})
                    continue
                if command.get("type") == "flush":
                    wake_armed = session.wake_armed
                    phrases = list(session.wake_phrases)
                    pcm, mode, reference, generation, diagnostics = session.finish("manual_flush")
                    if pcm:
                        if wake_armed:
                            await send_wake_candidate(pcm, mode, reference, generation, diagnostics, phrases)
                        else:
                            await send_transcript("final", pcm, mode, reference, generation, diagnostics)
                    continue
            data = message.get("bytes")
            if not data:
                continue
            for frame in session.frames(data):
                for event in session.push(frame):
                    if event["type"] == "speech_start":
                        await send(event)
                        continue
                    if event["type"] == "partial_ready":
                        if partial_task and not partial_task.done():
                            continue
                        partial_task = asyncio.create_task(
                            send_transcript(
                                "partial",
                                session.snapshot(),
                                session.mode,
                                session.reference,
                                event["generation"],
                                session.diagnostics(),
                            )
                        )
                        continue
                    if event["type"] == "endpoint_ready":
                        if partial_task and not partial_task.done():
                            continue
                        partial_task = asyncio.create_task(
                            send_transcript(
                                "partial",
                                session.snapshot(),
                                session.mode,
                                session.reference,
                                event["generation"],
                                session.diagnostics("endpoint_candidate"),
                            )
                        )
                        continue
                    if event["type"] == "discard":
                        await send(event)
                        continue
                    wake_armed = session.wake_armed
                    phrases = list(session.wake_phrases)
                    pcm, mode, reference, generation, diagnostics = session.finish(event.get("reason", "silence"))
                    if partial_task and not partial_task.done():
                        partial_task.cancel()
                    if wake_armed:
                        await send_wake_candidate(pcm, mode, reference, generation, diagnostics, phrases)
                        continue
                    await send_transcript("final", pcm, mode, reference, generation, diagnostics)
    except WebSocketDisconnect:
        return
    finally:
        if partial_task and not partial_task.done():
            partial_task.cancel()


@app.post("/v1/audio/transcriptions/replay")
async def replay_transcription(request: Request, language: str = "uk"):
    if recognizer is None:
        raise HTTPException(status_code=503, detail="The local STT runtime is unavailable.")
    if not recognizer.status()["ready"]:
        raise HTTPException(status_code=503, detail=recognizer.status().get("error") or "The local STT model is loading.")
    data = await request.body()
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Replay WAV exceeds the 25 MB limit.")
    try:
        pcm, diagnostics = decode_wav_pcm16(data)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    started = time.perf_counter()
    text = await recognizer.transcribe(pcm, language.split("-", 1)[0].lower() or None)
    return {
        "text": text,
        "language": language,
        "diagnostics": {
            **diagnostics,
            "transcription_ms": round((time.perf_counter() - started) * 1000),
            "endpoint_reason": "replay",
        },
    }
