"""Render slides + narration timeline into an MP4.

Each slide:
  * pops in (scale with a little overshoot) while the title chip springs up,
  * for every narration segment with a focus box, the camera glides in on that
    region and a spotlight dims everything else, so the part being explained
    "pops" out of the slide,
  * captions of the current sentence pop in at the bottom.

Frames are drawn with Pillow and piped straight into ffmpeg.
"""

from __future__ import annotations

import math
import subprocess
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1280, 720
FPS = 25
SS = 2  # stage supersampling, so zooming in stays sharp

INTRO = 0.9      # seconds of pop-in before the narration starts
GAP = 0.35       # pause between segments
OUTRO = 0.7      # pause after the last segment
MOVE = 0.7       # camera glide duration
MAX_ZOOM = 2.3

BG_TOP = (18, 24, 46)
BG_BOTTOM = (40, 22, 72)
ACCENT = (255, 196, 61)


# ---------------------------------------------------------------- easing

def ease_in_out(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def ease_out_back(t: float, s: float = 1.7) -> float:
    t = min(1.0, max(0.0, t)) - 1
    return 1 + t * t * ((s + 1) * t + s)


# ---------------------------------------------------------------- fonts

def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    names = ["DejaVuSans-Bold.ttf", "Arial Bold.ttf"] if bold else ["DejaVuSans.ttf", "Arial.ttf"]
    for name in names:
        for base in ("", "/usr/share/fonts/truetype/dejavu/", "/Library/Fonts/", "C:/Windows/Fonts/"):
            try:
                return ImageFont.truetype(base + name, size)
            except OSError:
                continue
    return ImageFont.load_default(size=size)


# ---------------------------------------------------------------- timeline

@dataclass
class Seg:
    text: str
    focus: list[float] | None
    start: float  # seconds from the start of the slide
    end: float


@dataclass
class SlideTiming:
    image: Path
    title: str
    segs: list[Seg]
    duration: float
    start: float = 0.0  # seconds from the start of the video


@dataclass
class Camera:
    cx: float  # centre in stage pixels
    cy: float
    zoom: float


@dataclass
class _Stage:
    img: Image.Image                 # slide on background, (W*SS, H*SS)
    rect: tuple[int, int, int, int]  # slide rect in stage pixels


def build_timeline(images: list[Path], scripts: list[dict], durations: list[list[float]]) -> list[SlideTiming]:
    out, t0 = [], 0.0
    for img, script, durs in zip(images, scripts, durations):
        t, segs = INTRO, []
        for seg, d in zip(script["segments"], durs):
            segs.append(Seg(seg["text"], seg.get("focus"), t, t + d))
            t += d + GAP
        total = t - GAP + OUTRO
        out.append(SlideTiming(img, script["title"], segs, total, t0))
        t0 += total
    return out


# ---------------------------------------------------------------- drawing

def _background() -> Image.Image:
    bg = Image.new("RGB", (W * SS, H * SS))
    d = ImageDraw.Draw(bg)
    for y in range(H * SS):
        k = y / (H * SS - 1)
        d.line([(0, y), (W * SS, y)], fill=tuple(int(a + (b - a) * k) for a, b in zip(BG_TOP, BG_BOTTOM)))
    return bg


def _make_stage(path: Path, bg: Image.Image) -> _Stage:
    stage = bg.copy()
    with Image.open(path) as im:
        im = im.convert("RGB")
        # Leave a margin around the slide for the title and captions.
        max_w, max_h = int(W * SS * 0.86), int(H * SS * 0.80)
        scale = min(max_w / im.width, max_h / im.height)
        sw, sh = max(1, int(im.width * scale)), max(1, int(im.height * scale))
        im = im.resize((sw, sh), Image.LANCZOS)
    x0, y0 = (W * SS - sw) // 2, (H * SS - sh) // 2 - int(H * SS * 0.02)
    shadow = Image.new("L", (sw + 80, sh + 80), 0)
    ImageDraw.Draw(shadow).rectangle([40, 40, sw + 40, sh + 40], fill=150)
    shadow = shadow.filter(ImageFilter.GaussianBlur(24))
    stage.paste((0, 0, 0), (x0 - 40, y0 - 24), shadow)
    stage.paste(im, (x0, y0))
    return _Stage(stage, (x0, y0, x0 + sw, y0 + sh))


def _focus_rect(stage: _Stage, focus: list[float]) -> tuple[float, float, float, float]:
    x0, y0, x1, y1 = stage.rect
    sw, sh = x1 - x0, y1 - y0
    return (x0 + focus[0] * sw, y0 + focus[1] * sh, x0 + focus[2] * sw, y0 + focus[3] * sh)


def _camera_for(stage: _Stage, focus: list[float] | None) -> Camera:
    if not focus:
        return Camera(W * SS / 2, H * SS / 2, 1.0)
    fx0, fy0, fx1, fy1 = _focus_rect(stage, focus)
    # Fit the region into ~70% of the frame width / 62% of height (leave room for captions).
    zoom = min(W * SS * 0.70 / max(1, fx1 - fx0), H * SS * 0.62 / max(1, fy1 - fy0), MAX_ZOOM)
    zoom = max(1.0, zoom)
    cx, cy = (fx0 + fx1) / 2, (fy0 + fy1) / 2 + H * SS * 0.04 / zoom
    # Keep the view inside the stage.
    hw, hh = W * SS / 2 / zoom, H * SS / 2 / zoom
    cx = min(max(cx, hw), W * SS - hw)
    cy = min(max(cy, hh), H * SS - hh)
    return Camera(cx, cy, zoom)


def _lerp_cam(a: Camera, b: Camera, k: float) -> Camera:
    # Interpolate zoom geometrically so glides feel even.
    z = math.exp(math.log(a.zoom) + (math.log(b.zoom) - math.log(a.zoom)) * k)
    return Camera(a.cx + (b.cx - a.cx) * k, a.cy + (b.cy - a.cy) * k, z)


def _camera_at(stage: _Stage, slide: SlideTiming, t: float) -> tuple[Camera, Seg | None, float]:
    """Camera at time t, plus the active focused segment and its spotlight strength (0..1)."""
    cam = _camera_for(stage, None)
    active, strength = None, 0.0
    for i, seg in enumerate(slide.segs):
        if t < seg.start:
            break
        target = _camera_for(stage, seg.focus)
        # Hold this segment's shot through the following gap.
        k = ease_in_out((t - seg.start) / MOVE)
        cam = _lerp_cam(cam, target, k) if k < 1 else target
        last = i == len(slide.segs) - 1
        if last and t > seg.end:
            # Ease back to the full slide during the outro.
            cam = _lerp_cam(target, _camera_for(stage, None), ease_in_out((t - seg.end) / MOVE))
        if seg.focus:
            active = seg
            fade_out = 1 - ease_in_out((t - seg.end) / 0.25) if t > seg.end else 1.0
            strength = ease_in_out((t - seg.start - MOVE * 0.5) / 0.35) * fade_out
        else:
            active, strength = None, 0.0
    return cam, active, strength


def _view(stage: _Stage, cam: Camera) -> Image.Image:
    hw, hh = W * SS / 2 / cam.zoom, H * SS / 2 / cam.zoom
    box = (cam.cx - hw, cam.cy - hh, cam.cx + hw, cam.cy + hh)
    return stage.img.resize((W, H), Image.BILINEAR, box=box)


def _to_screen(stage: _Stage, cam: Camera, rect) -> tuple[float, float, float, float]:
    s = cam.zoom / SS
    ox, oy = cam.cx - W * SS / 2 / cam.zoom, cam.cy - H * SS / 2 / cam.zoom
    return tuple((v - (ox if i % 2 == 0 else oy)) * s for i, v in enumerate(rect))


def _spotlight(frame: Image.Image, rect, strength: float, t: float) -> Image.Image:
    if strength <= 0.01:
        return frame
    x0, y0, x1, y1 = rect
    pad = 10
    x0, y0, x1, y1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
    overlay = Image.new("RGBA", (W, H), (8, 10, 24, int(150 * strength)))
    mask = ImageDraw.Draw(overlay)
    mask.rounded_rectangle([x0, y0, x1, y1], radius=14, fill=(0, 0, 0, 0))
    out = Image.alpha_composite(frame.convert("RGBA"), overlay)
    d = ImageDraw.Draw(out)
    # Pulsing accent ring around the region being explained.
    pulse = 0.5 + 0.5 * math.sin(t * 4.0)
    ring = int(3 + 2 * pulse)
    d.rounded_rectangle([x0, y0, x1, y1], radius=14, outline=ACCENT + (int(255 * strength),), width=ring)
    return out.convert("RGB")


def _wrap(text: str, font, max_w: int) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if font.getlength(trial) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def _caption_chunks(text: str, font, max_w: int) -> list[str]:
    """Split a segment's text into chunks that fit in two caption lines."""
    lines = _wrap(text, font, max_w)
    return [" ".join(lines[i:i + 2]) for i in range(0, len(lines), 2)] or [""]


def _caption(frame: Image.Image, seg: Seg, t: float, font) -> Image.Image:
    max_w = int(W * 0.78)
    chunks = _caption_chunks(seg.text, font, max_w)
    # Time each chunk by its share of the words.
    weights = [len(c.split()) for c in chunks]
    total, idx, c_start = sum(weights) or 1, 0, seg.start
    for i, wgt in enumerate(weights):
        span = (seg.end - seg.start) * wgt / total
        if t < c_start + span or i == len(weights) - 1:
            idx = i
            break
        c_start += span
    lines = _wrap(chunks[idx], font, max_w)
    pop = ease_out_back((t - c_start) / 0.28)
    lh = font.size + 10
    bw = int(max(font.getlength(l) for l in lines) + 48)
    bh = lh * len(lines) + 26
    cx, by = W // 2, H - 36 - bh

    layer = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle([0, 0, bw - 1, bh - 1], radius=16, fill=(10, 12, 28, 215))
    for i, line in enumerate(lines):
        d.text((bw // 2, 13 + i * lh), line, font=font, fill=(255, 255, 255, 255), anchor="ma")
    k = max(0.6, min(1.08, 0.6 + 0.4 * pop))
    layer = layer.resize((max(1, int(bw * k)), max(1, int(bh * k))), Image.BILINEAR)
    alpha = min(1.0, max(0.0, (t - c_start) / 0.15))
    if alpha < 1:
        layer.putalpha(layer.getchannel("A").point(lambda a: int(a * alpha)))
    out = frame.convert("RGBA")
    out.alpha_composite(layer, (int(cx - layer.width / 2), int(by + bh / 2 - layer.height / 2)))
    return out.convert("RGB")


def _title_chip(frame: Image.Image, title: str, index: int, total: int, t: float, font, small) -> Image.Image:
    pop = ease_out_back((t - 0.15) / 0.5)
    if pop <= 0:
        return frame
    label = f"{index + 1}/{total}"
    tw = font.getlength(title)
    lw = small.getlength(label)
    bw, bh = int(tw + lw + 70), 50
    layer = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle([0, 0, bw - 1, bh - 1], radius=25, fill=(10, 12, 28, 225))
    d.rounded_rectangle([6, 6, int(lw + 30), bh - 7], radius=19, fill=ACCENT + (255,))
    d.text((int(lw / 2 + 18), bh // 2), label, font=small, fill=(20, 20, 30, 255), anchor="mm")
    d.text((int(lw + 44), bh // 2), title, font=font, fill=(255, 255, 255, 255), anchor="lm")
    k = max(0.01, pop)
    layer = layer.resize((max(1, int(bw * k)), max(1, int(bh * k))), Image.BILINEAR)
    out = frame.convert("RGBA")
    out.alpha_composite(layer, (24, 18))
    return out.convert("RGB")


def _pop_in(frame: Image.Image, bg_small: Image.Image, t: float) -> Image.Image:
    """Slide entrance: scale up from 70% with overshoot, fading in."""
    k = ease_out_back(t / 0.75)
    if k >= 1 and t >= 0.75:
        return frame
    scale = max(0.05, 0.7 + 0.3 * k)
    w, h = int(W * scale), int(H * scale)
    small = frame.resize((w, h), Image.BILINEAR)
    out = bg_small.copy()
    alpha = min(1.0, t / 0.3)
    mask = Image.new("L", (w, h), int(255 * alpha))
    out.paste(small, ((W - w) // 2, (H - h) // 2), mask)
    return out


# ---------------------------------------------------------------- main entry

def render_video(timeline: list[SlideTiming], audio_wav: Path, out_mp4: Path, progress=None) -> None:
    bg = _background()
    bg_small = bg.resize((W, H), Image.BILINEAR)
    cap_font = _font(30)
    title_font = _font(24, bold=True)
    small_font = _font(18, bold=True)
    total_frames = int(round(sum(s.duration for s in timeline) * FPS))

    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-i", str(audio_wav),
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", str(out_mp4)],
        stdin=subprocess.PIPE,
    )
    try:
        frame_no = 0
        for idx, slide in enumerate(timeline):
            stage = _make_stage(slide.image, bg)
            n = int(round((slide.start + slide.duration) * FPS)) - frame_no
            for _ in range(n):
                t = frame_no / FPS - slide.start
                cam, active, strength = _camera_at(stage, slide, t)
                frame = _view(stage, cam)
                if active is not None:
                    frame = _spotlight(frame, _to_screen(stage, cam, _focus_rect(stage, active.focus)), strength, t)
                frame = _title_chip(frame, slide.title, idx, len(timeline), t, title_font, small_font)
                speaking = next((s for s in slide.segs if s.start <= t < s.end + GAP), None)
                if speaking:
                    frame = _caption(frame, speaking, t, cap_font)
                frame = _pop_in(frame, bg_small, t)
                proc.stdin.write(frame.tobytes())
                frame_no += 1
                if progress and frame_no % 50 == 0:
                    progress(f"Rendering video (frame {frame_no}/{total_frames})", frame_no / max(1, total_frames))
        proc.stdin.close()
        if proc.wait() != 0:
            raise RuntimeError("ffmpeg failed to encode the video")
    finally:
        if proc.poll() is None:
            proc.kill()
