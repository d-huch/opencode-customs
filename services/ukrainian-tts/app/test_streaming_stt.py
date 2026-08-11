import asyncio
import io
import unittest
import wave
from types import SimpleNamespace

import numpy as np

from app.streaming_stt import (
    STT_FRAME_BYTES,
    STT_SAMPLE_RATE,
    DuplexSession,
    IncrementalRecognitionState,
    StreamingRecognizer,
    decode_wav_pcm16,
    find_wake_phrase,
    semantic_complete,
)


class VoiceActivity:
    def __init__(self, values):
        self.values = iter(values)

    def is_speech(self, _frame, _sample_rate):
        return next(self.values)


class FakeWhisperModel:
    def __init__(self):
        self.calls = []

    def transcribe(self, samples, **options):
        self.calls.append((len(samples), options))
        if len(self.calls) == 1:
            return iter(
                [
                    SimpleNamespace(text=" Перше.", end=1.0),
                    SimpleNamespace(text=" Друге.", end=3.0),
                    SimpleNamespace(text=" Незавершене", end=6.5),
                ]
            ), None
        return iter([SimpleNamespace(text=" Завершення.", end=4.5)]), None


class DuplexSessionTest(unittest.TestCase):
    def test_incremental_recognition_commits_stable_audio_and_decodes_only_the_tail(self):
        recognizer = StreamingRecognizer()
        recognizer.model = FakeWhisperModel()
        recognizer.loading = False
        state = IncrementalRecognitionState()
        first = np.zeros(STT_SAMPLE_RATE * 7, dtype="<i2").tobytes()
        second = np.zeros(STT_SAMPLE_RATE * 8, dtype="<i2").tobytes()

        text, diagnostics = asyncio.run(recognizer.transcribe_incremental(first, "uk", state, 1))
        final, final_diagnostics = asyncio.run(recognizer.transcribe_incremental(second, "uk", state, 1, True))

        self.assertEqual(text, "Перше. Друге. Незавершене")
        self.assertEqual(state.committed_text, "Перше. Друге.")
        self.assertEqual(diagnostics["committed_audio_ms"], 3000)
        self.assertEqual(final, "Перше. Друге. Завершення.")
        self.assertEqual(recognizer.model.calls[0][0], STT_SAMPLE_RATE * 7)
        self.assertEqual(recognizer.model.calls[1][0], STT_SAMPLE_RATE * 5)
        self.assertEqual(recognizer.model.calls[1][1]["initial_prompt"], "Перше. Друге.")
        self.assertEqual(final_diagnostics["decode_count"], 2)

    def test_incremental_recognition_resets_state_for_a_new_utterance(self):
        recognizer = StreamingRecognizer()
        recognizer.model = FakeWhisperModel()
        recognizer.loading = False
        state = IncrementalRecognitionState()
        state.generation = 1
        state.committed_bytes = STT_SAMPLE_RATE * 2
        state.committed_text = "Старий текст"
        state.decode_count = 4

        asyncio.run(
            recognizer.transcribe_incremental(
                np.zeros(STT_SAMPLE_RATE, dtype="<i2").tobytes(),
                "uk",
                state,
                2,
            )
        )

        self.assertEqual(state.generation, 2)
        self.assertEqual(state.committed_text, "")
        self.assertEqual(state.decode_count, 1)
    def test_decode_wav_pcm16_resamples_stereo_audio(self):
        source = io.BytesIO()
        with wave.open(source, "wb") as target:
            target.setnchannels(2)
            target.setsampwidth(2)
            target.setframerate(8_000)
            target.writeframes((b"\x10\x00\x10\x00") * 80)
        pcm, diagnostics = decode_wav_pcm16(source.getvalue())
        self.assertEqual(
            diagnostics,
            {"source_sample_rate": 8_000, "sample_rate": 16_000, "channels": 2, "audio_ms": 10},
        )
        self.assertEqual(len(pcm), 320)

    def test_decode_wav_pcm16_rejects_invalid_input(self):
        with self.assertRaisesRegex(ValueError, "valid WAV"):
            decode_wav_pcm16(b"not a wav")

    def test_semantic_endpoint_keeps_an_open_ukrainian_phrase_listening(self):
        self.assertFalse(semantic_complete("Розкажи мені про.", "uk", 3))
        self.assertTrue(semantic_complete("Як мене звати?", "uk", 1))

    def test_semantic_endpoint_accepts_a_stable_unpunctuated_phrase(self):
        self.assertFalse(semantic_complete("покажи останні логи", "uk", 1))
        self.assertTrue(semantic_complete("покажи останні логи", "uk", 2))

    def test_preserves_audio_before_speech_in_pre_roll(self):
        session = DuplexSession()
        session.set_mode("listening")
        session.vad = VoiceActivity([False, True])
        silence = bytes(STT_FRAME_BYTES)
        speech = bytes([1]) * STT_FRAME_BYTES

        self.assertEqual(session.push(silence), [])
        self.assertEqual(session.push(speech)[0]["type"], "speech_start")
        self.assertEqual(session.snapshot(), silence + speech)

    def test_paused_mode_never_starts_an_utterance(self):
        session = DuplexSession()
        session.vad = VoiceActivity([True])

        self.assertEqual(session.push(bytes([1]) * STT_FRAME_BYTES), [])
        self.assertEqual(session.snapshot(), b"")

    def test_discards_a_short_noise_burst_after_silence(self):
        session = DuplexSession()
        session.set_mode("speaking", "reference speech")
        session.vad = VoiceActivity([True, *([False] * 35)])
        frame = bytes([1]) * STT_FRAME_BYTES

        self.assertEqual(session.push(frame)[0]["type"], "speech_start")
        events = []
        for _ in range(35):
            events = session.push(bytes(STT_FRAME_BYTES))

        self.assertEqual(events[0]["type"], "discard")
        self.assertEqual(events[0]["diagnostics"]["endpoint_reason"], "noise_discarded")
        self.assertEqual(session.snapshot(), b"")

    def test_short_pause_requests_endpoint_transcription_before_finalizing(self):
        session = DuplexSession()
        session.set_mode("listening")
        session.vad = VoiceActivity([*([True] * 10), *([False] * 35)])
        frame = bytes([1]) * STT_FRAME_BYTES

        for _ in range(10):
            session.push(frame)
        events = []
        for _ in range(35):
            events = session.push(bytes(STT_FRAME_BYTES))

        self.assertEqual(events, [{"type": "endpoint_ready", "generation": 1}])
        self.assertNotEqual(session.snapshot(), b"")

    def test_partial_cadence_uses_received_audio_instead_of_wall_clock(self):
        session = DuplexSession()
        session.set_mode("listening")
        session.vad = VoiceActivity([True] * 46)
        frame = bytes([1]) * STT_FRAME_BYTES

        events = []
        for _ in range(46):
            events.extend(session.push(frame))

        self.assertEqual(sum(event["type"] == "partial_ready" for event in events), 1)
        self.assertEqual(session.diagnostics()["speech_ms"], 920)

    def test_endpoint_transcript_can_be_reused_after_only_more_silence(self):
        session = DuplexSession()
        session.set_mode("listening")
        session.vad = VoiceActivity([*([True] * 10), *([False] * 50)])
        frame = bytes([1]) * STT_FRAME_BYTES

        for _ in range(10):
            session.push(frame)
        for _ in range(35):
            session.push(bytes(STT_FRAME_BYTES))
        session.observe_transcript("Як мене звати?", 1, 10)
        events = []
        for _ in range(15):
            events.extend(session.push(bytes(STT_FRAME_BYTES)))
            if any(event["type"] == "final_ready" for event in events):
                break

        self.assertEqual(session.cached_transcript(), "Як мене звати?")
        self.assertEqual(events[-1]["type"], "final_ready")
        self.assertEqual(events[-1]["reason"], "semantic_complete")

    def test_speech_resuming_before_endpoint_commit_keeps_one_utterance(self):
        session = DuplexSession()
        session.set_mode("listening")
        session.vad = VoiceActivity([*([True] * 10), *([False] * 45), True])
        frame = bytes([1]) * STT_FRAME_BYTES

        for _ in range(10):
            session.push(frame)
        events = []
        for _ in range(45):
            events.extend(session.push(bytes(STT_FRAME_BYTES)))
        session.observe_transcript("Розкажи мені.", 1)
        resumed = session.push(frame)

        self.assertFalse(any(event["type"] == "final_ready" for event in events))
        self.assertEqual(resumed, [{"type": "partial_ready", "generation": 1}])
        self.assertEqual(session.generation, 1)
        self.assertEqual(session.transcript, "")
        self.assertEqual(session.cached_transcript(), "")

    def test_rejects_a_partial_that_completed_after_more_speech_arrived(self):
        session = DuplexSession()
        session.set_mode("listening")
        session.vad = VoiceActivity([True, True])
        frame = bytes([1]) * STT_FRAME_BYTES

        session.push(frame)
        session.push(frame)
        session.observe_transcript("Застарілий текст", 1, 1)

        self.assertEqual(session.cached_transcript(), "")
        self.assertEqual(session.transcript, "")

    def test_wake_gate_finishes_without_requesting_full_stt_partials(self):
        session = DuplexSession()
        session.set_mode("listening")
        session.set_wake(True, True, ["джарвіс"])
        session.vad = VoiceActivity([*([True] * 10), *([False] * 35)])
        frame = bytes([1]) * STT_FRAME_BYTES

        events = []
        for _ in range(10):
            events.extend(session.push(frame))
        for _ in range(35):
            events.extend(session.push(bytes(STT_FRAME_BYTES)))

        self.assertFalse(any(event["type"] == "partial_ready" for event in events))
        self.assertEqual(events[-1]["type"], "final_ready")
        self.assertEqual(events[-1]["reason"], "wake_candidate")

    def test_matches_a_configured_wake_phrase_and_preserves_command_boundary(self):
        words = [
            {"normalized": "джарвіс", "start": 0.2, "end": 0.7, "probability": 0.96},
            {"normalized": "відкрий", "start": 0.75, "end": 1.1, "probability": 0.91},
            {"normalized": "проєкт", "start": 1.1, "end": 1.5, "probability": 0.94},
        ]

        match = find_wake_phrase(words, ["джарвіс", "open code"])

        self.assertIsNotNone(match)
        self.assertEqual(match["phrase"], "джарвіс")
        self.assertTrue(match["has_command"])
        self.assertEqual(match["end"], 1)

    def test_matches_a_wake_phrase_split_into_multiple_recognizer_tokens(self):
        words = [
            {"normalized": "джар", "start": 0.2, "end": 0.45, "probability": 0.94},
            {"normalized": "віс", "start": 0.45, "end": 0.7, "probability": 0.93},
            {"normalized": "покажи", "start": 0.75, "end": 1.1, "probability": 0.91},
        ]

        match = find_wake_phrase(words, ["джарвіс"])

        self.assertIsNotNone(match)
        self.assertEqual(match["start"], 0)
        self.assertEqual(match["end"], 2)
        self.assertTrue(match["has_command"])

    def test_does_not_match_unrelated_background_speech(self):
        words = [
            {"normalized": "сьогодні", "start": 0.1, "end": 0.4, "probability": 0.98},
            {"normalized": "сонячно", "start": 0.5, "end": 0.9, "probability": 0.97},
        ]

        self.assertIsNone(find_wake_phrase(words, ["джарвіс"]))


if __name__ == "__main__":
    unittest.main()
