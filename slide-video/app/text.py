"""Text drawing that mixes scripts.

Noto's Indic fonts have no Latin letters or digits, and DejaVu has no Indic
glyphs, so a Hindi sentence mentioning "ECG" needs both. Pillow has no font
fallback, so we split text into runs (Latin vs. the language's script) and
draw each run with its own font on a shared baseline.
"""

from __future__ import annotations

from functools import lru_cache

from PIL import ImageDraw, ImageFont

_DIRS = ("", "/usr/share/fonts/truetype/dejavu/", "/usr/share/fonts/truetype/noto/",
         "/Library/Fonts/", "C:/Windows/Fonts/")


@lru_cache(maxsize=64)
def _load(names: tuple[str, ...], size: int) -> ImageFont.FreeTypeFont | None:
    for name in names:
        for base in _DIRS:
            try:
                return ImageFont.truetype(base + name, size)
            except OSError:
                continue
    return None


def _latin(size: int, bold: bool) -> ImageFont.FreeTypeFont:
    names = ("DejaVuSans-Bold.ttf", "Arial Bold.ttf") if bold else ("DejaVuSans.ttf", "Arial.ttf")
    return _load(names, size) or ImageFont.load_default(size=size)


def _is_latin(ch: str) -> bool:
    o = ord(ch)
    return o < 0x0250 or 0x2000 <= o <= 0x20CF or 0x2190 <= o <= 0x2BFF


class MixedFont:
    """Latin font plus an optional script font, measured and drawn as one."""

    def __init__(self, size: int, script: str = "", bold: bool = False):
        self.size = size
        self.latin = _latin(size, bold)
        weight = "Bold" if bold else "Regular"
        self.other = _load((f"NotoSans{script}-{weight}.ttf", f"NotoSans{script}-Regular.ttf"), size) if script else None
        fonts = [self.latin] + ([self.other] if self.other else [])
        self.ascent = max(f.getmetrics()[0] for f in fonts)
        self.descent = max(f.getmetrics()[1] for f in fonts)

    def runs(self, text: str) -> list[tuple[str, ImageFont.FreeTypeFont]]:
        if not self.other:
            return [(text, self.latin)]
        runs: list[list] = []
        for ch in text:
            # Spaces join the current run so words stay together.
            font = runs[-1][1] if ch == " " and runs else (self.latin if _is_latin(ch) else self.other)
            if runs and runs[-1][1] is font:
                runs[-1][0] += ch
            else:
                runs.append([ch, font])
        return [(t, f) for t, f in runs]

    def getlength(self, text: str) -> float:
        return sum(f.getlength(t) for t, f in self.runs(text))

    def draw(self, d: ImageDraw.ImageDraw, xy, text: str, fill, anchor: str = "la") -> None:
        """Draw text. anchor: horizontal l/m/r + vertical a (top) / m (middle)."""
        x, y = xy
        w = self.getlength(text)
        x -= {"l": 0, "m": w / 2, "r": w}[anchor[0]]
        baseline = y + self.ascent if anchor[1] == "a" else y + (self.ascent - self.descent) / 2
        for t, f in self.runs(text):
            d.text((x, baseline), t, font=f, fill=fill, anchor="ls")
            x += f.getlength(t)


def wrap(text: str, font: MixedFont, max_w: float) -> list[str]:
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


def fit(text: str, font: MixedFont, max_w: float) -> str:
    """Truncate text with an ellipsis so it fits on one line."""
    if font.getlength(text) <= max_w:
        return text
    while text and font.getlength(text + "…") > max_w:
        text = text[:-1]
    return text.rstrip() + "…"
