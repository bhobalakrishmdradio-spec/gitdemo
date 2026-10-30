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

## Install as your private app (Mac, iPhone, iPad)

Your **Mac does the work** (Claude calls, voice, video rendering) and runs SlideCast in the
background from login. Your **iPhone and iPad use it as an app**: a home-screen icon that opens
full screen. Only you can get in: there is a password, and with Tailscale the app isn't
reachable from the internet at all, only from your own signed-in devices.

```
iPhone / iPad (home-screen app) ──Tailscale, encrypted──►  your Mac: SlideCast ──► Claude API
Mac (Dock app)                   ──localhost────────────►
```

### 1. On your Mac (once)

```bash
git clone https://github.com/bhobalakrishmdradio-spec/gitdemo.git ~/SlideCast
~/SlideCast/slide-video/mac/install.sh
```

The installer:
1. installs Homebrew if needed, then Python, ffmpeg, the offline voice and caption fonts;
2. asks for your **Anthropic API key** and a **password** (both stored only in `~/.slidecast/config.env`, readable only by you);
3. asks how your iPhone/iPad should connect: **Tailscale** (recommended) or **home Wi-Fi only**;
4. starts SlideCast and registers it to start at every login;
5. opens it in your browser.

Then in **Safari ▸ File ▸ Add to Dock…** to get a SlideCast app icon in your Dock
(Chrome: ⋮ ▸ Cast, save and share ▸ Install page as app).

### 2. Private access for iPhone and iPad: Tailscale (recommended)

[Tailscale](https://tailscale.com) is a free private network between your own devices. Nothing is
opened to the internet; only devices signed in to your account can reach the Mac, at home or away.

1. Install **Tailscale** on the Mac (Mac App Store) and on the iPhone and iPad (App Store). Sign in with the same account on all three.
2. In the [Tailscale admin console ▸ DNS](https://login.tailscale.com/admin/dns), turn on **MagicDNS** and **HTTPS Certificates**.
3. Run `~/SlideCast/slide-video/mac/install.sh` again and keep your settings. It turns on
   `tailscale serve` and prints your address, like `https://your-mac.tailXXXX.ts.net`.

If you chose **home Wi-Fi only** instead, the address is `http://YOUR-MAC-NAME.local:8000` and works
only while the phone is on the same Wi-Fi as the Mac.

### 3. On iPhone and iPad

1. Open the address in **Safari** and sign in with your password.
2. Tap **Share ▸ Add to Home Screen ▸ Add**.
3. Open **SlideCast** from the home screen. It runs full screen like an app and stays signed in.

On iPhone you can pick slides straight from **Photos** (HEIC works) or **Files**. When a video is
done, **Save / Share ▸ Save Video** puts it in Photos. **My videos** keeps everything for 30 days,
and a video keeps rendering on the Mac even if you close the app.

### Day to day

| Task | How |
|---|---|
| Change password, API key or access mode | Run `mac/install.sh` again and answer **n** to "keep settings". Changing the password signs out every device. |
| Update SlideCast | `cd ~/SlideCast && git pull && slide-video/mac/install.sh` |
| See what's happening | `tail -f ~/Library/Logs/SlideCast.log` |
| Remove it | `~/SlideCast/slide-video/mac/uninstall.sh` (asks before deleting videos and settings) |

The Mac must be awake for your phone to reach it. On a laptop, keep it plugged in with the lid
open, or turn on **System Settings ▸ Battery ▸ Options ▸ Prevent automatic sleeping on power adapter
when the display is off**.

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

## Run it for development

Requirements: Python 3.10+, `ffmpeg` on your PATH, an [Anthropic API key](https://console.anthropic.com/).
Optional: `espeak-ng` (offline voice), Noto fonts (`fonts-noto-core`, needed for Indic-language captions),
LibreOffice (`.pptx` uploads).

```bash
cd slide-video
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-... SLIDECAST_PASSWORD=choose-a-password
uvicorn app.main:app --port 8000
# open http://localhost:8000
```

Or with Docker (includes ffmpeg, espeak-ng, Noto fonts and LibreOffice):

```bash
docker build -t slidecast slide-video
docker run -p 8000:8000 -e ANTHROPIC_API_KEY=sk-ant-... -e SLIDECAST_PASSWORD=choose-a-password slidecast
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
| `SLIDECAST_PASSWORD` | Password for signing in (required; nothing but the login page works without it) |
| `SLIDECAST_SECRET` | Key that signs the login cookie. Set it so sign-ins survive restarts (the Mac installer does). |
| `SLIDECAST_DATA` | Where videos are stored (default `slide-video/jobs/`) |
| `SLIDECAST_KEEP_DAYS` | How long finished videos are kept (default 30) |
| `SLIDECAST_NO_AUTH=1` | Turn off the password, for local development only |
| `SLIDECAST_MODEL` | Override the Claude model (default `claude-opus-5-5`) |
| `SLIDECAST_TTS` | Force a speech engine: `edge`, `espeak` or `silent` |
| `SLIDECAST_FAKE_AI=1` | Skip Claude and use a canned demo script (for testing the pipeline) |

## Notes

- Up to 60 slides and 200 MB per upload.
- Five wrong passwords lock a device out for 15 minutes.
- Requests opt in to the API's server-side refusal fallback; if a slide is still declined, that
  slide gets a short generic narration instead of failing the whole video. If the
  intro/takeaways/quiz call is declined, the video is made without those cards.
- Focus boxes on uploaded slides come from Claude's reading of the image and are approximate;
  very small or near-full-slide boxes are ignored and that sentence shows the whole slide.
- Rendering runs at 25 fps (1280×720, 720×1280 or 1080×1080), roughly real-time on a laptop CPU.
