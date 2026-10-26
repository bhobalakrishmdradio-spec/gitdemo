"""Ask Claude to read each slide and write a narration script for it.

The script is split into short segments. Each segment may point at a region
of the slide ("focus"), which the renderer zooms into and spotlights while
that segment is spoken -- that's the "pop" effect in the video.
"""

from __future__ import annotations

import base64
import io
import os
from pathlib import Path

import anthropic
from PIL import Image
from pydantic import BaseModel, Field

MODEL = os.environ.get("SLIDECAST_MODEL", "claude-opus-5-5")
# Long edge of the image we send to Claude (keeps token cost predictable).
VISION_EDGE = 1568


class Box(BaseModel):
    x0: int = Field(description="Left edge in pixels")
    y0: int = Field(description="Top edge in pixels")
    x1: int = Field(description="Right edge in pixels")
    y1: int = Field(description="Bottom edge in pixels")


class Segment(BaseModel):
    text: str = Field(description="One or two spoken sentences.")
    focus: Box | None = Field(
        description="Region of the slide this sentence talks about, or null for the whole slide."
    )


class SlideScript(BaseModel):
    title: str = Field(description="Short title for the slide, at most 8 words.")
    segments: list[Segment]


SYSTEM = """You are a warm, clear teacher narrating an explainer video built from slides or images.
For each image you receive, explain it to the viewer as if presenting it: read out and explain the
important text, describe diagrams, charts, tables and photos, and say why they matter. Don't just read
the slide verbatim; teach it.

Write the narration as short spoken segments (one or two sentences each, plain spoken English, no
markdown, no bullet symbols, no emojis). The first segment introduces the slide as a whole and has a
null focus. For later segments, when you talk about a specific part of the image (a heading, a
bullet, a chart, a label, a region of a photo), set `focus` to the pixel bounding box of that part,
in the coordinates of the image you were given, tight around it. Use null when the sentence is about
the whole image. Keep the order of segments in a natural reading order.

Aim for roughly {length}. Continue naturally from the previous slides instead of re-introducing the
whole topic on every slide."""

LENGTHS = {
    "short": "2-4 segments, about 20-40 seconds of speech",
    "medium": "4-7 segments, about 40-80 seconds of speech",
    "long": "6-10 segments, about 1-2 minutes of speech",
}


def _encode(path: Path) -> tuple[str, int, int]:
    with Image.open(path) as img:
        img = img.convert("RGB")
        img.thumbnail((VISION_EDGE, VISION_EDGE), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=88)
        return base64.standard_b64encode(buf.getvalue()).decode(), img.width, img.height


def _normalize(script: SlideScript, w: int, h: int) -> dict:
    """Convert to a plain dict with focus boxes as 0..1 fractions of the image."""
    segs = []
    for s in script.segments:
        text = " ".join(s.text.split())
        if not text:
            continue
        focus = None
        if s.focus:
            x0, x1 = sorted((s.focus.x0, s.focus.x1))
            y0, y1 = sorted((s.focus.y0, s.focus.y1))
            x0, x1 = max(0, x0) / w, min(w, x1) / w
            y0, y1 = max(0, y0) / h, min(h, y1) / h
            # Ignore degenerate boxes and boxes covering nearly everything.
            area = (x1 - x0) * (y1 - y0)
            if x1 - x0 > 0.02 and y1 - y0 > 0.02 and area < 0.8:
                focus = [round(v, 4) for v in (x0, y0, x1, y1)]
        segs.append({"text": text, "focus": focus})
    return {"title": script.title.strip(), "segments": segs}


def narrate_slide(
    client: anthropic.Anthropic,
    image: Path,
    index: int,
    total: int,
    previous_titles: list[str],
    length: str = "medium",
    instructions: str = "",
) -> dict:
    data, w, h = _encode(image)
    context = f"This is slide {index + 1} of {total}. The image is {w}x{h} pixels."
    if previous_titles:
        context += " Previous slides covered: " + "; ".join(previous_titles[-5:]) + "."
    if instructions.strip():
        context += f"\n\nPresenter instructions: {instructions.strip()}"

    response = client.messages.parse(
        model=MODEL,
        max_tokens=16000,
        system=SYSTEM.format(length=LENGTHS.get(length, LENGTHS["medium"])),
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}},
                {"type": "text", "text": context},
            ],
        }],
        output_format=SlideScript,
        # If a safety classifier declines, let the API retry on a fallback model.
        extra_headers={"anthropic-beta": "server-side-fallback-2026-07-01"},
        extra_body={"fallbacks": "default"},
    )
    if response.stop_reason == "refusal" or response.parsed_output is None:
        return fallback_script(index)
    result = _normalize(response.parsed_output, w, h)
    if not result["segments"]:
        return fallback_script(index)
    return result


def fallback_script(index: int) -> dict:
    return {
        "title": f"Slide {index + 1}",
        "segments": [{"text": f"Here is slide {index + 1}. Take a moment to look it over.", "focus": None}],
    }


def narrate_all(images: list[Path], length: str, instructions: str, progress=None) -> list[dict]:
    """Narrate every slide in order. Uses a canned script when SLIDECAST_FAKE_AI=1 (for testing)."""
    scripts: list[dict] = []
    fake = os.environ.get("SLIDECAST_FAKE_AI") == "1"
    client = None if fake else anthropic.Anthropic()
    for i, img in enumerate(images):
        if progress:
            progress(f"Reading slide {i + 1} of {len(images)} with Claude", i / len(images))
        if fake:
            scripts.append(_fake_script(i))
        else:
            titles = [s["title"] for s in scripts]
            scripts.append(narrate_slide(client, img, i, len(images), titles, length, instructions))
    return scripts


def _fake_script(i: int) -> dict:
    return {
        "title": f"Demo slide {i + 1}",
        "segments": [
            {"text": f"This is slide number {i + 1}, shown as a whole.", "focus": None},
            {"text": "Now we zoom into the top left part of the slide.", "focus": [0.05, 0.05, 0.5, 0.4]},
            {"text": "And here is the bottom right area, which pops into view.", "focus": [0.5, 0.55, 0.95, 0.95]},
        ],
    }
