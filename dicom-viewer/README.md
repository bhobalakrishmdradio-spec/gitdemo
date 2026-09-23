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

- **Open / Folder** — load one or many `.dcm` files at once, or a whole
  directory (drag-and-drop onto the window also works, including folders).
- **Automatic series grouping** — instances are grouped by Series Instance
  UID and sorted by slice position / instance number.
- **Window/Level** — left-drag on any plane: **right** widens the window,
  **left** narrows it, **down** darkens and **up** brightens. There is also
  manual numeric entry and one-click presets: Lung, Bone, Brain, Soft Tissue,
  Abdomen, Mediastinum, Angio. Each image's Rescale Slope/Intercept is
  applied, so values are windowed in real Hounsfield Units.

  The drag is **scale-invariant**: the width moves multiplicatively (160 px
  doubles or halves it, wherever you start) and the level steps in proportion
  to the current width (250 px shifts it by one whole window). A fixed step
  per pixel cannot serve both ends of CT — the same step that is barely
  visible on a lung window (W1500) throws a brain window (W80) past its own
  width in a twitch — so the gesture feels identical on every preset, and the
  width cannot be slammed to zero by one long drag.
- **Invert, zoom, pan, crosshair**, and a per-pane slice scrubber.
- **Rotation** — 90° steps either way, or **free rotate** (`◷`): arm it and
  drag on a pane to turn it to any angle.

### Modality

CT and MR both load, reconstruct and measure. What differs is everything that
assumes a Hounsfield scale, and the viewer does not pretend otherwise:

| | CT | MR and other non-HU data |
| --- | --- | --- |
| Intensities | labelled **HU** | reported as stored values |
| Window presets | Lung, Bone, Brain, Soft, Abdomen, Mediastinum, Angio | From header, Auto contrast, Full range — derived from the study, since MR signal is not comparable between sequences |
| Bone cut | available | disabled, with the reason given |
| 3D presets | HU transfer functions | presets over the volume's own value range |

### Multiplanar reconstruction (MPR)

- The series is reconstructed into a **3D volume** of Hounsfield Units with
  real voxel spacing taken from Pixel Spacing and the slice positions.
- **Axial, coronal and sagittal** planes are resliced out of that volume, each
  rendered at its true physical aspect ratio, so anisotropic voxels (thick
  slices) don't render squashed.
- **Linked crosshair** — Shift+click in any plane to drive the other two to
  that point.
- **Oblique MPR** — Alt+drag in any plane to swing its crosshair. The plane
  you drag in holds still while the other two cuts tilt to follow, so you can
  line a reformat up with a vessel, a disc space or an angled fracture. The
  tilt angle of each plane is shown in the pane and in the Oblique MPR
  panel, and **Straighten planes** puts everything back square.
  Oblique cuts are trilinear-sampled at the volume's finest voxel pitch;
  while the planes are square the fast axis-aligned path is used instead, so
  you pay for resampling only when you actually tilt something.
- **Layouts**: 2×2 (three planes + 3D), 1×1 single pane, three-up MPR, 3D alone,
  and the larger grids **1×2** and **2×3**. Double-click a pane to expand it
  and again to go back; keys `1`–`6` switch layouts. Any grid can be filled
  with a single plane — see below.

### Filling a grid with one plane

The **Mixed planes / All axial / All coronal / All sagittal** selector, beside
the layout buttons, points every pane at one plane. That is what turns a grid
into a filmstrip: `2×3` + *All axial* gives six consecutive axial slices on
screen at once, and one scroll pages all six (see **Stacked scrolling**
below). *Mixed planes* restores each layout's own arrangement of the three
planes plus the 3D view.

The choice follows you between grids, so you can go from `1×2` to `2×3`
without losing it. The **MPR** and **3D** layouts are defined by the planes
they show, so the selector does not apply to them and greys out. Changing a
single pane by hand puts the selector back to *Mixed planes*, since the grid
is no longer uniform.

### Panes

Every pane in a layout is independent, so a grid of six or sixteen is not six
or sixteen copies of the same thing:

- **Which view** — the selector at the top of each pane points it at axial,
  coronal, sagittal or 3D. Only one pane can hold the 3D view, since that is a
  single WebGL context; assigning it elsewhere moves it.
- **Its own window** — `W/L: global` follows the toolbar, or pick a preset for
  that pane alone. A bone window beside a soft-tissue window on the same slice
  is one click. A pane with its own window keeps left-drag local to itself;
  panes on `global` drive the toolbar W/L as before.
- **Its own zoom, pan, rotation and flip** — rotate/flip act on the pane you
  last clicked in.

### Stacked scrolling

Panes showing the same plane sit a fixed number of slices apart, so a grid is
a **run of consecutive images rather than one image repeated** — the 2×3 grid
shows six different levels at once. Scrolling *any* pane (wheel, slider or
arrow keys) moves the whole run together and keeps the spacing, so one scroll
advances the entire page of images the way flipping a sheet of film does. The
three planes keep separate runs: scrolling the axial panes leaves the coronal
and sagittal ones where they are, and the crosshairs on every other pane
follow along.

The **Stack** buttons in the toolbar set the spacing: *Same*, or 1, 2, 5 or
10 slices apart. The Panes panel says how many slices the current grid covers
at a time.

The 📌 button pins a pane to the slice it is on. A pinned pane ignores
scrolling, so you can hold a reference level while the rest of the grid moves
past it; unpinning drops it back into the run where it stands. Each pane's
slice counter shows its offset (`+3`) or `pinned`.

Small panes drop the patient banner and orientation letters rather than
covering the image with text.

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
- **Volume Rendering** with clinical transfer-function presets and
  gradient-based shading. For CT: **Bone VRT** (opaque above cortical
  density), **Angiographic VRT** (tuned for arterial-phase contrast at
  250–450 HU, with bone pushed back as a pale backdrop), **Muscle VRT** (the
  narrow 30–80 HU band, separated from the fat it is wrapped in), plus Soft
  Tissue, Lung and Skin. For MR, presets expressed as fractions of the
  volume's own range, since MR signal has no absolute scale.
- **3D MIP** through the whole volume.
- Adjustable opacity; drag to rotate, wheel to zoom.

### Hounsfield Units and measurements

- **Live HU readout** — the value of the pixel under the cursor, shown in the
  status bar with its plane, slice and pixel coordinates. Toggle it with the
  **HU** button. It reads the plane's own samples, so window/level and invert
  cannot change it.

  It also says what the number *is*. On a thin slice that is the voxel's own
  value, labelled `HU`. Once the slab is thicker than one voxel the sample is
  a projection along the slab, so it reads `HU (MIP)`, `(MinIP)` or `(Avg)` —
  a 10 mm MIP can sit a few tens of HU above the centre slice, and calling
  that "the HU" would overstate it. With bone cut on it adds `(bone cut)`,
  since masked voxels read as air.
- **HU probe** (`⌖`) — one click pins a marker recording the value of that
  single pixel. It reads one pixel rather than interpolating, because an
  interpolated "HU" is a number the scanner never measured.
- **Distance**, **angle**, **elliptical ROI** and **rectangular ROI**. Both
  ROIs report mean ± SD, min, max, area and pixel count.
- Statistics are computed from the **pixel values of the plane**, never from
  the displayed image — changing window/level or invert cannot change a
  reported number.
- Units are only claimed when the metadata supports them: with Pixel Spacing
  present you get millimetres, without it you get pixels and an explicit
  *uncalibrated* note. Intensities are labelled **HU** only for CT (or an
  explicit `RescaleType` of HU); otherwise they are reported as stored values.
- Measurements are stored in plane coordinates, so they stay anchored to the
  anatomy through zoom, pan, rotation and flipping.

### Data inspection

- **Study → Series hierarchy**, keyed on Study Instance UID.
- **Searchable DICOM tag browser** — free-text search across every element in
  the dataset, by keyword, value, or tag number such as `0028,1053`.
- **Geometry validation** before reconstruction: irregular slice spacing,
  changing Image Orientation, tilted/non-axial acquisitions, missing slice
  positions and excluded mismatched slices are all reported rather than
  silently reformatted.
- **PNG export** of the active pane, with the overlays as displayed.
- Duplicate instances (same SOP Instance UID) are ignored on re-import and
  reported.

### Reset options

The **Reset ▾** menu resets one kind of state at a time, because a single
button that throws everything away is too blunt — losing a set of
measurements because the zoom needed straightening is a real cost.

| Option | What it restores |
| --- | --- |
| Reset view | Zoom, pan, rotation, flip, and the 3D camera |
| Reset window/level | The study's own Window Width/Center from the DICOM header, clearing invert and any per-pane windows |
| Straighten planes | Removes any oblique tilt |
| Reset panes | Rebuilds the current layout's panes, dropping per-pane windows, pins and stack offsets |
| Clear measurements | Removes every marker and ROI |
| Reset everything | All of the above; the study stays loaded |

## Relationship to the base plan

This build follows the phased plan in
`RadiAnt_DICOM_Viewer_Base_Plan.md`, adapted for a browser target and
educational use:

| Plan phase | Status here |
| --- | --- |
| Phase 1 — Import and display | Done: import, Study/Series grouping, real pixel decoding, thumbnails, navigation, window/level, zoom, pan, rotate, flip, invert, reset |
| Phase 2 — Measurements and comparison | Done: HU probe, distance, angle, elliptical and rectangular ROI with statistics; live HU readout; searchable tag panel; PNG export; multi-pane layouts with per-pane window, plane and slice, which covers side-by-side comparison **within** a series. **Not done:** comparing two different series at once, persistent archive |
| Phase 3 — Reconstruction | Done: orthogonal **and oblique** MPR with linked crosshairs, slab projections (Average/MIP/MinIP), volume rendering. **Not done:** curved-planar reformat |
| Phase 4 — PACS | Not applicable to a browser build with no network access by design |
| Phase 5 — Advanced workflows | Not started: fusion, PET/SUV, time-intensity curves, DSA, STL export |

The plan's §7 image-correctness requirements are implemented as follows:
pixel representation / bit depth / photometric interpretation and the
modality-rescale pipeline are handled explicitly; statistics come from pixel
values rather than the rendered image; spatial ordering uses Image Position
(Patient) ahead of instance number; physical units require calibration
metadata; orientation markers and measurements survive view transforms; and
incompatible geometry is detected and explained before reconstruction.

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
**📁 Folder** at that folder, or drag the whole folder onto the window.

MPR and 3D need a **stack** — a single image can be viewed but not
reconstructed.

## What it does and doesn't support

- **Reads, uncompressed:** Implicit VR Little Endian, Explicit VR Little
  Endian, Explicit VR Big Endian.
- **Decodes, compressed:** **RLE Lossless** (`…1.2.5`) and **JPEG Lossless**,
  both the plain and first-order-prediction forms (`…1.2.4.57`, `…1.2.4.70`).
  These are the schemes most scanners and PACS use for archived CT. Both are
  mathematically lossless, so the Hounsfield Units are exactly the scanner's —
  see the verification table below.
- **Does not decode:** lossy JPEG, JPEG-LS, JPEG 2000, and the deflated and
  video syntaxes. A file using one of these is **named** in the error, with
  the conversion command to run (`dcmdjpeg`, `gdcmconv --raw`, `dcm2niix`),
  rather than failing as a generic "unsupported".
- Reslicing covers the three orthogonal planes and **arbitrary oblique**
  planes. **Curved-planar** reformats (following a vessel centreline) are not
  implemented.
- Measurements are anchored to the cut they were drawn on, so tilting a plane
  hides them rather than redrawing them over different anatomy.
- Assumes an axial acquisition with consistent orientation; gantry tilt and
  per-slice orientation changes are not corrected for.
- Large series are downsampled in-plane to keep the volume within a memory
  budget; the Volume panel reports when that happens.
- No measurement, annotation or segmentation-editing tools.

## Keyboard

| Key | Action |
| --- | --- |
| `↑` `↓` / `←` `→` | Previous / next slice — moves the whole stack |
| `Page Up` / `Page Down` | Jump 10 slices |
| `1` … `6` | Layout: 2×2 · 1×1 · MPR · 3D · 1×2 · 2×3 |
| `I` | Invert grayscale |
| `R` | Reset the view (zoom, pan, rotation, flip) |

Mouse: left-drag = window/level (right widens · down darkens) · wheel = change slice · Shift+wheel = zoom ·
right-drag = pan · Shift+click = move crosshair · **Alt+drag = tilt the other
two planes (oblique MPR)** · double-click = expand a pane and back.

## Project structure

```
dicom-viewer/
  index.html                    # Workstation layout
  css/styles.css                # Dark radiology-console theme
  js/app.js                     # Parsing, UI, pane grid, MPR viewports, interaction
  js/codecs.js                  # RLE and JPEG Lossless pixel decoders
  js/volume.js                  # Volume build, orthogonal + oblique reslicing, slab/MIP, bone mask
  js/measure.js                 # Distance / angle / ROI math and calibration
  js/vr.js                      # WebGL2 raymarching volume renderer
  js/vendor/dicomParser.min.js  # Third-party DICOM parser (MIT license)
```

`volume.js` and `measure.js` are pure computation over typed arrays with no
DOM dependency, so the reconstruction and measurement math can be exercised
headlessly.

### Verified against known values

The measurement and reconstruction math is checked against a synthetic
phantom of known geometry (a 20 px-radius disc at exactly 200 HU, 0.5 mm
in-plane, 2 mm slices):

| Quantity | Expected | Measured |
| --- | --- | --- |
| Distance across the disc | 20.000 mm | 20.000 mm |
| Right angle | 90.00° | 90.00° |
| ROI mean / SD | 200.00 / 0.00 HU | 200.00 / 0.00 HU |
| ROI area | 78.54 mm² | 78.54 mm² |
| ROI after changing window | unchanged | unchanged |
| Rectangular ROI, 10×10 px at 1 mm | 100 mm², 100 px | 100.000000 mm², 100 px |
| Inscribed ellipse vs. that rectangle | π/4 = 78.5% of the area | 78.5% |
| HU readout over known −1000 / 300 / 900 HU regions | those values | −1000 / 299 / 900 |
| HU readout after re-windowing and inverting | unchanged | unchanged |
| Plane↔canvas round-trip (all rotations/flips) | 0 px | < 1e-14 px |

Oblique reslicing is checked two ways. Against the orthogonal reslicer, an
oblique cut taken at identity orientation must reproduce it exactly, and a 90°
tilt of the axial frame must land on the coronal plane:

| Quantity | Expected | Measured |
| --- | --- | --- |
| Oblique at identity vs. axial / coronal / sagittal | identical | 0 difference |
| Axial frame tilted 90° about +X vs. coronal | identical | 0 difference |
| Average / MIP / MinIP slab vs. orthogonal slab | identical | 0 difference |
| Trilinear sample of a linear field | closed form | rel. err < 5e-8 |
| Frame orthonormality after 2000 rotations | exact | dev. < 3e-16 |

Against physical geometry, a second phantom holds a 36 mm cylinder tilted 30°
out of the axial plane. An orthogonal axial cut must see a stretched ellipse;
a plane tilted to match it must see the true circle:

| Quantity | Expected | Measured |
| --- | --- | --- |
| Orthogonal axial cross-section | 1175 mm² (ellipse) | 1178 mm² |
| Cross-section after a 30° tilt | 1018 mm² (circle) | 997 mm² |
| Diameter across / along the tilt, orthogonal | 36 / 41.6 mm | 36 / 41 mm |
| Diameter across / along the tilt, corrected | 36 / 36 mm | 36 / 35 mm |
| Reported tilt of each companion plane | 30.00° | 30.00° |
| Crosshair mm → slice indices → mm | round-trips | exact |

### Compressed pixel data

The decoders are checked two ways. Each JPEG Lossless fixture is decoded by
[pylibjpeg-libjpeg](https://github.com/pydicom/pylibjpeg-libjpeg) — an
independent C implementation — before being used, so the JavaScript decoder
is only ever compared against a bitstream a third party already agrees on.
RLE fixtures come from pydicom's own encoder.

| Quantity | Expected | Measured |
| --- | --- | --- |
| 13 codec fixtures (8/12/16-bit, signed, 1×N and N×1 shapes) | every sample exact | 0 differences |
| Same CT series as uncompressed vs. RLE | identical volume | identical, voxel for voxel |
| Same CT series as uncompressed vs. JPEG Lossless | identical volume | identical, voxel for voxel |
| ROI over a 300 HU lesion (σ=8 noise), decoded from JPEG | 300 HU | 299.1 ± 8.7 HU |
| Corrupt or truncated streams | reported | raised, never silently wrong |

## Privacy

All parsing, reconstruction and rendering happens locally in your browser. No
image data, metadata, or files are sent to any server — this page makes no
network requests once loaded.

## Credits

Built on [`dicom-parser`](https://github.com/cornerstonejs/dicomParser)
(MIT License) by Chris Hafey / the Cornerstone.js project, vendored in
`js/vendor/` — see `js/vendor/LICENSE-dicom-parser.txt`.
