import io
import unittest
import wave

from app.streaming_stt import STT_FRAME_BYTES, DuplexSession, decode_wav_pcm16, find_wake_phrase, semantic_complete


class VoiceActivity:
    def __init__(self, values):
        self.values = iter(values)

    def is_speech(self, _frame, _sample_rate):
        return next(self.values)


class DuplexSessionTest(unittest.TestCase):
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

    def test_does_not_match_unrelated_background_speech(self):
        words = [
            {"normalized": "сьогодні", "start": 0.1, "end": 0.4, "probability": 0.98},
            {"normalized": "сонячно", "start": 0.5, "end": 0.9, "probability": 0.97},
        ]

        self.assertIsNone(find_wake_phrase(words, ["джарвіс"]))


if __name__ == "__main__":
    unittest.main()
