import time

import numpy as np

from app.streaming_stt import (
    STT_FRAME_BYTES,
    STT_SAMPLE_RATE,
    DuplexSession,
)


async def run_duplex_regression(synthesize, transcribe, detect_wake, language: str, reference_voice: str):
    started = time.perf_counter()
    speech = {}

    async def pcm(text: str):
        if text not in speech:
            speech[text] = await synthesize(text)
        return speech[text]

    agent_text = "OpenCode Customs відповідає голосом і продовжує пояснення."
    interruption_text = "Зупинись і покажи останні логи."
    wake_text = "Джарвіс покажи останні логи."
    request_text = "Як мене звати?"
    first_clause = "Розкажи мені про"
    second_clause = "Мобі Діка."
    wake_phrases = ["джарвіс"]
    final_silence = silence(2_000)

    echo = await replay_stream(
        [await pcm(agent_text), final_silence],
        "speaking",
        agent_text,
        language,
        transcribe,
    )
    interruption = await replay_stream(
        [await pcm(interruption_text), final_silence],
        "speaking",
        agent_text,
        language,
        transcribe,
    )
    pre_roll = await replay_stream(
        [silence(1_000), await pcm(request_text), final_silence],
        "listening",
        "",
        language,
        transcribe,
    )
    internal_pause = await replay_stream(
        [await pcm(first_clause), silence(900), await pcm(second_clause), final_silence],
        "listening",
        "",
        language,
        transcribe,
    )
    wake = await replay_stream(
        [await pcm(wake_text), final_silence],
        "listening",
        "",
        language,
        transcribe,
        wake_phrases,
        detect_wake,
    )
    background = await replay_stream(
        [noise(2_000), final_silence],
        "listening",
        "",
        language,
        transcribe,
    )
    full_cycle = [
        await replay_stream(
            [await pcm(wake_text), final_silence],
            "listening",
            "",
            language,
            transcribe,
            wake_phrases,
            detect_wake,
        ),
        await replay_stream(
            [await pcm(agent_text), final_silence],
            "speaking",
            agent_text,
            language,
            transcribe,
        ),
        await replay_stream(
            [await pcm(interruption_text), final_silence],
            "speaking",
            agent_text,
            language,
            transcribe,
        ),
    ]

    return {
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "language": language,
        "voice": reference_voice,
        "total_ms": round((time.perf_counter() - started) * 1000),
        "scenarios": [
            scenario("own-tts-echo", "Own TTS is rejected as echo", [echo]),
            scenario("barge-in", "User speech interrupts active TTS", [interruption]),
            scenario("pre-roll", "Speech beginning is preserved by pre-roll", [pre_roll]),
            scenario("internal-pause", "An internal pause does not submit early", [internal_pause]),
            scenario("wake-command", "Wake phrase with command is detected", [wake]),
            scenario("background-noise", "Background noise does not wake the agent", [background]),
            scenario("full-cycle", "Wake, response, and barge-in complete one duplex cycle", full_cycle),
        ],
    }


async def replay_stream(
    chunks: list[bytes],
    mode: str,
    reference: str,
    language: str,
    transcribe,
    wake_phrases: list[str] | None = None,
    detect_wake=None,
    session: DuplexSession | None = None,
):
    session = session or DuplexSession()
    session.configure(language)
    session.set_mode(mode, reference)
    session.set_wake(bool(wake_phrases), bool(wake_phrases), wake_phrases or [])
    events = []
    transcript = ""
    diagnostics = session.diagnostics()
    wake = None
    recognition_ms = 0

    for input_index, chunk in enumerate(chunks):
        for frame in session.frames(pad_frames(chunk)):
            for event in session.push(frame):
                if event["type"] == "speech_start":
                    events.append({**event, "input_index": input_index})
                    continue
                if event["type"] == "discard":
                    diagnostics = event["diagnostics"]
                    events.append({**event, "input_index": input_index})
                    continue
                if event["type"] == "partial_ready" or event["type"] == "endpoint_ready":
                    started = time.perf_counter()
                    transcript = await transcribe(session.snapshot(), language)
                    recognition_ms += round((time.perf_counter() - started) * 1000)
                    session.observe_transcript(transcript, event["generation"])
                    events.append(
                        {
                            "type": "partial",
                            "text": transcript,
                            "generation": event["generation"],
                            "input_index": input_index,
                            "endpoint": event["type"] == "endpoint_ready",
                        }
                    )
                    continue
                cached_transcript = session.cached_transcript()
                pcm, active_mode, active_reference, generation, diagnostics = session.finish(
                    event.get("reason", "silence")
                )
                if wake_phrases:
                    if detect_wake is None:
                        wake = {"matched": False, "error": "The wake-word recognizer is unavailable."}
                    else:
                        started = time.perf_counter()
                        wake = report_wake(await detect_wake(pcm, language, wake_phrases))
                        recognition_ms += round((time.perf_counter() - started) * 1000)
                        transcript = wake.get("text", "")
                elif cached_transcript:
                    transcript = cached_transcript
                    diagnostics["transcription_cache"] = "hit"
                else:
                    started = time.perf_counter()
                    transcript = await transcribe(pcm, language)
                    recognition_ms += round((time.perf_counter() - started) * 1000)
                    diagnostics["transcription_cache"] = "miss"
                events.append(
                    {
                        "type": "final",
                        "text": transcript,
                        "mode": active_mode,
                        "reference": active_reference,
                        "generation": generation,
                        "input_index": input_index,
                        "reason": event.get("reason", "silence"),
                    }
                )

    if session.snapshot():
        cached_transcript = session.cached_transcript()
        pcm, active_mode, active_reference, generation, diagnostics = session.finish("replay_flush")
        if wake_phrases:
            if detect_wake is None:
                wake = {"matched": False, "error": "The wake-word recognizer is unavailable."}
            else:
                started = time.perf_counter()
                wake = report_wake(await detect_wake(pcm, language, wake_phrases))
                recognition_ms += round((time.perf_counter() - started) * 1000)
                transcript = wake.get("text", "")
        elif cached_transcript:
            transcript = cached_transcript
            diagnostics["transcription_cache"] = "hit"
        else:
            started = time.perf_counter()
            transcript = await transcribe(pcm, language)
            recognition_ms += round((time.perf_counter() - started) * 1000)
            diagnostics["transcription_cache"] = "miss"
        events.append(
            {
                "type": "final",
                "text": transcript,
                "mode": active_mode,
                "reference": active_reference,
                "generation": generation,
                "input_index": len(chunks) - 1,
                "reason": "replay_flush",
            }
        )

    return {
        "mode": mode,
        "reference": reference,
        "transcript": transcript,
        "wake": wake,
        "events": events,
        "diagnostics": {**diagnostics, "recognition_ms": recognition_ms},
    }


def scenario(identifier: str, name: str, stages: list[dict]):
    return {"id": identifier, "name": name, "stages": stages}


def report_wake(wake: dict):
    command_pcm = wake.get("command_pcm")
    return {
        **{key: value for key, value in wake.items() if key != "command_pcm"},
        **({"command_pcm_bytes": len(command_pcm)} if isinstance(command_pcm, bytes) else {}),
    }


def silence(duration_ms: int):
    return bytes(round(STT_SAMPLE_RATE * duration_ms / 1000) * 2)


def noise(duration_ms: int):
    samples = round(STT_SAMPLE_RATE * duration_ms / 1000)
    indexes = np.arange(samples, dtype=np.float32)
    signal = (np.sin(indexes * 0.173) + np.sin(indexes * 0.071)) * 32
    return np.clip(np.rint(signal), -32768, 32767).astype("<i2").tobytes()


def pad_frames(data: bytes):
    remainder = len(data) % STT_FRAME_BYTES
    if not remainder:
        return data
    return data + bytes(STT_FRAME_BYTES - remainder)
