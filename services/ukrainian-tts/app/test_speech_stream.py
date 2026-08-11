import io
import unittest
import wave

from app.main import STREAM_CHUNK_CHARS, split_stream_text, wav_pcm16


class SpeechStreamTest(unittest.TestCase):
    def test_splits_at_natural_boundaries_with_a_bounded_chunk_size(self):
        text = "Перше коротке речення. Друге речення трохи довше, але також має природну паузу. Третє."

        chunks = split_stream_text(text)

        self.assertEqual(" ".join(chunks), text)
        self.assertTrue(all(len(chunk) <= STREAM_CHUNK_CHARS for chunk in chunks))

    def test_splits_a_long_sentence_without_losing_words(self):
        text = " ".join(f"слово{index}" for index in range(60))

        chunks = split_stream_text(text)

        self.assertEqual(" ".join(chunks), text)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(chunk) <= STREAM_CHUNK_CHARS for chunk in chunks))

    def test_extracts_raw_pcm_and_sample_rate_from_streaming_wav(self):
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(24000)
            audio.writeframes(b"\x01\x00\xff\x7f")

        pcm, sample_rate = wav_pcm16(buffer.getvalue())

        self.assertEqual(pcm, b"\x01\x00\xff\x7f")
        self.assertEqual(sample_rate, 24000)

    def test_rejects_non_mono_streaming_audio(self):
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as audio:
            audio.setnchannels(2)
            audio.setsampwidth(2)
            audio.setframerate(24000)
            audio.writeframes(b"\x00" * 8)

        with self.assertRaisesRegex(ValueError, "mono 16-bit PCM"):
            wav_pcm16(buffer.getvalue())


if __name__ == "__main__":
    unittest.main()
