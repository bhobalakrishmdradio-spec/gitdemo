# CT Console — Personal DICOM Viewer

A private, fully client-side DICOM viewer for reviewing your own CT (and
other cross-sectional) scans in the browser — a lightweight, "RadiAnt-style"
console. No backend, no account, no upload: every file you open is parsed
and rendered locally in your browser and never leaves your device.

**This is a personal image-review tool, not a medical device.** It is not
intended for primary diagnostic interpretation — always rely on a
radiologist's report and your official imaging system for clinical
decisions.

## Features

- **Open Files / Open Folder** — load one or many `.dcm` files at once
  (drag-and-drop onto the window also works, including whole folders in
  Chromium-based browsers).
- **Automatic series grouping** — instances are grouped by Series Instance
  UID and sorted by instance number / slice position.
- **Slice navigation** — scrubber, thumbnail grid, ↑/↓ arrow keys,
  Page Up/Down (jump by 10), mouse wheel + Shift, or **cine playback**
  (▶️ button / spacebar).
- **Window/Level (brightness & contrast)**:
  - Left-click drag on the image: horizontal = window width, vertical =
    window level — the standard radiology "WL" gesture.
  - Manual numeric entry.
  - One-click **presets**: Lung, Bone, Brain, Soft Tissue, Abdomen,
    Mediastinum, Angio.
  - Correctly applies each image's Rescale Slope/Intercept, so CT values
    are windowed in real Hounsfield Units.
- **Zoom & pan** — mouse wheel to zoom, right/middle-click drag to pan,
  `+`/`-` keys, **Reset** button/`R` key.
- **Invert, flip horizontal/vertical, rotate 90°.**
- **DICOM metadata panel** — patient, study, series, geometry (pixel
  spacing, slice thickness/location), and pixel-data details straight from
  the file's own header tags.
- **Multi-frame support** — each frame of a multi-frame DICOM object is
  browsable as its own slice.
- Dark, radiology-console-style theme designed for image review.

## Running it

No build step, no dependencies to install — plain HTML/CSS/JS.

1. Open `index.html` directly in your browser, **or**
2. Serve it locally (recommended, since some browsers restrict local file
   reads):

   ```bash
   python3 -m http.server 8000
   # then visit http://localhost:8000
   ```

## Loading your scans

CT scanners and PACS systems typically let you export a study to a CD/USB
drive or a ZIP file as standard **DICOM Part 10** files (often under a
folder named `DICOM` with files that have no extension or a `.dcm`
extension). Point **Open Folder** at that folder, or drag the whole folder
onto the window.

## What it does and doesn't support

- Supports uncompressed pixel data: **Implicit VR Little Endian**,
  **Explicit VR Little Endian**, and **Explicit VR Big Endian** transfer
  syntaxes — this covers the vast majority of CT exports.
- Does **not** decode compressed transfer syntaxes (JPEG Baseline/Lossless,
  JPEG 2000, RLE). If a file uses one of these, the viewer will tell you
  instead of failing silently — re-export as uncompressed, or convert it
  first with a tool such as `dcmdjpeg`/GDCM/dcm2niix.
- Designed for 2D slice-by-slice review, not multi-planar reconstruction
  (MPR), 3D volume rendering, or measurement/annotation tools.

## Project structure

```
dicom-viewer/
  index.html                    # App layout: toolbar, panels, viewport
  css/styles.css                # Dark radiology-console theme
  js/app.js                     # Parsing, rendering, interaction logic
  js/vendor/dicomParser.min.js  # Third-party DICOM parser (MIT license)
```

## Privacy

All parsing and rendering happens locally in your browser using JavaScript
`FileReader`/`Canvas` APIs. No image data, metadata, or files are sent to
any server — this page makes no network requests once loaded.

## Credits

Built on [`dicom-parser`](https://github.com/cornerstonejs/dicomParser)
(MIT License) by Chris Hafey / the Cornerstone.js project, vendored in
`js/vendor/` — see `js/vendor/LICENSE-dicom-parser.txt`.
