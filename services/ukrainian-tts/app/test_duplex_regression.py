import unittest

from app.duplex_regression import replay_stream, report_wake
from app.streaming_stt import STT_FRAME_BYTES, DuplexSession


class VoiceActivity:
    def __init__(self, values):
        self.values = iter(values)

    def is_speech(self, _frame, _sample_rate):
        return next(self.values)


class DuplexRegressionTest(unittest.IsolatedAsyncioTestCase):
    def test_wake_report_replaces_raw_command_audio_with_its_size(self):
        report = report_wake({"matched": True, "text": "Джарвіс покажи", "command_pcm": b"\xff\x00\xfe"})

        self.assertEqual(
            report,
            {"matched": True, "text": "Джарвіс покажи", "command_pcm_bytes": 3},
        )

    async def test_internal_pause_runs_one_separate_final_decode_after_preview(self):
        session = DuplexSession()
        session.vad = VoiceActivity([*([True] * 20), *([False] * 45), *([True] * 20), *([False] * 100)])
        transcriptions = 0

        async def transcribe(_pcm, _language):
            nonlocal transcriptions
            transcriptions += 1
            return "Розкажи мені про" if transcriptions == 1 else "Розкажи мені про Мобі Діка."

        result = await replay_stream(
            [
                bytes([1]) * STT_FRAME_BYTES * 20,
                bytes(STT_FRAME_BYTES * 45),
                bytes([1]) * STT_FRAME_BYTES * 20,
                bytes(STT_FRAME_BYTES * 100),
            ],
            "listening",
            "",
            "uk",
            transcribe,
            session=session,
        )

        finals = [event for event in result["events"] if event["type"] == "final"]
        self.assertEqual(len(finals), 1)
        self.assertEqual(finals[0]["input_index"], 3)
        self.assertEqual(result["transcript"], "Розкажи мені про Мобі Діка.")
        self.assertEqual(transcriptions, 3)
        self.assertEqual(result["diagnostics"]["transcription_cache"], "miss")

    async def test_low_background_noise_does_not_create_an_utterance(self):
        session = DuplexSession()
        session.vad = VoiceActivity([False] * 50)

        async def transcribe(_pcm, _language):
            self.fail("Noise without an utterance must not reach STT.")

        result = await replay_stream(
            [bytes(STT_FRAME_BYTES * 50)],
            "listening",
            "",
            "uk",
            transcribe,
            session=session,
        )

        self.assertEqual(result["transcript"], "")
        self.assertEqual(result["events"], [])


if __name__ == "__main__":
    unittest.main()
