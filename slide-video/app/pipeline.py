"""End-to-end: files -> slide images -> Claude narration -> speech -> MP4.

Split into two phases so the script can be reviewed and edited in between:
  prepare()        files -> project (slides + narration script), saved as project.json
  render_project() project -> speech -> video.mp4 + subtitles.srt
"""

from __future__ import annotations

import json
import wave
from dataclasses import asdict, dataclass
from pathlib import Path

from . import render
from .cards import build_cards
from .ingest import files_to_slides
from .languages import get_language, pick_voice
from .narrate import deck_extras, narrate_all
from .tts import SAMPLE_RATE, Speaker


@dataclass
class Options:
    language: str = "en"
    voice: str = ""
    rate: int = 0               # speech speed change in percent
    length: str = "medium"      # short | medium | long
    instructions: str = ""
    format: str = "landscape"   # landscape | portrait | square
    captions: bool = True
    intro: bool = True
    takeaways: bool = True
    quiz: bool = False

    def __post_init__(self) -> None:
        self.voice = pick_voice(self.language, self.voice)
        self.rate = max(-50, min(50, int(self.rate)))
        if self.length not in ("short", "medium", "long"):
            self.length = "medium"
        if self.format not in render.FORMATS:
            self.format = "landscape"


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


def _report(progress, lo: float, hi: float):
    return lambda msg, frac: progress and progress(msg, lo + (hi - lo) * frac)


def prepare(files: list[Path], work_dir: Path, opts: Options, progress=None) -> dict:
    """Read the slides with Claude and build the project (slides + script)."""
    work_dir.mkdir(parents=True, exist_ok=True)
    report = _report(progress, 0, 1)
    report("Preparing slides", 0)
    images = files_to_slides(files, work_dir / "slides")
    lang = get_language(opts.language)

    scripts = narrate_all(images, opts.length, opts.instructions, lang.name, _report(progress, 0.05, 0.85))
    slides = [{"kind": "slide", "image": str(img.relative_to(work_dir)), **s} for img, s in zip(images, scripts)]

    if opts.intro or opts.takeaways or opts.quiz:
        report("Writing intro, takeaways and quiz", 0.88)
        extras = deck_extras(scripts, opts.instructions, lang.name, opts.quiz)
        if extras:
            size = render.FORMATS[opts.format]
            before, after = build_cards(extras, len(images), size, lang.script, work_dir / "cards",
                                        opts.intro, opts.takeaways, opts.quiz)
            for c in before + after:
                c["image"] = str(Path(c["image"]).relative_to(work_dir))
            slides = before + slides + after

    project = {"options": asdict(opts), "slides": slides}
    (work_dir / "project.json").write_text(json.dumps(project, indent=2, ensure_ascii=False))
    report("Script ready", 1)
    return project


def render_project(project: dict, work_dir: Path, opts: Options, progress=None) -> dict:
    """Voice the script and render the video. Slides with include=False or no segments are skipped."""
    slides = [{**s, "image": str(work_dir / s["image"])}
              for s in project["slides"] if s.get("include", True) and s["segments"]]
    if not slides:
        raise ValueError("Nothing to render: every slide was removed or has no narration.")

    lang = get_language(opts.language)
    speaker = Speaker(opts.voice, opts.rate, lang.espeak)
    audio_dir = work_dir / "audio"
    audio_dir.mkdir(exist_ok=True)
    for old in audio_dir.glob("*.wav"):
        old.unlink()
    report = _report(progress, 0, 0.2)
    clips: list[list[Path]] = []
    durations: list[list[float]] = []
    n_segs = sum(len(s["segments"]) for s in slides)
    done = 0
    for i, slide in enumerate(slides):
        slide_clips, slide_durs = [], []
        for j, seg in enumerate(slide["segments"]):
            report(f"Recording narration for slide {i + 1} of {len(slides)}", done / n_segs)
            clip = audio_dir / f"s{i:03d}_{j:02d}.wav"
            slide_durs.append(speaker.say(seg["text"], clip))
            slide_clips.append(clip)
            done += 1
        clips.append(slide_clips)
        durations.append(slide_durs)

    timeline = render.build_timeline(slides, durations)
    audio = work_dir / "narration.wav"
    _assemble_audio(timeline, clips, audio)

    renderer = render.Renderer(opts.format, opts.captions, lang.script)
    renderer.add_cues(timeline)
    (work_dir / "subtitles.srt").write_text(renderer.srt(timeline), encoding="utf-8")
    out = work_dir / "video.mp4"
    renderer.render(timeline, audio, out, _report(progress, 0.2, 1.0))
    return {
        "video": out,
        "srt": work_dir / "subtitles.srt",
        "tts_engine": speaker.engine,
        "duration": round(sum(s.duration for s in timeline), 1),
        "slides": len(slides),
    }


def make_video(files: list[Path], work_dir: Path, opts: Options, progress=None) -> dict:
    """Both phases with no review step in between."""
    project = prepare(files, work_dir, opts, _report(progress, 0, 0.45))
    result = render_project(project, work_dir, opts, _report(progress, 0.45, 1.0))
    return {**result, "project": project}
