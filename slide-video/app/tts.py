"""Text-to-speech with graceful fallbacks.

Engines, tried in order:
  1. edge-tts  - natural neural voices (needs internet access)
  2. espeak-ng - robotic but fully offline (if installed)
  3. silence   - the video still works, with captions only
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
import wave
from pathlib import Path

log = logging.getLogger(__name__)

SAMPLE_RATE = 24000

DEFAULT_VOICE = "en-US-AriaNeural"


def _to_wav(src: Path, dst: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
         "-ac", "1", "-ar", str(SAMPLE_RATE), "-sample_fmt", "s16", str(dst)],
        check=True,
    )


def wav_duration(path: Path) -> float:
    with wave.open(str(path)) as w:
        return w.getnframes() / w.getframerate()


def write_silence(path: Path, seconds: float) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(b"\x00\x00" * int(seconds * SAMPLE_RATE))


class Speaker:
    def __init__(self, voice: str = DEFAULT_VOICE, rate: int = 0, espeak_voice: str = "en-us"):
        """rate: speed change in percent, -50..+50."""
        self.voice = voice
        self.rate = max(-50, min(50, int(rate)))
        self.espeak_voice = espeak_voice
        self.engines = ["edge", "espeak", "silent"]
        if os.environ.get("SLIDECAST_TTS") in self.engines:
            # Force a specific engine, e.g. SLIDECAST_TTS=espeak for offline use.
            self.engines = self.engines[self.engines.index(os.environ["SLIDECAST_TTS"]):]
        if not shutil.which("espeak-ng") and not shutil.which("espeak"):
            self.engines = [e for e in self.engines if e != "espeak"]

    @property
    def engine(self) -> str:
        return self.engines[0]

    def say(self, text: str, out_wav: Path) -> float:
        """Synthesize text to out_wav and return its duration in seconds."""
        while True:
            engine = self.engines[0]
            try:
                getattr(self, f"_{engine}")(text, out_wav)
                return wav_duration(out_wav)
            except Exception as e:  # noqa: BLE001 - any engine failure falls through to the next
                log.warning("TTS engine %s failed (%s); falling back", engine, e)
                # Drop the failing engine for the rest of this job to avoid repeated timeouts.
                self.engines.pop(0)

    def _edge(self, text: str, out_wav: Path) -> None:
        import edge_tts

        mp3 = out_wav.with_suffix(".mp3")
        proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
        comm = edge_tts.Communicate(text, self.voice, rate=f"{self.rate:+d}%", proxy=proxy)
        asyncio.run(asyncio.wait_for(comm.save(str(mp3)), timeout=60))
        if not mp3.exists() or mp3.stat().st_size == 0:
            raise RuntimeError("edge-tts produced no audio")
        _to_wav(mp3, out_wav)
        mp3.unlink(missing_ok=True)

    def _espeak(self, text: str, out_wav: Path) -> None:
        exe = shutil.which("espeak-ng") or shutil.which("espeak")
        raw = out_wav.with_suffix(".raw.wav")
        lang = "en-gb" if self.voice.startswith("en-GB") else self.espeak_voice
        speed = str(int(160 * (1 + self.rate / 100)))
        subprocess.run([exe, "-v", lang, "-s", speed, "-w", str(raw), text], check=True, capture_output=True)
        _to_wav(raw, out_wav)
        raw.unlink(missing_ok=True)

    def _silent(self, text: str, out_wav: Path) -> None:
        # About 2.6 words per second, the pace of a calm narrator.
        write_silence(out_wav, max(1.5, len(text.split()) / 2.6 / (1 + self.rate / 100)))
