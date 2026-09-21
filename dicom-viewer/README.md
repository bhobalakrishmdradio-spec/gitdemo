# CT Console — Personal DICOM Viewer, MPR & 3D Workstation

A private, fully client-side DICOM workstation for reviewing your own CT (and
other cross-sectional) scans in the browser. No backend, no account, no
upload: every file you open is parsed, reconstructed and rendered locally and
never leaves your device.

**This is a personal image-review tool, not a medical device.** It is not
intended for primary diagnostic interpretation — always rely on a
radiologist's report and your official imaging system for clinical decisions.

## Features

### Viewing

- **Open Files / Open Folder** — load one or many `.dcm` files at once
  (drag-and-drop onto the window also works, including whole folders).
- **Automatic series grouping** — instances are grouped by Series Instance
  UID and sorted by slice position / instance number.
- **Window/Level** — left-drag on any plane (horizontal = width, vertical =
  level), manual numeric entry, or one-click presets: Lung, Bone, Brain, Soft
  Tissue, Abdomen, Mediastinum, Angio. Each image's Rescale Slope/Intercept is
  applied, so values are windowed in real Hounsfield Units.
- **Invert, zoom, pan, crosshair**, and a per-viewport slice scrubber.

### Multiplanar reconstruction (MPR)

- The series is reconstructed into a **3D volume** of Hounsfield Units with
  real voxel spacing taken from Pixel Spacing and the slice positions.
- **Axial, coronal and sagittal** planes are resliced out of that volume, each
  rendered at its true physical aspect ratio, so anisotropic voxels (thick
  slices) don't render squashed.
- **Linked crosshair** — Shift+click in any plane to drive the other two to
  that point.
- **Layouts**: 2×2 (three planes + 3D), single axial, three-up MPR, or 3D
  alone. Double-click a viewport to expand it; keys `1`–`4` switch layouts.

### Slice thickness & projection

- **Slab thickness** in millimetres, from the native thin slice up to 50 mm.
- **Projection modes** across the slab:
  - **Average** — the conventional thick-slice reconstruction.
  - **MIP** (maximum intensity) — brings out contrast-filled vessels and bone.
  - **MinIP** (minimum intensity) — brings out airways and low-density lung.

### Bone cut

- Threshold-based bone segmentation with a 3D dilation, so the cortical rim
  and partial-volume halo go with it rather than leaving a bright shell.
- Adjustable HU threshold; applies to **both** the MPR planes and the 3D view.
- Because it is a pure threshold, contrast-opacified vessels are also removed
  at low thresholds — raise the threshold above ~350 HU to keep them.

### 3D volume rendering

- GPU raymarching through a WebGL2 3D texture.
- **Volume Rendering** with clinical transfer-function presets — Bone, Angio,
  Soft Tissue, Lung, Skin — with gradient-based shading.
- **3D MIP** through the whole volume.
- Adjustable opacity; drag to rotate, wheel to zoom.

## Running it

No build step, no dependencies to install — plain HTML/CSS/JS.

1. Open `index.html` directly in your browser, **or**
2. Serve it locally (recommended, since some browsers restrict local file
   reads):

   ```bash
   python3 -m http.server 8000
   # then visit http://localhost:8000
   ```

3D volume rendering needs **WebGL2**. If it isn't available the 2D and MPR
views still work and the 3D panel says so.

## Loading your scans

CT scanners and PACS systems typically let you export a study to a CD/USB
drive or a ZIP file as standard **DICOM Part 10** files (often under a folder
named `DICOM` with files that have no extension or a `.dcm` extension). Point
**Open Folder** at that folder, or drag the whole folder onto the window.

MPR and 3D need a **stack** — a single image can be viewed but not
reconstructed.

## What it does and doesn't support

- Supports uncompressed pixel data: **Implicit VR Little Endian**, **Explicit
  VR Little Endian**, and **Explicit VR Big Endian** transfer syntaxes — this
  covers the majority of CT exports.
- Does **not** decode compressed transfer syntaxes (JPEG Baseline/Lossless,
  JPEG 2000, RLE). If a file uses one, the viewer says so instead of failing
  silently — re-export as uncompressed, or convert it first with a tool such
  as `dcmdjpeg`/GDCM/dcm2niix.
- Reslicing is **orthogonal** — axial, coronal and sagittal. Oblique and
  curved-planar reformats are not implemented.
- Assumes an axial acquisition with consistent orientation; gantry tilt and
  per-slice orientation changes are not corrected for.
- Large series are downsampled in-plane to keep the volume within a memory
  budget; the Volume panel reports when that happens.
- No measurement, annotation or segmentation-editing tools.

## Keyboard

| Key | Action |
| --- | --- |
| `↑` `↓` / `←` `→` | Previous / next slice in the active plane |
| `Page Up` / `Page Down` | Jump 10 slices |
| `1` `2` `3` `4` | Layout: 2×2 · Axial · MPR · 3D |
| `I` | Invert grayscale |
| `R` | Reset views |

Mouse: left-drag = window/level · wheel = change slice · Shift+wheel = zoom ·
right-drag = pan · Shift+click = move crosshair · double-click = expand pane.

## Project structure

```
dicom-viewer/
  index.html                    # Workstation layout
  css/styles.css                # Dark radiology-console theme
  js/app.js                     # Parsing, UI, MPR viewports, interaction
  js/volume.js                  # Volume build, reslicing, slab/MIP, bone mask
  js/vr.js                      # WebGL2 raymarching volume renderer
  js/vendor/dicomParser.min.js  # Third-party DICOM parser (MIT license)
```

`volume.js` is pure computation over typed arrays with no DOM dependency, so
the reconstruction math can be exercised headlessly.

## Privacy

All parsing, reconstruction and rendering happens locally in your browser. No
image data, metadata, or files are sent to any server — this page makes no
network requests once loaded.

## Credits

Built on [`dicom-parser`](https://github.com/cornerstonejs/dicomParser)
(MIT License) by Chris Hafey / the Cornerstone.js project, vendored in
`js/vendor/` — see `js/vendor/LICENSE-dicom-parser.txt`.
