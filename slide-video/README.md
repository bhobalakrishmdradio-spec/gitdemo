# SlideCast — slides & images → narrated explainer video

Upload slides or images (PNG/JPG/WEBP, PDF, or PowerPoint). SlideCast uses
**Claude's vision** to read each one and write a teacher-style explanation,
records it as speech, and renders an MP4 where each slide **pops in**, then the
camera **zooms into and spotlights each part as it is being explained**, with
synced captions.

```
upload ──► slide images ──► Claude reads each slide ──► voice-over ──► animated MP4
          (PDF/PPTX split)   (script + focus regions)    (edge-tts)    (Pillow + ffmpeg)
```

## How it works

| Step | File | What happens |
|---|---|---|
| 1. Ingest | `app/ingest.py` | Images are normalized; PDFs are split into pages (PyMuPDF); PPTX is converted to PDF with LibreOffice. |
| 2. Narrate | `app/narrate.py` | Each slide is sent to Claude (`claude-opus-5-5`) with structured output. Claude returns a title and short spoken segments; each segment can carry a **focus box** — the region of the slide that sentence explains. |
| 3. Voice | `app/tts.py` | Each segment is spoken with a neural voice (edge-tts). Falls back to offline `espeak-ng`, then to captions-only. |
| 4. Render | `app/render.py` | Frames are drawn with Pillow and piped to ffmpeg: slide pop-in, camera glide + zoom to each focus box, dimmed spotlight with a pulsing ring, pop-in captions and a title chip. |

## Run it

Requirements: Python 3.10+, `ffmpeg` on your PATH, an [Anthropic API key](https://console.anthropic.com/).
Optional: `espeak-ng` (offline voice), LibreOffice (`.pptx` uploads).

```bash
cd slide-video
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
uvicorn app.main:app --port 8000
# open http://localhost:8000
```

Or with Docker (includes ffmpeg, espeak-ng and LibreOffice):

```bash
docker build -t slidecast slide-video
docker run -p 8000:8000 -e ANTHROPIC_API_KEY=sk-ant-... slidecast
```

### Command line

```bash
python -m app.cli lecture.pdf diagram.png -o lecture.mp4 --length long \
  --voice en-GB-SoniaNeural --instructions "Explain for first-year medical students"
```

Writes `lecture.mp4` plus `lecture.script.json` (the narration script).

## Options

| Option | Values |
|---|---|
| Voice | Several English neural voices (US, UK, India, Australia) |
| Depth | `short` (~30 s/slide), `medium` (~1 min/slide), `long` (~1–2 min/slide) |
| Instructions | Free text for the narrator: audience, tone, what to emphasise |

Environment variables:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Required for real narration |
| `SLIDECAST_MODEL` | Override the Claude model (default `claude-opus-5-5`) |
| `SLIDECAST_TTS` | Force a speech engine: `edge`, `espeak` or `silent` |
| `SLIDECAST_FAKE_AI=1` | Skip Claude and use a canned demo script (for testing the pipeline) |

## Notes

- Up to 60 slides and 100 MB per upload. Finished jobs are kept in `slide-video/jobs/` for 6 hours.
- Requests opt in to the API's server-side refusal fallback; if a slide is still declined, that
  slide gets a short generic narration instead of failing the whole video.
- Focus boxes come from Claude's reading of the image and are approximate; very small or
  near-full-slide boxes are ignored and that sentence shows the whole slide.
- Rendering runs at 1280×720, 25 fps — roughly real-time on a laptop CPU.
