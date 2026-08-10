import unittest
import json
from pathlib import Path

from app.accent import UkrainianAccentor, accent_to_silero


class AccentToSileroTest(unittest.TestCase):
    def test_moves_combining_accent_before_vowel(self):
        self.assertEqual(accent_to_silero("Ка́стомс"), "К+астомс")

    def test_preserves_existing_silero_stress(self):
        self.assertEqual(accent_to_silero("О́пенК+од"), "+ОпенК+од")

    def test_keeps_unaccented_text(self):
        self.assertEqual(accent_to_silero("Привіт!"), "Привіт!")

    def test_replaces_known_english_names_before_language_routing(self):
        accentor = UkrainianAccentor.__new__(UkrainianAccentor)
        accentor.overrides = json.loads(Path(__file__).with_name("pronunciations.json").read_text(encoding="utf-8"))
        self.assertEqual(accentor.replace("OpenCode Customs готовий"), "О́пенКо́д Ка́стомс готовий")


if __name__ == "__main__":
    unittest.main()
