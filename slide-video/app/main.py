"""Web server: upload slides/images, review the script, render the video, download.

Run:  uvicorn app.main:app --reload   (from the slide-video/ folder)

Job states: preparing -> review (if requested) -> rendering -> done | error
"""

from __future__ import annotations

import logging
import shutil
import threading
import time
import uuid
from dataclasses import asdict
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .ingest import SUPPORTED_EXTS, IngestError
from .languages import DEFAULT_LANGUAGE, LANGUAGES
from .pipeline import Options, prepare, render_project
from .render import FORMATS

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("slidecast")

ROOT = Path(__file__).resolve().parent.parent
JOBS_DIR = ROOT / "jobs"
JOBS_DIR.mkdir(exist_ok=True)
MAX_UPLOAD_MB = 100
JOB_TTL_SECONDS = 6 * 3600
MAX_SEGMENT_CHARS = 1500

app = FastAPI(title="SlideCast")
jobs: dict[str, dict] = {}
lock = threading.Lock()


def _cleanup_old_jobs() -> None:
    cutoff = time.time() - JOB_TTL_SECONDS
    with lock:
        for jid in [j for j, v in jobs.items() if v["created"] < cutoff and v["status"] not in ("preparing", "rendering")]:
            shutil.rmtree(JOBS_DIR / jid, ignore_errors=True)
            jobs.pop(jid, None)


def _get(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown job")
    return job


def _progress(job: dict):
    def update(msg: str, frac: float) -> None:
        job.update(message=msg, progress=round(min(1.0, frac), 3))
    return update


def _guarded(job_id: str, fn) -> None:
    job = jobs[job_id]
    try:
        fn(job)
    except (IngestError, ValueError) as e:
        job.update(status="error", message=str(e))
    except Exception as e:  # noqa: BLE001 - report any failure to the UI
        log.exception("job %s failed", job_id)
        job.update(status="error", message=f"Something went wrong: {e}")


def _render(job: dict) -> None:
    job.update(status="rendering", progress=0.0, message="Starting render")
    result = render_project(job["project"], JOBS_DIR / job["id"], job["options"], _progress(job))
    job.update(status="done", progress=1.0, message="Your video is ready", tts_engine=result["tts_engine"],
               duration=result["duration"], slide_count=result["slides"])


def _prepare_then_maybe_render(job: dict, files: list[Path], review: bool) -> None:
    job["project"] = prepare(files, JOBS_DIR / job["id"], job["options"], _progress(job))
    if review:
        job.update(status="review", progress=1.0, message="Review the script, then render")
    else:
        _render(job)


@app.get("/api/options")
def options() -> dict:
    return {
        "default_language": DEFAULT_LANGUAGE,
        "languages": {code: {"name": lang.name, "voices": lang.voices} for code, lang in LANGUAGES.items()},
        "formats": list(FORMATS),
    }


@app.post("/api/jobs")
async def create_job(
    files: list[UploadFile] = File(...),
    language: str = Form(DEFAULT_LANGUAGE),
    voice: str = Form(""),
    rate: int = Form(0),
    length: str = Form("medium"),
    instructions: str = Form(""),
    format: str = Form("landscape"),
    captions: bool = Form(True),
    intro: bool = Form(True),
    takeaways: bool = Form(True),
    quiz: bool = Form(False),
    review: bool = Form(False),
) -> dict:
    _cleanup_old_jobs()
    job_id = uuid.uuid4().hex[:12]
    upload_dir = JOBS_DIR / job_id / "uploads"
    upload_dir.mkdir(parents=True)
    saved, total = [], 0
    for i, f in enumerate(files):
        ext = Path(f.filename or "").suffix.lower()
        if ext not in SUPPORTED_EXTS:
            shutil.rmtree(JOBS_DIR / job_id, ignore_errors=True)
            raise HTTPException(400, f"Unsupported file: {f.filename}")
        data = await f.read()
        total += len(data)
        if total > MAX_UPLOAD_MB * 1024 * 1024:
            shutil.rmtree(JOBS_DIR / job_id, ignore_errors=True)
            raise HTTPException(413, f"Uploads are limited to {MAX_UPLOAD_MB} MB in total.")
        # Never trust the client's filename for the path; keep only the extension.
        path = upload_dir / f"{i:03d}{ext}"
        path.write_bytes(data)
        saved.append(path)

    opts = Options(language=language if language in LANGUAGES else DEFAULT_LANGUAGE, voice=voice, rate=rate,
                   length=length, instructions=instructions[:2000], format=format, captions=captions,
                   intro=intro, takeaways=takeaways, quiz=quiz)
    jobs[job_id] = {"id": job_id, "status": "preparing", "progress": 0.0, "message": "Queued",
                    "created": time.time(), "options": opts}
    threading.Thread(
        target=_guarded, args=(job_id, lambda job: _prepare_then_maybe_render(job, saved, review)), daemon=True
    ).start()
    return {"id": job_id}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    job = _get(job_id)
    out = {k: v for k, v in job.items() if k not in ("created", "options", "project")}
    out["options"] = asdict(job["options"])
    if "project" in job:
        out["script"] = [
            {"kind": s["kind"], "title": s["title"], "include": s.get("include", True),
             "segments": [{"index": g.get("index", i), "text": g["text"], "focus": bool(g.get("focus")),
                           "pause": bool(g.get("pause"))} for i, g in enumerate(s["segments"])]}
            for s in job["project"]["slides"]
        ]
    return out


class SegmentEdit(BaseModel):
    index: int  # position of the segment in the original script
    text: str


class SlideEdit(BaseModel):
    title: str
    include: bool = True
    segments: list[SegmentEdit]


class RenderRequest(BaseModel):
    slides: list[SlideEdit]


@app.post("/api/jobs/{job_id}/render")
def render_job(job_id: str, req: RenderRequest) -> dict:
    """Apply the edited script (titles, text, removed segments/slides) and start rendering."""
    job = _get(job_id)
    if job["status"] not in ("review", "done", "error") or "project" not in job:
        raise HTTPException(409, "This job is not ready for rendering")
    slides = job["project"]["slides"]
    if len(req.slides) != len(slides):
        raise HTTPException(400, "Slide list doesn't match the script")
    # Edits always apply to the original script, so a job can be re-rendered with new changes.
    original = job.setdefault("original_slides", [dict(s) for s in slides])
    edited = []
    for orig, edit in zip(original, req.slides):
        segs = []
        for e in edit.segments:
            if not 0 <= e.index < len(orig["segments"]):
                raise HTTPException(400, "Unknown segment")
            text = " ".join(e.text.split())[:MAX_SEGMENT_CHARS]
            if text:
                segs.append({**orig["segments"][e.index], "text": text, "index": e.index})
        edited.append({**orig, "title": " ".join(edit.title.split())[:120] or orig["title"],
                       "include": edit.include, "segments": segs})
    if not any(s["include"] and s["segments"] for s in edited):
        raise HTTPException(400, "Keep at least one slide with narration")
    job["project"] = {**job["project"], "slides": edited}
    job.update(status="rendering", progress=0.0, message="Starting render")
    threading.Thread(target=_guarded, args=(job_id, _render), daemon=True).start()
    return {"id": job_id}


@app.get("/api/jobs/{job_id}/slides/{n}")
def slide_image(job_id: str, n: int) -> FileResponse:
    job = _get(job_id)
    slides = job.get("original_slides") or job.get("project", {}).get("slides", [])
    if not 0 <= n < len(slides):
        raise HTTPException(404, "No such slide")
    return FileResponse(JOBS_DIR / job_id / slides[n]["image"], media_type="image/png")


@app.get("/api/jobs/{job_id}/video")
def job_video(job_id: str, download: bool = False) -> FileResponse:
    if _get(job_id)["status"] != "done":
        raise HTTPException(404, "Video not ready")
    return FileResponse(JOBS_DIR / job_id / "video.mp4", media_type="video/mp4",
                        filename="explainer.mp4" if download else None)


@app.get("/api/jobs/{job_id}/subtitles")
def job_subtitles(job_id: str) -> FileResponse:
    if _get(job_id)["status"] != "done":
        raise HTTPException(404, "Subtitles not ready")
    return FileResponse(JOBS_DIR / job_id / "subtitles.srt", media_type="application/x-subrip",
                        filename="explainer.srt")


app.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="static")
