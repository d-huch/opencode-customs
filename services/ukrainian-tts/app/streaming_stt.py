import asyncio
import io
import os
import time
import wave
from collections import deque
from difflib import SequenceMatcher

import numpy as np
import webrtcvad
from faster_whisper import WhisperModel


STT_MODEL = os.getenv("STT_MODEL", "small")
STT_WAKE_MODEL = os.getenv("STT_WAKE_MODEL", "tiny")
STT_DEVICE = os.getenv("STT_DEVICE", "cpu")
STT_COMPUTE_TYPE = os.getenv("STT_COMPUTE_TYPE", "int8")
STT_SAMPLE_RATE = 16_000
STT_FRAME_MS = 20
STT_FRAME_BYTES = STT_SAMPLE_RATE * STT_FRAME_MS // 1000 * 2
STT_PRE_ROLL_MS = int(os.getenv("STT_PRE_ROLL_MS", "1500"))
STT_SILENCE_MS = int(os.getenv("STT_SILENCE_MS", "700"))
STT_SEMANTIC_GRACE_MS = int(os.getenv("STT_SEMANTIC_GRACE_MS", "1800"))
STT_PARTIAL_MS = int(os.getenv("STT_PARTIAL_MS", "900"))
STT_MAX_UTTERANCE_MS = int(os.getenv("STT_MAX_UTTERANCE_MS", "20000"))
STT_MIN_SPEECH_MS = int(os.getenv("STT_MIN_SPEECH_MS", "180"))
STT_VAD_MODE = int(os.getenv("STT_VAD_MODE", "2"))
STT_WAKE_MATCH_THRESHOLD = float(os.getenv("STT_WAKE_MATCH_THRESHOLD", "0.78"))
STT_WAKE_COMMAND_OVERLAP_MS = int(os.getenv("STT_WAKE_COMMAND_OVERLAP_MS", "80"))

OPEN_ENDINGS = {
    "uk": {
        "а",
        "аби",
        "але",
        "або",
        "без",
        "біля",
        "в",
        "від",
        "для",
        "до",
        "де",
        "з",
        "за",
        "і",
        "із",
        "коли",
        "на",
        "над",
        "під",
        "по",
        "про",
        "та",
        "у",
        "через",
        "що",
        "щоб",
        "як",
        "яка",
        "яке",
        "який",
        "які",
    },
    "en": {
        "about",
        "and",
        "at",
        "because",
        "for",
        "from",
        "if",
        "in",
        "of",
        "on",
        "or",
        "that",
        "to",
        "when",
        "where",
        "which",
        "who",
        "with",
    },
}


def decode_wav_pcm16(data: bytes):
    try:
        with wave.open(io.BytesIO(data), "rb") as source:
            channels = source.getnchannels()
            sample_width = source.getsampwidth()
            sample_rate = source.getframerate()
            frames = source.readframes(source.getnframes())
    except (EOFError, wave.Error) as error:
        raise ValueError("Replay input must be a valid WAV file.") from error
    if sample_width != 2:
        raise ValueError("Replay WAV must use 16-bit PCM samples.")
    if channels not in {1, 2}:
        raise ValueError("Replay WAV must contain one or two channels.")
    samples = np.frombuffer(frames, dtype="<i2").astype(np.float32)
    if channels == 2:
        samples = samples.reshape(-1, 2).mean(axis=1)
    if sample_rate != STT_SAMPLE_RATE and samples.size:
        target_size = max(1, round(samples.size * STT_SAMPLE_RATE / sample_rate))
        samples = np.interp(
            np.linspace(0, max(0, samples.size - 1), target_size),
            np.arange(samples.size),
            samples,
        )
    pcm = np.clip(np.rint(samples), -32768, 32767).astype("<i2").tobytes()
    return pcm, {
        "source_sample_rate": sample_rate,
        "sample_rate": STT_SAMPLE_RATE,
        "channels": channels,
        "audio_ms": round(len(pcm) / 2 / STT_SAMPLE_RATE * 1000),
    }


def normalize_transcript(text: str):
    return " ".join("".join(character.lower() if character.isalnum() else " " for character in text).split())


def semantic_complete(text: str, language: str | None, stability: int):
    normalized = normalize_transcript(text)
    if not normalized:
        return False
    if normalized.rsplit(" ", 1)[-1] in OPEN_ENDINGS.get(language or "", set()):
        return False
    if text.rstrip().endswith(("?", "!", ".", "…")):
        return True
    return stability >= 2


def find_wake_phrase(words: list[dict], phrases: list[str]):
    candidates = [
        (phrase, normalize_transcript(phrase).split())
        for phrase in phrases[:8]
        if normalize_transcript(phrase)
    ]
    windows = [
        (
            phrase,
            start,
            start + len(tokens),
            SequenceMatcher(
                None,
                " ".join(item["normalized"] for item in words[start : start + len(tokens)]),
                " ".join(tokens),
            ).ratio(),
        )
        for phrase, tokens in candidates
        for start in range(max(0, len(words) - len(tokens) + 1))
    ]
    if not windows:
        return None
    phrase, start, end, score = max(windows, key=lambda item: item[3])
    if score < STT_WAKE_MATCH_THRESHOLD:
        return None
    probabilities = [item["probability"] for item in words[start:end] if item["probability"] is not None]
    confidence = score if not probabilities else (score + sum(probabilities) / len(probabilities)) / 2
    return {
        "phrase": phrase,
        "start": start,
        "end": end,
        "confidence": round(confidence, 3),
        "has_command": end < len(words),
        "command_start_ms": max(0, round(words[end - 1]["end"] * 1000) - STT_WAKE_COMMAND_OVERLAP_MS),
    }


class StreamingRecognizer:
    def __init__(self, model_name: str = STT_MODEL):
        self.model_name = model_name
        self.model: WhisperModel | None = None
        self.error: str | None = None
        self.loading = True
        self.lock = asyncio.Lock()

    async def load(self):
        try:
            self.model = await asyncio.to_thread(
                WhisperModel,
                self.model_name,
                device=STT_DEVICE,
                compute_type=STT_COMPUTE_TYPE,
            )
        except Exception as error:
            self.error = str(error)
        finally:
            self.loading = False

    def status(self):
        return {
            "ready": self.model is not None,
            "loading": self.loading,
            "error": self.error,
            "model": self.model_name,
            "sample_rate": STT_SAMPLE_RATE,
            "frame_ms": STT_FRAME_MS,
            "pre_roll_ms": STT_PRE_ROLL_MS,
            "silence_ms": STT_SILENCE_MS,
            "semantic_grace_ms": STT_SEMANTIC_GRACE_MS,
        }

    async def transcribe(self, pcm: bytes, language: str | None):
        if self.model is None:
            raise RuntimeError(self.error or "The local STT model is still loading.")
        samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        async with self.lock:
            segments, _info = await asyncio.to_thread(
                self.model.transcribe,
                samples,
                language=language,
                beam_size=1,
                best_of=1,
                condition_on_previous_text=False,
                vad_filter=False,
                word_timestamps=False,
            )
            return " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()

    async def transcribe_words(self, pcm: bytes, language: str | None):
        if self.model is None:
            raise RuntimeError(self.error or "The local wake-word model is still loading.")
        samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        async with self.lock:
            segments, _info = await asyncio.to_thread(
                self.model.transcribe,
                samples,
                language=language,
                beam_size=1,
                best_of=1,
                condition_on_previous_text=False,
                vad_filter=False,
                word_timestamps=True,
            )
            materialized = list(segments)
        words = [
            {
                "text": word.word.strip(),
                "normalized": normalize_transcript(word.word),
                "start": word.start,
                "end": word.end,
                "probability": word.probability,
            }
            for segment in materialized
            for word in (segment.words or [])
            if normalize_transcript(word.word)
        ]
        return " ".join(segment.text.strip() for segment in materialized if segment.text.strip()).strip(), words


class WakeWordRecognizer(StreamingRecognizer):
    def __init__(self):
        super().__init__(STT_WAKE_MODEL)

    async def detect(self, pcm: bytes, language: str | None, phrases: list[str]):
        text, words = await self.transcribe_words(pcm, language)
        match = find_wake_phrase(words, phrases)
        if not match:
            return {"matched": False, "text": text}
        command_start = round(match["command_start_ms"] * STT_SAMPLE_RATE * 2 / 1000)
        return {
            "matched": True,
            "text": text,
            **match,
            "command_pcm": pcm[command_start:] if match["has_command"] else b"",
        }


class DuplexSession:
    def __init__(self):
        self.vad = webrtcvad.Vad(STT_VAD_MODE)
        self.mode = "paused"
        self.language: str | None = "uk"
        self.reference = ""
        self.pending = bytearray()
        self.pre_roll: deque[bytes] = deque(maxlen=max(1, STT_PRE_ROLL_MS // STT_FRAME_MS))
        self.utterance = bytearray()
        self.speech_frames = 0
        self.silence_frames = 0
        self.started_at = 0.0
        self.partial_at = 0.0
        self.generation = 0
        self.transcript = ""
        self.transcript_stability = 0
        self.endpoint_candidate = False
        self.wake_enabled = False
        self.wake_armed = False
        self.wake_phrases: list[str] = []

    def configure(self, language: str | None):
        self.language = language.split("-", 1)[0].lower() if language else None

    def set_wake(self, enabled: bool, armed: bool, phrases: list[str]):
        next_phrases = [item.strip()[:80] for item in phrases[:8] if item.strip()]
        changed = self.wake_armed != (enabled and armed) or self.wake_phrases != next_phrases
        self.wake_enabled = enabled
        self.wake_armed = enabled and armed
        self.wake_phrases = next_phrases
        if changed and self.utterance:
            self.reset_utterance()

    def set_mode(self, mode: str, reference: str = ""):
        if mode not in {"paused", "listening", "speaking"}:
            raise ValueError("STT mode must be 'paused', 'listening', or 'speaking'.")
        self.mode = mode
        self.reference = reference[:6_000]
        if mode != "paused":
            return
        self.reset_utterance()

    def frames(self, data: bytes):
        self.pending.extend(data)
        result = []
        while len(self.pending) >= STT_FRAME_BYTES:
            result.append(bytes(self.pending[:STT_FRAME_BYTES]))
            del self.pending[:STT_FRAME_BYTES]
        return result

    def push(self, frame: bytes):
        self.pre_roll.append(frame)
        if self.mode == "paused":
            return []
        voiced = self.vad.is_speech(frame, STT_SAMPLE_RATE)
        if not self.utterance:
            if not voiced:
                return []
            self.utterance.extend(b"".join(self.pre_roll))
            self.speech_frames = 1
            self.silence_frames = 0
            self.started_at = time.monotonic()
            self.partial_at = self.started_at
            self.generation += 1
            return [
                {
                    "type": "speech_start",
                    "mode": self.mode,
                    "generation": self.generation,
                    "diagnostics": self.diagnostics(),
                }
            ]

        self.utterance.extend(frame)
        self.speech_frames += 1 if voiced else 0
        self.silence_frames = 0 if voiced else self.silence_frames + 1
        if voiced and self.endpoint_candidate:
            self.endpoint_candidate = False
            self.transcript = ""
            self.transcript_stability = 0
        elapsed_ms = (time.monotonic() - self.started_at) * 1000
        events = []
        if not self.wake_armed and (time.monotonic() - self.partial_at) * 1000 >= STT_PARTIAL_MS:
            self.partial_at = time.monotonic()
            events.append({"type": "partial_ready", "generation": self.generation})
        enough_speech = self.speech_frames * STT_FRAME_MS >= STT_MIN_SPEECH_MS
        silence_ms = self.silence_frames * STT_FRAME_MS
        ended = silence_ms >= STT_SILENCE_MS
        if ended and not enough_speech:
            diagnostics = self.diagnostics("noise_discarded")
            self.reset_utterance()
            return [{"type": "discard", "diagnostics": diagnostics}]
        if elapsed_ms >= STT_MAX_UTTERANCE_MS:
            events.append(
                {
                    "type": "final_ready",
                    "generation": self.generation,
                    "reason": "wake_candidate" if self.wake_armed else "max_duration",
                }
            )
            return events
        if not ended:
            return events
        if self.wake_armed:
            events.append(
                {
                    "type": "final_ready",
                    "generation": self.generation,
                    "reason": "wake_candidate",
                }
            )
            return events
        if semantic_complete(self.transcript, self.language, self.transcript_stability):
            events.append(
                {
                    "type": "final_ready",
                    "generation": self.generation,
                    "reason": "semantic_complete",
                }
            )
            return events
        if silence_ms >= STT_SEMANTIC_GRACE_MS:
            events.append(
                {
                    "type": "final_ready",
                    "generation": self.generation,
                    "reason": "semantic_grace_elapsed",
                }
            )
            return events
        if not self.endpoint_candidate:
            self.endpoint_candidate = True
            events.append({"type": "endpoint_ready", "generation": self.generation})
        return events

    def observe_transcript(self, text: str, generation: int):
        if generation != self.generation or not self.utterance:
            return
        normalized = normalize_transcript(text)
        if not normalized:
            return
        self.transcript_stability = self.transcript_stability + 1 if normalized == self.transcript else 1
        self.transcript = normalized

    def diagnostics(self, reason: str | None = None):
        return {
            "vad": "speech" if self.utterance and self.silence_frames == 0 else "silence",
            "audio_ms": round(len(self.utterance) / (STT_SAMPLE_RATE * 2) * 1000),
            "speech_ms": self.speech_frames * STT_FRAME_MS,
            "silence_ms": self.silence_frames * STT_FRAME_MS,
            "pre_roll_ms": STT_PRE_ROLL_MS,
            "transcript_stability": self.transcript_stability,
            "endpoint_reason": reason,
            "wake_armed": self.wake_armed,
        }

    def snapshot(self):
        return bytes(self.utterance)

    def finish(self, reason: str = "flush"):
        pcm = bytes(self.utterance)
        mode = self.mode
        reference = self.reference
        generation = self.generation
        diagnostics = self.diagnostics(reason)
        self.reset_utterance()
        return pcm, mode, reference, generation, diagnostics

    def reset_utterance(self):
        self.utterance.clear()
        self.speech_frames = 0
        self.silence_frames = 0
        self.started_at = 0.0
        self.partial_at = 0.0
        self.transcript = ""
        self.transcript_stability = 0
        self.endpoint_candidate = False
