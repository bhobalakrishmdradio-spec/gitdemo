"""End-to-end: files -> slide images -> Claude narration -> speech -> MP4."""

from __future__ import annotations

import json
import wave
from pathlib import Path

from . import render
from .ingest import files_to_slides
from .narrate import narrate_all
from .tts import SAMPLE_RATE, Speaker


def _assemble_audio(timeline: list[render.SlideTiming], clips: list[list[Path]], out: Path) -> None:
    """Lay every speech clip at its timeline position in one WAV track."""
    total = int(round(sum(s.duration for s in timeline) * SAMPLE_RATE))
    track = bytearray(total * 2)
    for slide, slide_clips in zip(timeline, clips):
        for seg, clip in zip(slide.segs, slide_clips):
            with wave.open(str(clip)) as w:
                data = w.readframes(w.getnframes())
            pos = int(round((slide.start + seg.start) * SAMPLE_RATE)) * 2
            data = data[: max(0, len(track) - pos)]
            track[pos:pos + len(data)] = data
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(bytes(track))


def make_video(
    files: list[Path],
    work_dir: Path,
    voice: str = "en-US-AriaNeural",
    length: str = "medium",
    instructions: str = "",
    progress=None,
) -> dict:
    """Build the video. progress(stage_message, fraction_0_to_1) is called along the way."""

    def report(msg: str, frac: float, lo: float, hi: float) -> None:
        if progress:
            progress(msg, lo + (hi - lo) * frac)

    work_dir.mkdir(parents=True, exist_ok=True)
    report("Preparing slides", 0, 0, 0.05)
    images = files_to_slides(files, work_dir / "slides")

    scripts = narrate_all(images, length, instructions, lambda m, f: report(m, f, 0.05, 0.45))
    (work_dir / "script.json").write_text(json.dumps(scripts, indent=2))

    speaker = Speaker(voice)
    audio_dir = work_dir / "audio"
    audio_dir.mkdir(exist_ok=True)
    clips: list[list[Path]] = []
    durations: list[list[float]] = []
    n_segs = sum(len(s["segments"]) for s in scripts) or 1
    done = 0
    for i, script in enumerate(scripts):
        slide_clips, slide_durs = [], []
        for j, seg in enumerate(script["segments"]):
            report(f"Recording narration for slide {i + 1}", done / n_segs, 0.45, 0.6)
            clip = audio_dir / f"s{i:03d}_{j:02d}.wav"
            slide_durs.append(speaker.say(seg["text"], clip))
            slide_clips.append(clip)
            done += 1
        clips.append(slide_clips)
        durations.append(slide_durs)

    timeline = render.build_timeline(images, scripts, durations)
    audio = work_dir / "narration.wav"
    _assemble_audio(timeline, clips, audio)

    out = work_dir / "video.mp4"
    render.render_video(timeline, audio, out, lambda m, f: report(m, f, 0.6, 1.0))
    report("Done", 1, 0, 1)
    return {
        "video": out,
        "scripts": scripts,
        "tts_engine": speaker.engine,
        "duration": round(sum(s.duration for s in timeline), 1),
        "slides": len(images),
    }
