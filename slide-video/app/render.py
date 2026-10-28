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
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

from .text import MixedFont, fit, wrap

FORMATS = {
    "landscape": (1280, 720),   # 16:9, YouTube / presentations
    "portrait": (720, 1280),    # 9:16, Shorts / Reels / Stories
    "square": (1080, 1080),     # 1:1, feeds
}
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


# ---------------------------------------------------------------- timeline

@dataclass
class Seg:
    text: str
    focus: list[float] | None
    start: float  # seconds from the start of the slide
    end: float    # end of speech
    hold: float   # end of speech plus any pause (e.g. quiz thinking time)
    cues: list[tuple[float, float, str]] = field(default_factory=list)  # caption chunks, slide time


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


def build_timeline(slides: list[dict], durations: list[list[float]]) -> list[SlideTiming]:
    """slides: [{image, title, segments: [{text, focus, pause?}]}]; durations: speech seconds per segment."""
    out, t0 = [], 0.0
    for slide, durs in zip(slides, durations):
        t, segs = INTRO, []
        for seg, d in zip(slide["segments"], durs):
            hold = t + d + float(seg.get("pause") or 0)
            segs.append(Seg(seg["text"], seg.get("focus"), t, t + d, hold))
            t = hold + GAP
        total = t - GAP + OUTRO
        out.append(SlideTiming(Path(slide["image"]), slide["title"], segs, total, t0))
        t0 += total
    return out


# ---------------------------------------------------------------- renderer

class Renderer:
    def __init__(self, fmt: str = "landscape", captions: bool = True, script: str = ""):
        self.W, self.H = FORMATS.get(fmt, FORMATS["landscape"])
        self.captions = captions
        unit = min(self.W, self.H) / 720
        self.cap_font = MixedFont(int(30 * unit), script)
        self.title_font = MixedFont(int(24 * unit), script, bold=True)
        self.small_font = MixedFont(int(18 * unit), "", bold=True)
        self.cap_max_w = int(self.W * (0.78 if self.W > self.H else 0.86))
        self.bg = self._background()
        self.bg_small = self.bg.resize((self.W, self.H), Image.BILINEAR)

    # ------------------------------------------------------------ captions

    def add_cues(self, timeline: list[SlideTiming]) -> None:
        """Split each segment into caption chunks of up to two lines, timed by word share."""
        for slide in timeline:
            for seg in slide.segs:
                lines = wrap(seg.text, self.cap_font, self.cap_max_w)
                chunks = [" ".join(lines[i:i + 2]) for i in range(0, len(lines), 2)] or [""]
                weights = [len(c.split()) or 1 for c in chunks]
                t, total = seg.start, sum(weights)
                seg.cues = []
                for i, (c, wgt) in enumerate(zip(chunks, weights)):
                    end = t + (seg.end - seg.start) * wgt / total
                    # The last chunk stays up through any pause.
                    seg.cues.append((t, seg.hold if i == len(chunks) - 1 else end, c))
                    t = end

    def srt(self, timeline: list[SlideTiming]) -> str:
        def ts(s: float) -> str:
            ms = int(round(s * 1000))
            return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"

        out, n = [], 1
        for slide in timeline:
            for seg in slide.segs:
                for a, b, text in seg.cues:
                    out.append(f"{n}\n{ts(slide.start + a)} --> {ts(slide.start + b)}\n{text}\n")
                    n += 1
        return "\n".join(out)

    # ------------------------------------------------------------ stage & camera

    def _background(self) -> Image.Image:
        w, h = self.W * SS, self.H * SS
        bg = Image.new("RGB", (w, h))
        d = ImageDraw.Draw(bg)
        for y in range(h):
            k = y / (h - 1)
            d.line([(0, y), (w, y)], fill=tuple(int(a + (b - a) * k) for a, b in zip(BG_TOP, BG_BOTTOM)))
        return bg

    def _make_stage(self, path: Path) -> _Stage:
        W, H = self.W * SS, self.H * SS
        stage = self.bg.copy()
        with Image.open(path) as im:
            im = im.convert("RGB")
            # Leave a margin around the slide for the title and captions.
            scale = min(W * 0.86 / im.width, H * 0.80 / im.height)
            sw, sh = max(1, int(im.width * scale)), max(1, int(im.height * scale))
            im = im.resize((sw, sh), Image.LANCZOS)
        x0, y0 = (W - sw) // 2, (H - sh) // 2 - int(H * 0.02)
        shadow = Image.new("L", (sw + 80, sh + 80), 0)
        ImageDraw.Draw(shadow).rectangle([40, 40, sw + 40, sh + 40], fill=150)
        shadow = shadow.filter(ImageFilter.GaussianBlur(24))
        stage.paste((0, 0, 0), (x0 - 40, y0 - 24), shadow)
        stage.paste(im, (x0, y0))
        return _Stage(stage, (x0, y0, x0 + sw, y0 + sh))

    @staticmethod
    def _focus_rect(stage: _Stage, focus: list[float]) -> tuple[float, float, float, float]:
        x0, y0, x1, y1 = stage.rect
        sw, sh = x1 - x0, y1 - y0
        return (x0 + focus[0] * sw, y0 + focus[1] * sh, x0 + focus[2] * sw, y0 + focus[3] * sh)

    def _camera_for(self, stage: _Stage, focus: list[float] | None) -> Camera:
        W, H = self.W * SS, self.H * SS
        if not focus:
            return Camera(W / 2, H / 2, 1.0)
        fx0, fy0, fx1, fy1 = self._focus_rect(stage, focus)
        # Fit the region into ~70% of the frame width / 62% of height (leave room for captions).
        zoom = min(W * 0.70 / max(1, fx1 - fx0), H * 0.62 / max(1, fy1 - fy0), MAX_ZOOM)
        zoom = max(1.0, zoom)
        cx, cy = (fx0 + fx1) / 2, (fy0 + fy1) / 2 + H * 0.04 / zoom
        # Keep the view inside the stage.
        hw, hh = W / 2 / zoom, H / 2 / zoom
        cx = min(max(cx, hw), W - hw)
        cy = min(max(cy, hh), H - hh)
        return Camera(cx, cy, zoom)

    @staticmethod
    def _lerp_cam(a: Camera, b: Camera, k: float) -> Camera:
        # Interpolate zoom geometrically so glides feel even.
        z = math.exp(math.log(a.zoom) + (math.log(b.zoom) - math.log(a.zoom)) * k)
        return Camera(a.cx + (b.cx - a.cx) * k, a.cy + (b.cy - a.cy) * k, z)

    def _camera_at(self, stage: _Stage, slide: SlideTiming, t: float) -> tuple[Camera, Seg | None, float]:
        """Camera at time t, plus the active focused segment and its spotlight strength (0..1)."""
        cam = self._camera_for(stage, None)
        active, strength = None, 0.0
        for i, seg in enumerate(slide.segs):
            if t < seg.start:
                break
            target = self._camera_for(stage, seg.focus)
            # Hold this segment's shot through the following gap.
            k = ease_in_out((t - seg.start) / MOVE)
            cam = self._lerp_cam(cam, target, k) if k < 1 else target
            if i == len(slide.segs) - 1 and t > seg.hold:
                # Ease back to the full slide during the outro.
                cam = self._lerp_cam(target, self._camera_for(stage, None), ease_in_out((t - seg.hold) / MOVE))
            if seg.focus:
                active = seg
                fade_out = 1 - ease_in_out((t - seg.hold) / 0.25) if t > seg.hold else 1.0
                strength = ease_in_out((t - seg.start - MOVE * 0.5) / 0.35) * fade_out
            else:
                active, strength = None, 0.0
        return cam, active, strength

    def _view(self, stage: _Stage, cam: Camera) -> Image.Image:
        hw, hh = self.W * SS / 2 / cam.zoom, self.H * SS / 2 / cam.zoom
        box = (cam.cx - hw, cam.cy - hh, cam.cx + hw, cam.cy + hh)
        return stage.img.resize((self.W, self.H), Image.BILINEAR, box=box)

    def _to_screen(self, cam: Camera, rect) -> tuple[float, ...]:
        s = cam.zoom / SS
        ox, oy = cam.cx - self.W * SS / 2 / cam.zoom, cam.cy - self.H * SS / 2 / cam.zoom
        return tuple((v - (ox if i % 2 == 0 else oy)) * s for i, v in enumerate(rect))

    # ------------------------------------------------------------ overlays

    def _spotlight(self, frame: Image.Image, rect, strength: float, t: float) -> Image.Image:
        if strength <= 0.01:
            return frame
        x0, y0, x1, y1 = rect
        pad = 10
        x0, y0, x1, y1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
        overlay = Image.new("RGBA", (self.W, self.H), (8, 10, 24, int(150 * strength)))
        ImageDraw.Draw(overlay).rounded_rectangle([x0, y0, x1, y1], radius=14, fill=(0, 0, 0, 0))
        out = Image.alpha_composite(frame.convert("RGBA"), overlay)
        d = ImageDraw.Draw(out)
        # Pulsing accent ring around the region being explained.
        pulse = 0.5 + 0.5 * math.sin(t * 4.0)
        ring = int(3 + 2 * pulse)
        d.rounded_rectangle([x0, y0, x1, y1], radius=14, outline=ACCENT + (int(255 * strength),), width=ring)
        return out.convert("RGB")

    def _caption(self, frame: Image.Image, seg: Seg, t: float) -> Image.Image:
        cue = next((c for c in seg.cues if t < c[1]), seg.cues[-1])
        c_start, _, text = cue
        font = self.cap_font
        lines = wrap(text, font, self.cap_max_w)
        pop = ease_out_back((t - c_start) / 0.28)
        lh = int(font.size * 1.35)
        bw = int(max(font.getlength(line) for line in lines) + font.size * 1.6)
        bh = lh * len(lines) + int(font.size * 0.85)
        cx = self.W // 2
        by = self.H - int(self.H * (0.05 if self.W >= self.H else 0.09)) - bh

        layer = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        d.rounded_rectangle([0, 0, bw - 1, bh - 1], radius=16, fill=(10, 12, 28, 215))
        for i, line in enumerate(lines):
            font.draw(d, (bw / 2, font.size * 0.42 + i * lh + (lh - font.size) / 2), line, (255, 255, 255, 255), "ma")
        k = max(0.6, min(1.08, 0.6 + 0.4 * pop))
        layer = layer.resize((max(1, int(bw * k)), max(1, int(bh * k))), Image.BILINEAR)
        alpha = min(1.0, max(0.0, (t - c_start) / 0.15))
        if alpha < 1:
            layer.putalpha(layer.getchannel("A").point(lambda a: int(a * alpha)))
        out = frame.convert("RGBA")
        out.alpha_composite(layer, (int(cx - layer.width / 2), int(by + bh / 2 - layer.height / 2)))
        return out.convert("RGB")

    def _title_chip(self, frame: Image.Image, title: str, index: int, total: int, t: float) -> Image.Image:
        pop = ease_out_back((t - 0.15) / 0.5)
        if pop <= 0:
            return frame
        font, small = self.title_font, self.small_font
        label = f"{index + 1}/{total}"
        lw = small.getlength(label)
        pad = font.size
        title = fit(title, font, self.W - 48 - lw - pad * 3)
        bw, bh = int(font.getlength(title) + lw + pad * 2.9), int(font.size * 2.1)
        layer = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        d.rounded_rectangle([0, 0, bw - 1, bh - 1], radius=bh // 2, fill=(10, 12, 28, 225))
        d.rounded_rectangle([6, 6, int(lw + pad * 1.25), bh - 7], radius=(bh - 12) // 2, fill=ACCENT + (255,))
        small.draw(d, (6 + (lw + pad * 1.25 - 6) / 2, bh / 2), label, (20, 20, 30, 255), "mm")
        font.draw(d, (lw + pad * 1.85, bh / 2), title, (255, 255, 255, 255), "lm")
        k = max(0.01, pop)
        layer = layer.resize((max(1, int(bw * k)), max(1, int(bh * k))), Image.BILINEAR)
        out = frame.convert("RGBA")
        out.alpha_composite(layer, (24, 18))
        return out.convert("RGB")

    def _pop_in(self, frame: Image.Image, t: float) -> Image.Image:
        """Slide entrance: scale up from 70% with overshoot, fading in."""
        k = ease_out_back(t / 0.75)
        if k >= 1 and t >= 0.75:
            return frame
        scale = max(0.05, 0.7 + 0.3 * k)
        w, h = int(self.W * scale), int(self.H * scale)
        small = frame.resize((w, h), Image.BILINEAR)
        out = self.bg_small.copy()
        mask = Image.new("L", (w, h), int(255 * min(1.0, t / 0.3)))
        out.paste(small, ((self.W - w) // 2, (self.H - h) // 2), mask)
        return out

    # ------------------------------------------------------------ main entry

    def render(self, timeline: list[SlideTiming], audio_wav: Path, out_mp4: Path, progress=None) -> None:
        self.add_cues(timeline)
        total_frames = int(round(sum(s.duration for s in timeline) * FPS))
        proc = subprocess.Popen(
            ["ffmpeg", "-y", "-loglevel", "error",
             "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{self.W}x{self.H}", "-r", str(FPS), "-i", "-",
             "-i", str(audio_wav),
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", str(out_mp4)],
            stdin=subprocess.PIPE,
        )
        try:
            frame_no = 0
            for idx, slide in enumerate(timeline):
                stage = self._make_stage(slide.image)
                n = int(round((slide.start + slide.duration) * FPS)) - frame_no
                for _ in range(n):
                    t = frame_no / FPS - slide.start
                    cam, active, strength = self._camera_at(stage, slide, t)
                    frame = self._view(stage, cam)
                    if active is not None:
                        rect = self._to_screen(cam, self._focus_rect(stage, active.focus))
                        frame = self._spotlight(frame, rect, strength, t)
                    frame = self._title_chip(frame, slide.title, idx, len(timeline), t)
                    if self.captions:
                        speaking = next((s for s in slide.segs if s.start <= t < s.hold + GAP), None)
                        if speaking:
                            frame = self._caption(frame, speaking, t)
                    frame = self._pop_in(frame, t)
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
