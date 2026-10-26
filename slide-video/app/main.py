"""Web server: upload slides/images, generate the video in the background, poll, download.

Run:  uvicorn app.main:app --reload   (from the slide-video/ folder)
"""

from __future__ import annotations

import logging
import shutil
import threading
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .ingest import SUPPORTED_EXTS, IngestError
from .pipeline import make_video
from .tts import DEFAULT_VOICE, VOICES

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("slidecast")

ROOT = Path(__file__).resolve().parent.parent
JOBS_DIR = ROOT / "jobs"
JOBS_DIR.mkdir(exist_ok=True)
MAX_UPLOAD_MB = 100
JOB_TTL_SECONDS = 6 * 3600

app = FastAPI(title="SlideCast")
jobs: dict[str, dict] = {}
lock = threading.Lock()


def _cleanup_old_jobs() -> None:
    cutoff = time.time() - JOB_TTL_SECONDS
    with lock:
        for jid in [j for j, v in jobs.items() if v["created"] < cutoff]:
            shutil.rmtree(JOBS_DIR / jid, ignore_errors=True)
            jobs.pop(jid, None)


def _run(job_id: str, files: list[Path], voice: str, length: str, instructions: str) -> None:
    job = jobs[job_id]

    def progress(msg: str, frac: float) -> None:
        job.update(message=msg, progress=round(min(1.0, frac), 3))

    try:
        result = make_video(files, JOBS_DIR / job_id, voice, length, instructions, progress)
        job.update(
            status="done", progress=1.0, message="Your video is ready",
            scripts=result["scripts"], tts_engine=result["tts_engine"],
            duration=result["duration"], slides=result["slides"],
        )
    except IngestError as e:
        job.update(status="error", message=str(e))
    except Exception as e:  # noqa: BLE001 - report any failure to the UI
        log.exception("job %s failed", job_id)
        job.update(status="error", message=f"Something went wrong: {e}")


@app.get("/api/voices")
def voices() -> dict:
    return {"default": DEFAULT_VOICE, "voices": VOICES}


@app.post("/api/jobs")
async def create_job(
    files: list[UploadFile] = File(...),
    voice: str = Form(DEFAULT_VOICE),
    length: str = Form("medium"),
    instructions: str = Form(""),
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

    jobs[job_id] = {"status": "running", "progress": 0.0, "message": "Queued", "created": time.time()}
    threading.Thread(
        target=_run, args=(job_id, saved, voice, length, instructions[:2000]), daemon=True
    ).start()
    return {"id": job_id}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown job")
    return {k: v for k, v in job.items() if k != "created"}


@app.get("/api/jobs/{job_id}/video")
def job_video(job_id: str, download: bool = False) -> FileResponse:
    job = jobs.get(job_id)
    if not job or job["status"] != "done":
        raise HTTPException(404, "Video not ready")
    return FileResponse(
        JOBS_DIR / job_id / "video.mp4", media_type="video/mp4",
        filename="explainer.mp4" if download else None,
    )


app.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="static")
