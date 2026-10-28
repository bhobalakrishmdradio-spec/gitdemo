# SlideCast — slides & images → narrated explainer video

Upload slides or images (PNG/JPG/WEBP, PDF, or PowerPoint). SlideCast uses
**Claude's vision** to read each one and write a teacher-style explanation,
records it as speech, and renders an MP4 where each slide **pops in**, then the
camera **zooms into and spotlights each part as it is being explained**, with
synced captions.

```
upload ──► slide images ──► Claude reads each slide ──► review & edit ──► voice-over ──► animated MP4 + .srt
          (PDF/PPTX split)   (script + focus regions,     (optional)       (edge-tts)    (Pillow + ffmpeg)
                              intro, takeaways, quiz)
```

## Features

| Feature | What it does |
|---|---|
| **Zoom & spotlight** | Each sentence can point at a region of the slide; the camera glides in and dims everything else. |
| **Review before rendering** | Read the script first: edit titles and lines, delete lines, or leave slides out. After rendering you can edit again and re-render. |
| **11 languages** | English, Hindi, Marathi, Tamil, Telugu, Malayalam, Kannada, Bengali, Spanish, French, German — Claude writes the narration in that language (keeping common technical terms in English) and a matching voice reads it. |
| **Intro card** | Opens with a title card for the whole video and a short welcome. |
| **Key takeaways** | A summary card at the end; each takeaway is spotlighted as it is spoken. |
| **Quiz** | Optional end-of-video quiz: each question is asked, a 4-second pause gives thinking time, then the answer. |
| **Formats** | Landscape 16:9 (YouTube, lectures), vertical 9:16 (Shorts, Reels, Stories), square 1:1. |
| **Speed & captions** | Speaking speed from −30% to +30%; captions burned in or off; `.srt` subtitle file to download either way. |

## How it works

| Step | File | What happens |
|---|---|---|
| 1. Ingest | `app/ingest.py` | Images are normalized; PDFs are split into pages (PyMuPDF); PPTX is converted to PDF with LibreOffice. |
| 2. Narrate | `app/narrate.py` | Each slide is sent to Claude (`claude-opus-5-5`) with structured output: a title and short spoken segments, each with an optional **focus box**. A second text-only call writes the deck title, intro, takeaways and quiz. |
| 3. Cards | `app/cards.py` | Intro, takeaways and quiz cards are drawn as images, with exact focus boxes for every bullet. |
| 4. Voice | `app/tts.py`, `app/languages.py` | Each segment is spoken with a neural voice (edge-tts). Falls back to offline `espeak-ng`, then to captions only. |
| 5. Render | `app/render.py`, `app/text.py` | Frames are drawn with Pillow and piped to ffmpeg. Text mixing scripts (e.g. Hindi with "ECG") is drawn run by run with Noto + DejaVu fonts. |

## Run it

Requirements: Python 3.10+, `ffmpeg` on your PATH, an [Anthropic API key](https://console.anthropic.com/).
Optional: `espeak-ng` (offline voice), Noto fonts (`fonts-noto-core`, needed for Indic-language captions),
LibreOffice (`.pptx` uploads).

```bash
cd slide-video
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
uvicorn app.main:app --port 8000
# open http://localhost:8000
```

Or with Docker (includes ffmpeg, espeak-ng, Noto fonts and LibreOffice):

```bash
docker build -t slidecast slide-video
docker run -p 8000:8000 -e ANTHROPIC_API_KEY=sk-ant-... slidecast
```

### Command line

```bash
python -m app.cli lecture.pdf diagram.png -o lecture.mp4 \
  --language hi --format portrait --quiz --rate 10 \
  --instructions "Explain for first-year medical students"
```

Writes `lecture.mp4`, `lecture.srt` (subtitles) and `lecture.script.json` (the script).
Other flags: `--voice`, `--length short|medium|long`, `--no-captions`, `--no-intro`, `--no-takeaways`.
The command line renders straight through; script review is in the web app.

## Configuration

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Required for real narration |
| `SLIDECAST_MODEL` | Override the Claude model (default `claude-opus-5-5`) |
| `SLIDECAST_TTS` | Force a speech engine: `edge`, `espeak` or `silent` |
| `SLIDECAST_FAKE_AI=1` | Skip Claude and use a canned demo script (for testing the pipeline) |

## Notes

- Up to 60 slides and 100 MB per upload. Finished jobs are kept in `slide-video/jobs/` for 6 hours.
- Requests opt in to the API's server-side refusal fallback; if a slide is still declined, that
  slide gets a short generic narration instead of failing the whole video. If the
  intro/takeaways/quiz call is declined, the video is made without those cards.
- Focus boxes on uploaded slides come from Claude's reading of the image and are approximate;
  very small or near-full-slide boxes are ignored and that sentence shows the whole slide.
- Rendering runs at 25 fps (1280×720, 720×1280 or 1080×1080), roughly real-time on a laptop CPU.
