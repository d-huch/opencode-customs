import asyncio
import io
import math
import os
import re
import wave
from collections import deque
from difflib import SequenceMatcher

import numpy as np
import webrtcvad
from faster_whisper import WhisperModel


STT_MODEL = os.getenv("STT_MODEL", "large-v3-turbo")
STT_WAKE_MODEL = os.getenv("STT_WAKE_MODEL", "tiny")
STT_DEVICE = os.getenv("STT_DEVICE", "cpu")
STT_COMPUTE_TYPE = os.getenv("STT_COMPUTE_TYPE", "int8")
STT_SAMPLE_RATE = 16_000
STT_FRAME_MS = 20
STT_FRAME_BYTES = STT_SAMPLE_RATE * STT_FRAME_MS // 1000 * 2
STT_PRE_ROLL_MS = int(os.getenv("STT_PRE_ROLL_MS", "700"))
STT_SILENCE_MS = int(os.getenv("STT_SILENCE_MS", "700"))
STT_ENDPOINT_COMMIT_MS = max(STT_SILENCE_MS, int(os.getenv("STT_ENDPOINT_COMMIT_MS", "1300")))
STT_SEMANTIC_GRACE_MS = int(os.getenv("STT_SEMANTIC_GRACE_MS", "1800"))
STT_SEMANTIC_MIN_SPEECH_MS = int(os.getenv("STT_SEMANTIC_MIN_SPEECH_MS", "1200"))
STT_PARTIAL_MS = int(os.getenv("STT_PARTIAL_MS", "2400"))
STT_MAX_PARTIALS = int(os.getenv("STT_MAX_PARTIALS", "2"))
STT_MAX_UTTERANCE_MS = int(os.getenv("STT_MAX_UTTERANCE_MS", "15000"))
STT_STREAM_WINDOW_MS = int(os.getenv("STT_STREAM_WINDOW_MS", "6000"))
STT_STREAM_COMMIT_MARGIN_MS = int(os.getenv("STT_STREAM_COMMIT_MARGIN_MS", "1600"))
STT_MIN_SPEECH_MS = int(os.getenv("STT_MIN_SPEECH_MS", "360"))
STT_MIN_RMS = float(os.getenv("STT_MIN_RMS", "0.0012"))
STT_VAD_MODE = int(os.getenv("STT_VAD_MODE", "2"))
STT_WAKE_MATCH_THRESHOLD = float(os.getenv("STT_WAKE_MATCH_THRESHOLD", "0.78"))
STT_WAKE_COMMAND_OVERLAP_MS = int(os.getenv("STT_WAKE_COMMAND_OVERLAP_MS", "80"))
STT_MIN_FINAL_CONFIDENCE = float(os.getenv("STT_MIN_FINAL_CONFIDENCE", "0.58"))

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

DISCOURSE_FILLERS = {
    "uk": {"е", "ем", "м", "не", "ну", "типу", "коротше", "значить"},
    "en": {"ah", "erm", "hmm", "like", "um", "uh", "well"},
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


def clean_transcript(text: str):
    sentences = []
    seen = set()
    current = ""
    for character in " ".join(text.split()):
        current += character
        if character not in ".!?…":
            continue
        normalized = normalize_transcript(current)
        if normalized and (len(normalized) < 8 or normalized not in seen):
            sentences.append(current.strip())
            seen.add(normalized)
        current = ""
    if current.strip():
        sentences.append(current.strip())
    words = " ".join(sentences).split()
    index = 0
    while index < len(words):
        duplicate = next(
            (
                size
                for size in range(min(16, (len(words) - index) // 2), 2, -1)
                if [normalize_transcript(word) for word in words[index : index + size]]
                == [normalize_transcript(word) for word in words[index + size : index + size * 2]]
            ),
            0,
        )
        if duplicate:
            del words[index + duplicate : index + duplicate * 2]
            continue
        index += 1
    return " ".join(words).strip()


def semantic_complete(text: str, language: str | None, stability: int):
    normalized = normalize_transcript(text)
    if not normalized:
        return False
    normalized_language = language or ""
    if normalized.rsplit(" ", 1)[-1] in OPEN_ENDINGS.get(normalized_language, set()):
        return False
    clauses = [normalize_transcript(item) for item in re.split(r"[.!?…]+", text) if normalize_transcript(item)]
    if clauses:
        trailing = [word for word in clauses[-1].split() if word not in DISCOURSE_FILLERS.get(normalized_language, set())]
        if len(clauses) > 1 and len(trailing) < 2:
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
            start + length,
            max(
                SequenceMatcher(
                    None,
                    " ".join(item["normalized"] for item in words[start : start + length]),
                    " ".join(tokens),
                ).ratio(),
                SequenceMatcher(
                    None,
                    "".join(item["normalized"] for item in words[start : start + length]),
                    "".join(tokens),
                ).ratio(),
            ),
        )
        for phrase, tokens in candidates
        for length in range(max(1, len(tokens) - 1), min(len(words), len(tokens) + 2) + 1)
        for start in range(len(words) - length + 1)
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
            "endpoint_commit_ms": STT_ENDPOINT_COMMIT_MS,
            "semantic_grace_ms": STT_SEMANTIC_GRACE_MS,
            "semantic_min_speech_ms": STT_SEMANTIC_MIN_SPEECH_MS,
            "partial_ms": STT_PARTIAL_MS,
            "max_partials": STT_MAX_PARTIALS,
            "min_speech_ms": STT_MIN_SPEECH_MS,
            "min_rms": STT_MIN_RMS,
        }

    async def transcribe(self, pcm: bytes, language: str | None):
        text, _diagnostics = await self.transcribe_final(pcm, language)
        return text

    async def transcribe_final(self, pcm: bytes, language: str | None):
        if self.model is None:
            raise RuntimeError(self.error or "The local STT model is still loading.")
        samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        async with self.lock:
            segments, info = await asyncio.to_thread(
                self.model.transcribe,
                samples,
                language=language,
                beam_size=1,
                best_of=1,
                condition_on_previous_text=False,
                vad_filter=True,
                word_timestamps=False,
            )
            materialized = list(segments)
        text = clean_transcript(" ".join(segment.text.strip() for segment in materialized if segment.text.strip()).strip())
        average_log_probability = (
            sum(getattr(segment, "avg_logprob", -10.0) for segment in materialized) / len(materialized)
            if materialized
            else -10.0
        )
        no_speech_probability = (
            sum(getattr(segment, "no_speech_prob", 1.0) for segment in materialized) / len(materialized)
            if materialized
            else 1.0
        )
        confidence = max(0.0, min(1.0, math.exp(average_log_probability) * (1 - no_speech_probability)))
        return text, {
            "final_confidence": round(confidence, 3),
            "average_log_probability": round(average_log_probability, 3),
            "no_speech_probability": round(no_speech_probability, 3),
            "language_probability": round(getattr(info, "language_probability", 0.0) or 0.0, 3),
        }

    async def transcribe_incremental(
        self,
        pcm: bytes,
        language: str | None,
        state: "IncrementalRecognitionState",
        generation: int,
        final: bool = False,
    ):
        if self.model is None:
            raise RuntimeError(self.error or "The local STT model is still loading.")
        if state.generation != generation or state.committed_bytes > len(pcm):
            state.reset(generation)
        pending = pcm if final else pcm[state.committed_bytes :]
        samples = np.frombuffer(pending, dtype="<i2").astype(np.float32) / 32768
        async with self.lock:
            segments, _info = await asyncio.to_thread(
                self.model.transcribe,
                samples,
                language=language,
                beam_size=5 if final else 1,
                best_of=1,
                condition_on_previous_text=False,
                initial_prompt=None,
                vad_filter=True,
                word_timestamps=False,
            )
            materialized = list(segments)
        state.decode_count += 1
        pending_ms = round(len(pending) / 2 / STT_SAMPLE_RATE * 1000)
        commit_before = max(0, pending_ms - STT_STREAM_COMMIT_MARGIN_MS) / 1000
        commit_count = 0
        if not final and pending_ms >= STT_STREAM_WINDOW_MS:
            for segment in materialized:
                if segment.end is None or segment.end > commit_before:
                    break
                commit_count += 1
        committed = [] if final else materialized[:commit_count]
        if committed:
            state.committed_text = " ".join(
                item for item in [state.committed_text, *(segment.text.strip() for segment in committed)] if item
            ).strip()
            advance = int(committed[-1].end * STT_SAMPLE_RATE * 2)
            advance -= advance % STT_FRAME_BYTES
            state.committed_bytes += max(0, advance)
        tail = materialized if final else materialized[commit_count:]
        text = clean_transcript(
            " ".join(
                item
                for item in ["" if final else state.committed_text, *(segment.text.strip() for segment in tail)]
                if item
            ).strip()
        )
        return text, {
            "incremental_decode": True,
            "decode_count": state.decode_count,
            "decoded_audio_ms": pending_ms,
            "committed_audio_ms": round(state.committed_bytes / 2 / STT_SAMPLE_RATE * 1000),
        }

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


class IncrementalRecognitionState:
    def __init__(self):
        self.generation = 0
        self.committed_bytes = 0
        self.committed_text = ""
        self.decode_count = 0

    def reset(self, generation: int):
        self.generation = generation
        self.committed_bytes = 0
        self.committed_text = ""
        self.decode_count = 0


class DuplexSession:
    def __init__(self):
        self.vad = webrtcvad.Vad(STT_VAD_MODE)
        self.mode = "paused"
        self.language: str | None = "uk"
        self.reference = ""
        self.pending = bytearray()
        self.pre_roll: deque[bytes] = deque(maxlen=max(1, STT_PRE_ROLL_MS // STT_FRAME_MS))
        self.utterance = bytearray()
        self.utterance_frames = 0
        self.speech_frames = 0
        self.silence_frames = 0
        self.partial_frame = 0
        self.partial_count = 0
        self.generation = 0
        self.transcript = ""
        self.transcript_text = ""
        self.transcript_speech_frames = 0
        self.transcript_stability = 0
        self.endpoint_candidate = False
        self.frame_rms = 0.0
        self.peak_rms = 0.0
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
        samples = np.frombuffer(frame, dtype="<i2").astype(np.float32) / 32768
        rms = float(np.sqrt(np.mean(samples * samples))) if samples.size else 0
        self.frame_rms = rms
        self.peak_rms = max(self.peak_rms, rms)
        detected_speech = self.vad.is_speech(frame, STT_SAMPLE_RATE)
        voiced = rms >= STT_MIN_RMS and detected_speech
        if not self.utterance:
            if not voiced:
                return []
            self.utterance.extend(b"".join(self.pre_roll))
            self.utterance_frames = 1
            self.speech_frames = 1
            self.silence_frames = 0
            self.partial_frame = 1
            self.partial_count = 0
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
        self.utterance_frames += 1
        self.speech_frames += 1 if voiced else 0
        self.silence_frames = 0 if voiced else self.silence_frames + 1
        if voiced and self.endpoint_candidate:
            self.endpoint_candidate = False
            self.transcript = ""
            self.transcript_text = ""
            self.transcript_speech_frames = 0
            self.transcript_stability = 0
        events = []
        if (
            not self.wake_armed
            and not self.endpoint_candidate
            and self.partial_count < STT_MAX_PARTIALS
            and (self.utterance_frames - self.partial_frame) * STT_FRAME_MS >= STT_PARTIAL_MS
        ):
            self.partial_frame = self.utterance_frames
            self.partial_count += 1
            events.append({"type": "partial_ready", "generation": self.generation})
        enough_speech = self.speech_frames * STT_FRAME_MS >= STT_MIN_SPEECH_MS
        silence_ms = self.silence_frames * STT_FRAME_MS
        ended = silence_ms >= STT_SILENCE_MS
        if ended and not enough_speech:
            diagnostics = self.diagnostics("noise_discarded")
            self.reset_utterance()
            return [{"type": "discard", "diagnostics": diagnostics}]
        if self.utterance_frames * STT_FRAME_MS >= STT_MAX_UTTERANCE_MS:
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
        if (
            silence_ms >= STT_ENDPOINT_COMMIT_MS
            and self.speech_frames * STT_FRAME_MS >= STT_SEMANTIC_MIN_SPEECH_MS
            and semantic_complete(
                self.transcript_text,
                self.language,
                self.transcript_stability,
            )
        ):
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
            events = [event for event in events if event["type"] != "partial_ready"]
            events.append({"type": "endpoint_ready", "generation": self.generation})
        return events

    def observe_transcript(self, text: str, generation: int, speech_frames: int | None = None):
        if generation != self.generation or not self.utterance:
            return False
        if speech_frames is not None and speech_frames != self.speech_frames:
            return False
        normalized = normalize_transcript(text)
        if not normalized:
            return False
        self.transcript_stability = self.transcript_stability + 1 if normalized == self.transcript else 1
        self.transcript = normalized
        self.transcript_text = text.strip()
        self.transcript_speech_frames = speech_frames if speech_frames is not None else self.speech_frames
        return True

    def cached_transcript(self):
        if not self.transcript_text or self.transcript_speech_frames != self.speech_frames:
            return ""
        return self.transcript_text

    def diagnostics(self, reason: str | None = None):
        return {
            "vad": "speech" if self.utterance and self.silence_frames == 0 else "silence",
            "audio_ms": round(len(self.utterance) / (STT_SAMPLE_RATE * 2) * 1000),
            "speech_ms": self.speech_frames * STT_FRAME_MS,
            "silence_ms": self.silence_frames * STT_FRAME_MS,
            "pre_roll_ms": STT_PRE_ROLL_MS,
            "transcript_stability": self.transcript_stability,
            "partial_count": self.partial_count,
            "frame_rms": round(self.frame_rms, 6),
            "peak_rms": round(self.peak_rms, 6),
            "min_rms": STT_MIN_RMS,
            "transcript_cache_ready": bool(self.cached_transcript()),
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
        self.utterance_frames = 0
        self.speech_frames = 0
        self.silence_frames = 0
        self.partial_frame = 0
        self.partial_count = 0
        self.transcript = ""
        self.transcript_text = ""
        self.transcript_speech_frames = 0
        self.transcript_stability = 0
        self.endpoint_candidate = False
        self.frame_rms = 0.0
        self.peak_rms = 0.0
