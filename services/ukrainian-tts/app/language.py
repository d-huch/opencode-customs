import re


LETTER_NAMES = {
    "a": "ей", "b": "бі", "c": "сі", "d": "ді", "e": "і", "f": "еф", "g": "джі", "h": "ейч",
    "i": "ай", "j": "джей", "k": "кей", "l": "ел", "m": "ем", "n": "ен", "o": "оу", "p": "пі",
    "q": "к'ю", "r": "ар", "s": "ес", "t": "ті", "u": "ю", "v": "ві", "w": "дабл'ю", "x": "екс",
    "y": "вай", "z": "зі",
}


def transliterate_latin(text: str):
    def word(match: re.Match[str]):
        value = match.group(0)
        if len(value) > 1 and value.isupper():
            return " ".join(LETTER_NAMES[character.lower()] for character in value)
        output = value.lower()
        for source, target in (
            ("tion", "шн"), ("sion", "жн"), ("tch", "ч"), ("sch", "ш"), ("sh", "ш"),
            ("ch", "ч"), ("th", "т"), ("ph", "ф"), ("zh", "ж"), ("kh", "х"), ("qu", "кв"),
            ("ck", "к"), ("ee", "і"), ("oo", "у"), ("ya", "я"), ("ye", "є"), ("yi", "ї"), ("yu", "ю"),
        ):
            output = output.replace(source, target)
        output = re.sub(r"c(?=[eiy])", "с", output)
        output = output.translate(str.maketrans({
            "a": "а", "b": "б", "c": "к", "d": "д", "e": "е", "f": "ф", "g": "ґ", "h": "х",
            "i": "і", "j": "дж", "k": "к", "l": "л", "m": "м", "n": "н", "o": "о", "p": "п",
            "q": "к", "r": "р", "s": "с", "t": "т", "u": "у", "v": "в", "w": "в", "x": "кс",
            "y": "й", "z": "з",
        }))
        return output.capitalize() if value[0].isupper() else output

    return re.sub(r"[A-Za-z]+", word, text)


def segment_languages(text: str):
    normalized = re.sub(r"\s+", " ", text).strip()
    tokens = re.findall(
        r"[A-Za-z]+(?:['’][A-Za-z]+)*|[\u0400-\u052f]+(?:['’][\u0400-\u052f]+)*|\s+|.",
        normalized,
    )
    segments = []
    language = "uk"
    current = ""
    for token in tokens:
        detected = "en" if re.search(r"[A-Za-z]", token) else "uk" if re.search(r"[\u0400-\u052f]", token) else None
        if detected is None or detected == language:
            current += token
            continue
        if current.strip():
            segments.append((language, current.strip()))
        language = detected
        current = token
    if current.strip():
        segments.append((language, current.strip()))
    return segments


def adapt_mixed_latin(segments):
    if not any(language == "uk" for language, _text in segments):
        return segments
    adapted = [
        ("uk", transliterate_latin(text))
        if language == "en" and len(re.findall(r"[A-Za-z]+", text)) <= 4 and len(text) <= 64
        else (language, text)
        for language, text in segments
    ]
    merged = []
    for language, text in adapted:
        if merged and merged[-1][0] == language:
            merged[-1] = (language, f"{merged[-1][1]} {text}".strip())
            continue
        merged.append((language, text))
    return merged


def normalize_voice(mode: str, voice: str):
    quality = ("kateryna", "lada", "mykyta", "oleksa", "tetiana")
    legacy = ("", "ukrainian", "english", "ukrainian_tts")
    if mode == "quality" and voice in legacy:
        return "kateryna"
    if mode == "fast" and (voice in legacy or voice in quality):
        return "ukrainian_tts"
    return voice
