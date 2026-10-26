"""Turn uploaded files (images, PDF, PPTX) into a list of slide images."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageOps

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
PDF_EXTS = {".pdf"}
OFFICE_EXTS = {".pptx", ".ppt", ".odp", ".key"}
SUPPORTED_EXTS = IMAGE_EXTS | PDF_EXTS | OFFICE_EXTS

# Long edge for slide images we keep on disk (rendering zooms in up to ~2x).
MAX_EDGE = 2400
MAX_SLIDES = 60


class IngestError(ValueError):
    pass


def _save_image(img: Image.Image, out: Path) -> Path:
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")
    if img.mode == "RGBA":
        # Flatten transparency onto white so slides look like slides.
        bg = Image.new("RGB", img.size, "white")
        bg.paste(img, mask=img.split()[3])
        img = bg
    img.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
    img.save(out, "PNG")
    return out


def _pdf_to_images(pdf: Path, out_dir: Path, start: int) -> list[Path]:
    import pymupdf

    paths = []
    with pymupdf.open(pdf) as doc:
        for i, page in enumerate(doc):
            # Render so the long edge is roughly MAX_EDGE pixels.
            long_edge_pt = max(page.rect.width, page.rect.height) or 1
            zoom = min(4.0, MAX_EDGE / long_edge_pt)
            pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
            out = out_dir / f"slide_{start + i:03d}.png"
            pix.save(out)
            paths.append(out)
    return paths


def _office_to_pdf(src: Path, work: Path) -> Path:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise IngestError(
            f"{src.name}: converting presentations needs LibreOffice installed. "
            "Export the deck to PDF and upload that instead."
        )
    subprocess.run(
        [soffice, "--headless", "--convert-to", "pdf", "--outdir", str(work), str(src)],
        check=True,
        capture_output=True,
        timeout=300,
    )
    pdf = work / (src.stem + ".pdf")
    if not pdf.exists():
        raise IngestError(f"{src.name}: LibreOffice could not convert this file.")
    return pdf


def files_to_slides(files: list[Path], out_dir: Path) -> list[Path]:
    """Convert uploaded files, in order, into PNG slide images in out_dir."""
    out_dir.mkdir(parents=True, exist_ok=True)
    work = out_dir / "_convert"
    work.mkdir(exist_ok=True)
    slides: list[Path] = []
    for f in files:
        ext = f.suffix.lower()
        if ext in IMAGE_EXTS:
            try:
                with Image.open(f) as img:
                    img.seek(0)
                    slides.append(_save_image(img.copy(), out_dir / f"slide_{len(slides):03d}.png"))
            except Exception as e:  # noqa: BLE001 - surface any decode error to the user
                raise IngestError(f"{f.name}: not a readable image ({e}).") from e
        elif ext in PDF_EXTS:
            slides += _pdf_to_images(f, out_dir, len(slides))
        elif ext in OFFICE_EXTS:
            slides += _pdf_to_images(_office_to_pdf(f, work), out_dir, len(slides))
        else:
            raise IngestError(f"{f.name}: unsupported file type '{ext}'.")
        if len(slides) > MAX_SLIDES:
            raise IngestError(f"Too many slides (max {MAX_SLIDES}).")
    shutil.rmtree(work, ignore_errors=True)
    if not slides:
        raise IngestError("No slides found in the uploaded files.")
    return slides
