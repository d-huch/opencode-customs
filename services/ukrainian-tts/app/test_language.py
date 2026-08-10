import unittest

from app.language import adapt_mixed_latin, normalize_voice, segment_languages, transliterate_latin


class SegmentLanguagesTest(unittest.TestCase):
    def test_keeps_ukrainian_text_together(self):
        self.assertEqual(segment_languages("Привіт, як справи?"), [("uk", "Привіт, як справи?")])

    def test_routes_english_text_to_english(self):
        self.assertEqual(segment_languages("OpenCode Customs is ready."), [("en", "OpenCode Customs is ready.")])

    def test_preserves_mixed_language_order(self):
        self.assertEqual(
            segment_languages("Привіт! OpenCode Customs is ready. Як справи?"),
            [("uk", "Привіт!"), ("en", "OpenCode Customs is ready."), ("uk", "Як справи?")],
        )

    def test_splits_mixed_script_compounds(self):
        self.assertEqual(
            segment_languages("TTS-модель підтримує English голос."),
            [("en", "TTS-"), ("uk", "модель підтримує"), ("en", "English"), ("uk", "голос.")],
        )

    def test_migrates_legacy_quality_voice(self):
        self.assertEqual(normalize_voice("quality", "ukrainian"), "kateryna")

    def test_migrates_quality_voice_when_switching_to_fast(self):
        self.assertEqual(normalize_voice("fast", "tetiana"), "ukrainian_tts")

    def test_transliterates_short_latin_fragments_in_ukrainian_text(self):
        self.assertEqual(transliterate_latin("API ready"), "ей пі ай реадй")
        self.assertEqual(
            adapt_mixed_latin(segment_languages("Сервіс Jarvis ready.")),
            [("uk", "Сервіс Джарвіс реадй.")],
        )

    def test_keeps_complete_english_responses_on_the_english_voice(self):
        segments = segment_languages("This is a complete English response.")
        self.assertEqual(adapt_mixed_latin(segments), segments)


if __name__ == "__main__":
    unittest.main()
