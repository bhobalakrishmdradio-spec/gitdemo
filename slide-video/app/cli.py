"""Command-line usage:  python -m app.cli deck.pdf photo.png -o explainer.mp4"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
from pathlib import Path

from .languages import LANGUAGES
from .pipeline import Options, make_video
from .render import FORMATS


def main() -> None:
    p = argparse.ArgumentParser(description="Turn slides/images into a narrated explainer video.")
    p.add_argument("files", nargs="+", type=Path, help="Images, PDF or PPTX files, in order")
    p.add_argument("-o", "--output", type=Path, default=Path("explainer.mp4"))
    p.add_argument("--language", default="en", choices=sorted(LANGUAGES))
    p.add_argument("--voice", default="", help="edge-tts voice id (default: the language's first voice)")
    p.add_argument("--rate", type=int, default=0, help="Speech speed change in percent, -50 to 50")
    p.add_argument("--length", default="medium", choices=["short", "medium", "long"])
    p.add_argument("--format", default="landscape", choices=sorted(FORMATS))
    p.add_argument("--instructions", default="", help="Extra guidance for the narrator")
    p.add_argument("--no-captions", action="store_true", help="Don't burn captions into the video")
    p.add_argument("--no-intro", action="store_true", help="Skip the intro title card")
    p.add_argument("--no-takeaways", action="store_true", help="Skip the key takeaways card")
    p.add_argument("--quiz", action="store_true", help="End with a short quiz")
    args = p.parse_args()

    opts = Options(
        language=args.language, voice=args.voice, rate=args.rate, length=args.length,
        instructions=args.instructions, format=args.format, captions=not args.no_captions,
        intro=not args.no_intro, takeaways=not args.no_takeaways, quiz=args.quiz,
    )

    def progress(msg: str, frac: float) -> None:
        print(f"\r[{frac * 100:5.1f}%] {msg:<60}", end="", file=sys.stderr, flush=True)

    with tempfile.TemporaryDirectory() as tmp:
        result = make_video(args.files, Path(tmp), opts, progress)
        shutil.copy(result["video"], args.output)
        shutil.copy(result["srt"], args.output.with_suffix(".srt"))
        shutil.copy(Path(tmp) / "project.json", args.output.with_suffix(".script.json"))
    print(f"\nSaved {args.output} + .srt subtitles ({result['slides']} slides, "
          f"{result['duration']}s, voice: {result['tts_engine']})")


if __name__ == "__main__":
    main()
