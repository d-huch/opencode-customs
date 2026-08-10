import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

class UkrainianAccentor:
    def __init__(self, dictionary_path: Path):
        from stress_uk import stressify_text

        self.overrides = json.loads(dictionary_path.read_text(encoding="utf-8"))
        self.stressify = stressify_text

    @lru_cache(maxsize=4096)
    def replace(self, text: str):
        replaced = text
        for source, pronunciation in sorted(self.overrides.items(), key=lambda item: len(item[0]), reverse=True):
            replaced = re.sub(re.escape(source), pronunciation, replaced, flags=re.IGNORECASE)
        return replaced

    @lru_cache(maxsize=4096)
    def prepare(self, text: str):
        return accent_to_silero(self.stressify(self.replace(text)))


def accent_to_silero(text: str):
    output = []
    for character in unicodedata.normalize("NFD", text):
        if character != "\u0301":
            output.append(character)
            continue
        index = len(output) - 1
        while index >= 0 and not output[index].isalpha():
            index -= 1
        if index >= 0 and (index == 0 or output[index - 1] != "+"):
            output.insert(index, "+")
    return unicodedata.normalize("NFC", "".join(output))
