"""Command-line usage:  python -m app.cli deck.pdf photo.png -o explainer.mp4"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
from pathlib import Path

from .pipeline import make_video
from .tts import DEFAULT_VOICE, VOICES


def main() -> None:
    p = argparse.ArgumentParser(description="Turn slides/images into a narrated explainer video.")
    p.add_argument("files", nargs="+", type=Path, help="Images, PDF or PPTX files, in order")
    p.add_argument("-o", "--output", type=Path, default=Path("explainer.mp4"))
    p.add_argument("--voice", default=DEFAULT_VOICE, choices=sorted(VOICES))
    p.add_argument("--length", default="medium", choices=["short", "medium", "long"])
    p.add_argument("--instructions", default="", help="Extra guidance for the narrator")
    args = p.parse_args()

    def progress(msg: str, frac: float) -> None:
        print(f"\r[{frac * 100:5.1f}%] {msg:<60}", end="", file=sys.stderr, flush=True)

    with tempfile.TemporaryDirectory() as tmp:
        result = make_video(args.files, Path(tmp), args.voice, args.length, args.instructions, progress)
        shutil.copy(result["video"], args.output)
        shutil.copy(Path(tmp) / "script.json", args.output.with_suffix(".script.json"))
    print(f"\nSaved {args.output} ({result['slides']} slides, {result['duration']}s, voice: {result['tts_engine']})")


if __name__ == "__main__":
    main()
