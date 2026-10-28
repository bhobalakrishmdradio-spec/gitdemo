"""Generated slides: intro title card, key takeaways, and quiz.

Cards are drawn as images and go through the same renderer as uploaded
slides. Because we draw them, we know exactly where each bullet is, so every
takeaway / question gets a precise focus box and pops out as it is spoken.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

from .text import MixedFont, wrap

PAPER = (247, 246, 251)
INK = (22, 26, 52)
MUTED = (110, 112, 140)
ACCENT = (255, 196, 61)
ACCENT_INK = (26, 26, 38)
QUIZ_PAUSE = 4.0  # seconds of thinking time after each question


def card_size(frame: tuple[int, int]) -> tuple[int, int]:
    """Card pixel size matching the slide area the renderer leaves inside the frame."""
    fw, fh = frame
    aspect = (fw * 0.86) / (fh * 0.80)
    return (2000, int(2000 / aspect)) if aspect >= 1 else (int(2000 * aspect), 2000)


def _base(size: tuple[int, int]) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGB", size, PAPER)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, int(size[0] * 0.012), size[1]], fill=ACCENT)
    return img, d


def intro_card(out: Path, frame, title: str, subtitle: str, script: str) -> Path:
    w, h = card_size(frame)
    img, d = _base((w, h))
    size = int(min(w, h) * 0.11)
    while True:
        font = MixedFont(size, script, bold=True)
        lines = wrap(title, font, w * 0.8)
        if len(lines) <= 3 or size < 30:
            break
        size = int(size * 0.9)
    lh = int(size * 1.25)
    sub = MixedFont(int(min(w, h) * 0.045), script)
    block = lh * len(lines) + int(size * 0.9) + sub.size
    y = (h - block) // 2
    for line in lines:
        font.draw(d, (w / 2, y), line, INK, "ma")
        y += lh
    y += int(size * 0.35)
    d.rounded_rectangle([w / 2 - size, y, w / 2 + size, y + max(6, size // 10)], radius=6, fill=ACCENT)
    y += int(size * 0.55)
    sub.draw(d, (w / 2, y), subtitle, MUTED, "ma")
    img.save(out)
    return out


def list_card(out: Path, frame, heading: str, items: list[str], script: str, numbered: str = "{n}"):
    """A heading plus numbered items. Returns (path, focus boxes as 0..1 fractions, one per item)."""
    w, h = card_size(frame)
    img, d = _base((w, h))
    margin_x, top = w * 0.08, h * 0.09
    head = MixedFont(int(min(w, h) * 0.075), script, bold=True)

    # Shrink the item font until everything fits under the heading.
    size = int(min(w, h) * 0.05)
    avail = h - top - head.size * 1.9 - h * 0.07
    while True:
        font = MixedFont(size, script)
        badge = int(size * 1.6)
        text_x = margin_x + badge + size * 0.7
        wrapped = [wrap(t, font, w - text_x - margin_x) for t in items]
        gap = size * 0.9
        lh = size * 1.3
        heights = [max(badge, lh * len(ls)) for ls in wrapped]
        if sum(heights) + gap * (len(items) - 1) <= avail or size < 20:
            break
        size = int(size * 0.9)

    head.draw(d, (margin_x, top), heading, INK, "la")
    y = top + head.size * 1.9
    boxes = []
    for i, (lines, bh) in enumerate(zip(wrapped, heights)):
        label = numbered.format(n=i + 1)
        bf = MixedFont(int(badge * 0.42), "", bold=True)
        bw = max(badge, int(bf.getlength(label) + badge * 0.5))
        d.rounded_rectangle([margin_x, y, margin_x + bw, y + badge], radius=badge // 2, fill=ACCENT)
        bf.draw(d, (margin_x + bw / 2, y + badge / 2), label, ACCENT_INK, "mm")
        tx = margin_x + bw + size * 0.7
        ty = y + (badge - lh * len(lines)) / 2 if len(lines) == 1 else y
        right = tx
        for j, line in enumerate(lines):
            font.draw(d, (tx, ty + j * lh + (lh - size) / 2), line, INK, "la")
            right = max(right, tx + font.getlength(line))
        pad = size * 0.4
        boxes.append([
            round(max(0, margin_x - pad) / w, 4), round(max(0, y - pad) / h, 4),
            round(min(w, right + pad) / w, 4), round(min(h, y + bh + pad) / h, 4),
        ])
        y += bh + gap
    img.save(out)
    return out, boxes


def build_cards(extras: dict, n_slides: int, frame, script: str, out_dir: Path,
                intro: bool, takeaways: bool, quiz: bool) -> tuple[list[dict], list[dict]]:
    """Return (cards before the slides, cards after the slides) as slide entries."""
    out_dir.mkdir(parents=True, exist_ok=True)
    before, after = [], []
    if intro:
        sub = f"{n_slides} slide{'s' if n_slides != 1 else ''}"
        path = intro_card(out_dir / "intro.png", frame, extras["deck_title"], sub, script)
        before.append({"kind": "intro", "image": path, "title": extras["deck_title"],
                       "segments": [{"text": extras["intro"], "focus": None}]})
    if takeaways and extras["takeaways"]:
        items = extras["takeaways"]
        path, boxes = list_card(out_dir / "takeaways.png", frame, extras["takeaways_heading"],
                                [t["bullet"] for t in items], script)
        segs = [{"text": t["spoken"], "focus": b} for t, b in zip(items, boxes)]
        if extras.get("takeaways_outro"):
            segs.append({"text": extras["takeaways_outro"], "focus": None})
        after.append({"kind": "takeaways", "image": path, "title": extras["takeaways_heading"], "segments": segs})
    if quiz and extras["quiz"]:
        items = extras["quiz"]
        path, boxes = list_card(out_dir / "quiz.png", frame, extras["quiz_heading"],
                                [q["question"] for q in items], script, numbered="Q{n}")
        segs = [{"text": extras["quiz_intro"], "focus": None}] if extras.get("quiz_intro") else []
        for q, b in zip(items, boxes):
            segs.append({"text": q["question"], "focus": b, "pause": QUIZ_PAUSE})
            segs.append({"text": q["answer"], "focus": b})
        after.append({"kind": "quiz", "image": path, "title": extras["quiz_heading"], "segments": segs})
    return before, after
