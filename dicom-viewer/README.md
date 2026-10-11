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

- **📂 Open ▾** — load one or many `.dcm` files at once, or a whole
  directory (drag-and-drop onto the window also works, including folders).
- **Automatic series grouping** — instances are grouped by Series Instance
  UID and sorted by slice position / instance number.
- **Window/Level** — left-drag on any plane: **right** widens the window,
  **left** narrows it, **down** darkens and **up** brightens. There is also
  manual numeric entry and presets under **◐ Window ▾**: Lung, Bone, Brain,
  Soft Tissue, Abdomen, Mediastinum, Angio. Each image's Rescale Slope/Intercept is
  applied, so values are windowed in real Hounsfield Units.

  The drag is **scale-invariant**: the width moves multiplicatively (160 px
  doubles or halves it, wherever you start) and the level steps in proportion
  to the current width (250 px shifts it by one whole window). A fixed step
  per pixel cannot serve both ends of CT — the same step that is barely
  visible on a lung window (W1500) throws a brain window (W80) past its own
  width in a twitch — so the gesture feels identical on every preset, and the
  width cannot be slammed to zero by one long drag.
- **Invert, zoom, pan**, and a per-pane slice scrubber.
- **The crosshair is a tool you drag.** Press **✛** (or `X`) and drag
  anywhere in any pane: the `+` follows the cursor, and every plane, every
  pane and every linked sequence moves with it. Put it on a finding and the
  whole screen is showing that finding.

  With the tool off, the crosshair still carries a grip at its intersection
  that can be grabbed under **✥ Navigate**, and `Shift`+drag works from
  anywhere. Only the grip grabs, and it is drawn at exactly the size it is
  hit-tested at. Accepting the *arms* was tried and is wrong: they run the
  full width and height of the pane, which turns a cross-shaped band through
  the middle of the image into a region where a window/level drag silently
  moves the crosshair instead, and where a measurement handle under an arm
  cannot be picked up at all.

  Whether the lines are drawn at all is a display preference, under
  **⋯ More → Crosshair lines**.
- **Rotation** — 90° steps either way, or **free rotate** (`◷`): arm it and
  drag on a pane to turn it to any angle.

### The series browser

One card per series, not one tile per slice. A chest CT is three hundred
images; a grid of three hundred near-identical tiles is a wall, not a
browser, and it says nothing about which of the four reconstructions in
front of you is the 1 mm lung kernel.

Each card carries what a reader actually picks a series by:

```
┌──────┐  CT · 2
│      │  AX PORTAL VENOUS
│ thumb│  2 mm · 312 img
└──────┘  B30f · ABDOMEN
          ⌄ 312 images
```

modality and series number, description, slice thickness and image count,
and — when the file states them — the convolution kernel, contrast agent and
body part. The thumbnail is the **middle** slice: the first image of a chest
CT is air above the lungs and the last is the table, and neither tells you
what the series is.

The per-slice strip is still there behind `⌄ N images`, built only when it is
opened, so a 300-slice series costs 300 decodes only if you asked for them.

**Drag a card onto any pane** to show that series there. The pane highlights
while the series is over it, so the highlight answers "will it land here"
rather than decorating.

Contrast *phase* is deliberately not shown. "Arterial" and "portal venous"
are almost never in a tag; reading them out of the series description would
be re-displaying the description one line lower while making it look as
though the viewer had determined something.

A localizer is almost always series 1 and almost never what you want to
read, so opening a study opens the longest non-localizer series instead.

### Comparing an old scan with a new one

Press **⇄ Compare** (or `C`) with a study open. The most recent other study
for **the same patient** opens in the pane beside it, both panes on the same
plane, with slice position linked. Right-click the button to pick a
different one — the menu lists that patient's studies with their dates,
because the prior you want is not always the most recent.

#### What "linked" means — three switches, not one

**🔗 Sync ▾** holds three independent toggles, because they answer different
questions. They apply only to panes bound to a *different* series; panes
showing the current series always share the toolbar's window.

| Link | Default | Why |
| --- | --- | --- |
| **Slice position** | **on** | Matched in patient millimetres, never by slice number. This is the one that is nearly always wanted |
| **Zoom and pan** | off | Useful for a side-by-side at identical magnification; in the way when the two studies are framed differently |
| **Window / level** | **off** | A lung window beside a soft-tissue window is often the point of putting two panes up |

Window/level defaulting to *off* matters more than it sounds. A prior chest
CT stored at W1500/L−600 rendered with the current abdomen's W400/L40 is a
white rectangle. Unlinked, a comparison pane uses **its own series' Window
Width/Center from its header**; linked, it follows the toolbar. The button
reads `Sync 1/3`, so how much is linked is on the toolbar rather than behind
a menu.

What it works out for you, and what it refuses to guess:

- **Same patient, by Patient ID.** Two studies are only ever offered
  together when they share a Patient ID, or a patient name when neither has
  an ID. Putting another patient's scan beside the current study is the
  worst thing this could do, so the test fixture deliberately contains a
  second patient imaged on the same dates and asserts they are never
  offered.
- **The diagnostic series, not the scout.** Same modality first, then the
  closest series description, then the longest stack. A three-slice
  localiser would open without complaint and show nothing.
- **Lined up by position, not slice number.** The two studies rarely share a
  slice thickness or a starting level; scrolling either pane moves both to
  the same place in the patient.
- **Each pane shows its own study date**, and the bound pane says what it
  actually is — `[prior]`, `[later study]`, `[same study]`, or
  `[other study]` when a date is missing and "earlier" is not knowable. It
  will not call a study prior on the strength of it merely being the other
  one: on a follow-up, a wrong label invites reading the growth backwards.

With the two open, press **🎯** and click the finding to put both panes on
it, or **✛** and drag the crosshair there.

### Reading MR: sections as the layout

An MR study is a set of sequences, each a stack of thick slices in one plane
— not one isotropic volume. Reformatting a 4 mm sagittal T2 into a coronal
image is possible and diagnostically useless, so MR gets a layout of its own.

**Seq** gives every pane a different *sequence*, each shown in the plane it
was actually acquired in. The acquisition plane is read from Image
Orientation (Patient) rather than from the series description, so a
mislabelled series is still laid out correctly. Volumes are reconstructed on
demand, one at a time, with progress shown.

Any pane showing a plane other than the one its series was acquired in says
so — *"reformatted from sagittal"* — because on a thick stack that is the
difference between a diagnostic image and a smear, and the pixels alone do
not admit it.

With **🔗 Sync** on, moving the crosshair in any sequence moves all of them
to the same place in the patient. That mapping goes through patient
coordinates, so it is exact between any pair of orientations: put the `+` on
a lesion in the axial T2 and the sagittal T1, the sagittal T2 and the coronal
STIR all jump to the slice containing it.

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

### Segmentation: a threshold mask and a brush

Two reversible ways to take tissue out of the reconstruction. Neither
touches the stored DICOM pixels.

**Threshold mask.** Everything denser than an adjustable Hounsfield value is
hidden, in the MPR planes and in 3D, with a 3D dilation so the cortical rim
and partial-volume halo go too rather than leaving a bright shell.

It is deliberately **not** called bone removal. It makes no anatomical
judgement: at 200 HU it takes opacified vessels, metal and coarse
calcification along with the cortex, and a reader told "bone" would not
expect that. Above about 350 HU opacified vessels are kept. The panel and
the HU readout both say *threshold mask*, and the readout appends
`(threshold mask)` while it is on so a hidden voxel is never read as absent
tissue.

**Sculpt.** A spherical brush in millimetres, dragged on any plane. Every
stroke is undoable and *Restore all* puts the whole volume back.

Both live under **⋯ More → Segmentation / Sculpt**, not under Measure:
sculpting is editing, and putting an eraser in the measurement menu invites
exactly the confusion of thinking it measured something.

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
- **Cropping along three anatomical axes.** Each axis has a pair of handles
  that cut the volume from one side and the other independently — enough to
  take the front off a skull, keep a single slab, or open a window into the
  middle of the body. The sliders are labelled by the cut they make
  (*Sagittal*, *Coronal*, *Axial*) rather than by axis number, derived from
  the series' own `Image Orientation (Patient)`; a series tilted more than
  about 25° off an anatomical axis is marked `≈`, and one that gives no
  orientation at all falls back to `Axis 1/2/3` rather than guessing.
  **Reset crop** sits beside the sliders and in the **Reset ▾** menu.

  Cropping hides voxels from the 3D render. It does not alter the stored
  pixel data, the 2D planes, or any measurement — which the tests check by
  hashing the axial plane before and after.

### Viewport overlays

Four corners, laid out the way a reading workstation lays them out, because
that is where the eye already goes:

| Corner | What it holds |
| --- | --- |
| Top left | Patient name · ID · age and sex · study date |
| Top right | Series description and number · image N / total · slice thickness · any oblique angle, reformat note or sync warning |
| Bottom left | WW/WL · zoom % · **the live tool** · bone cut when it is on |
| Bottom right | Modality and body part · convolution kernel · kVp and mA · contrast agent |

Plus **R / L / A / P / H / F** orientation letters, derived from Image
Orientation (Patient) and suppressed when no single letter is honest.

#### The scale bar

Along the bottom of every 2D pane, a bar of known length — the longest round
number of millimetres (1, 2, 5, 10, 20 …) that fits in a third of the pane,
with its length written above it. How big something is on screen is the one
judgement a reader makes without measuring, and zoom destroys it: a 4 mm
nodule filling a quarter of the pane reads as a mass. The bar puts that
judgement back.

It is drawn only when the millimetre is real. No Pixel Spacing, or slice
spacing that cannot be trusted on a cut that samples across slices, and
there is **no bar at all** — the same rule the measurements follow. A bar
labelled `50 mm` that is not 50 mm would be held up against the screen and
believed, which makes it worse than nothing.

Rotating or flipping a pane turns the image, not the ruler, so the bar does
not change; zooming in shortens it. `browser-info.js` checks the bar against
the viewer's own distance tool rather than against the arithmetic that drew
it: with a 20 mm bar on screen, measuring from one end of it to the other
reads 20.0 mm. It also scans the overlay canvas to confirm the bar drawn is
as long as the bar computed, since a correct number drawn wrongly is still
wrong.

Every string in the corners is a header value or a number this viewer
computed, and all of it goes through `textContent` rather than `innerHTML` —
a file with markup in its `PatientName` shows the markup instead of running
it. See **Privacy and security**.

The bottom-left corner naming the live tool matters more than it looks: a
pane that says *Window/Level* while Pan is armed is worse than one that says
nothing, so the corners refresh when a tool is armed, not only when the
image is redrawn.

### Hounsfield Units and measurements

- **Live HU readout** — the value of the pixel under the cursor, shown in the
  status bar with its plane, slice and pixel coordinates. Toggle it under
  **⋯ More**. It reads the plane's own samples, so window/level and invert
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
- **Measurements** — distance, polyline (summed segments), angle, and **Cobb
  angle** between two independently drawn lines. A line has no direction, so
  the Cobb result is folded into 0–90°: drawing an endplate backwards cannot
  turn a 20° curve into a 160° one.
- **Regions of interest** — circle (centre, then edge), ellipse, rectangle,
  polygon and freehand. Each reports mean ± SD, min, max, area, perimeter and
  pixel count.

  Every ROI counts a pixel when its **centre** falls inside the shape. One
  rule, deliberately: mixing conventions meant a rectangle and a polygon
  drawn over the same square enclosed 1681 and 1600 pixels and reported
  different means — a discrepancy small enough never to look wrong.

  A circle is circular in **millimetres**, so on a plane with anisotropic
  pixels it is drawn as an ellipse — the only way its radius can mean one
  number.
- **Annotations** — arrow, typed caption and freehand drawing. They carry
  text rather than a number and are listed as annotations, never as
  measurements that happen to have measured nothing.
- **ROI histogram** — the distribution of the values inside the selected ROI,
  over exactly the pixels its mean came from, with the mean marked. The bin
  range is the ROI's own min–max; a fixed −1024…3071 axis would render most
  soft-tissue ROIs as a single spike.
- **Editing** — with **✥ Navigate** active, drag any handle to reshape a
  measurement or its centre grip to move it; statistics recalculate as you
  go. Handles are deliberately inert while a drawing tool is selected, so a
  click meant to place a point can never silently drag someone else's ROI.
- **Hiding is not deleting** — the eye beside each row hides one marker,
  **⋯ More** hides them all, and both leave the measurement intact.
- **Undo and redo** — `Ctrl`/`⌘`+`Z` and `Ctrl`/`⌘`+`Shift`+`Z`, with buttons
  in the Measurements panel and at the top of the **📏 Measure** menu. It
  covers drawing, moving, reshaping, retyping, hiding, deleting and *Delete
  all*, and each step is named for what it will undo ("reshaping Distance",
  "clearing 2 measurements").

  The unit of history is the whole annotation list, snapshotted, so undoing a
  mis-drag restores the measurement's **numbers** and not merely its shape —
  a calliper that comes back 3 mm short would be worse than no undo at all.
  Sixty steps are kept. A grab that moves nothing records no step. Opening a
  series clears the history, so an undo can never delete work that was just
  restored from storage, or resurrect one patient's ROI over another's.
  Sculpting is separate: it edits voxels, and has its own stroke-level undo.
- **Persistence** — measurements are saved per *series* in this browser and
  come back when the series is reopened. Per series, not per study: an ROI
  drawn on the arterial phase means nothing on the venous one.
- Statistics are computed from the **pixel values of the plane**, never from
  the displayed image — changing window/level or invert cannot change a
  reported number.
- Units are only claimed when the metadata supports them: with Pixel Spacing
  present you get millimetres, without it you get pixels and an explicit
  *uncalibrated* note. Intensities are labelled **HU** only for CT (or an
  explicit `RescaleType` of HU); otherwise they are reported as stored values.
- Measurements are stored in plane coordinates, so they stay anchored to the
  anatomy through zoom, pan, rotation and flipping — and carry the series
  they were drawn on, so with two studies open an ROI from one is never
  redrawn over the other patient at the same slice number.

### Focus point

One anatomical point that every pane is made to show. Press **🎯** (or `F`)
and click a finding: all three planes move to the cut that contains it, every
other loaded series is pulled to the same place in the patient, and each pane
pans so the point sits in the middle. Press `G`, or **⋯ More → Go to the
focus point**, to bring everything back to it after scrolling away.

A solid pink ring marks the point on panes whose cut contains it. A dashed
ring says how far off the cut it is and which way to scroll — a pane that
simply is not showing the finding, with nothing to say so, is the thing worth
avoiding.

Across series it works in **patient millimetres**, from Image Position and
Image Orientation (Patient), so a prior with different slice thickness, a
different matrix and a different start position still lands on the same
anatomy. Two conditions are stated rather than assumed:

- Series acquired in a **different orientation** are matched by slice level
  only, and the panel says so.
- Snapping to the nearest slice always succeeds, even when the other series
  does not reach that level at all. When the nearest slice is more than a
  millimetre away the panel reports the gap — *"nearest slice is 7.0 mm away
  — outside this series"* — instead of calling it a match.

### Data inspection

- **Study → Series hierarchy**, keyed on Study Instance UID.
- **Searchable DICOM tag browser** — free-text search across every element in
  the dataset, by keyword, value, or tag number such as `0028,1053`, grouped
  into Patient, Study, Series, Technique, Image, Pixel Data and Derived.
- **Geometry validation** before reconstruction: irregular slice spacing,
  changing Image Orientation, tilted/non-axial acquisitions, missing slice
  positions and excluded mismatched slices are all reported rather than
  silently reformatted.
- **PNG export** of the active pane, with the overlays as displayed.
- Duplicate instances (same SOP Instance UID) are ignored on re-import and
  reported.

#### The Study panel

**⋯ More → Patient and study** opens a fixed summary beside the images: the patient
(name, ID, age and sex), the study (description, date, accession number,
institution, referring physician) and the equipment (manufacturer and model,
station, protocol, patient position). It is the same rows in the same order
on every study, so confirming that the images on screen belong to the patient
you are reporting is a glance rather than a search.

One line is not a header value: **Contents** counts the series and images of
this study that are actually loaded — `2 series · 77 images loaded`. It says
*loaded* because that is what it knows. A folder opened halfway, or one series
dragged in out of several, reads as exactly that; nothing here claims to know
what the study contains on the scanner.

Every row is dropped when the tag is absent rather than filled in. There is no
birth date row on a file that carries only an age, and no acquisition phase
anywhere: the viewer cannot know whether a series is arterial or venous, and a
guess in that row would be read as fact.

#### Technique

The tag browser's **Technique** section carries the acquisition parameters,
and it is one section for both modalities. On a CT it fills with the
convolution kernel, kVp, tube current, exposure, CTDIvol, gantry tilt and
reconstruction diameter; on an MR with TR, TE, TI, flip angle, field strength,
echo train length, scanning sequence, sequence variant, scan options and
acquisition type.

The viewer is never told the modality for this. It lists every row and drops
the ones the file does not carry, so a CT shows no empty `Echo Time (TE)` —
which would read as "no TE", not as "not applicable" — and a sequence the
scanner wrote parameters into shows them whatever `Modality` says.
`test/browser-info.js` checks both directions: that the CT fixture shows the
kernel and kVp and no MR row, and that the MR fixture shows TR, TE and field
strength and no CT row.

### Scout / localizer navigation

When a study carries a localizer — a series whose `ImageType` says
`LOCALIZER`, not one this viewer guessed at — the Tools panel shows it with
a line marking the level the active pane is on, and clicking it jumps there.

Both are computed in **patient coordinates**, from Image Position (Patient)
and Image Orientation (Patient), so a scout acquired at any angle works. The
cut is the plane `(P − c)·n = 0`; a scout pixel is `o + r·u·sx + c·v·sy`;
substituting gives one linear equation in `u` and `v`, solved for whichever
of the two the plane is less parallel to so it never blows up.

The test fixture is a **coronal** localizer, deliberately: an axial cut must
appear on it as a *horizontal* line at row `(0 − z) / 1 mm`. A viewer that
ignored Image Orientation and assumed the localizer was axial would draw a
vertical one and still pass a test that only asked whether a line appeared.

A level outside the series is refused with a message rather than silently
clamped to the nearest slice, and a scout that states no position is shown
with no line rather than a line in the wrong place.

Three things it refuses to guess at:

- **A scout lying in the same plane as the cut** — a coronal localizer
  against a coronal pane — carries no information about where along that
  axis you pressed: every point on it has the same coordinate. The panel
  says so and the click is refused, rather than returning the one fixed
  slice the arithmetic would otherwise produce wherever you pressed.
- **The localizer belongs to the pane being navigated**, not to whichever
  series happens to be "current". With two studies open those differ, and
  taking it from the current series put one patient's scout beside another
  patient's slice position and offered a click to jump there. Patient
  coordinates mean nothing across two patients.
- It must share the pane's **Frame of Reference** where both state one,
  since that is what makes two images' coordinates comparable at all.

### The Tools panel follows the tool

Window/level, slab thickness, bone cut, 3D rendering, the scout, cine, the
focus point, oblique MPR, the measurement list, the histogram, the volume
report and the tag browser all on screen at once make the panel a list to
search rather than a set of controls to reach for.

Each section declares which contexts it belongs to, and the panel shows the
ones matching the armed tool:

| Armed | Panel reads | and shows |
| --- | --- | --- |
| Navigate | *Reading* | Window/Level, and the scout when the study has one |
| A measurement tool | *Measuring* | Window/Level, focus point, measurements, ROI histogram |
| Crosshair | *Planes & MPR* | Reconstruction slab, panes, focus point, oblique MPR, volume |
| Pan · Zoom · Scroll | *Navigating* | Window/Level, panes, cine |
| Sculpt, or the 3D layout | *Segmentation & 3D* | Threshold mask, sculpt, 3D rendering, volume |

The headings name the **mode**, not a section, so the panel title does not
simply repeat the one heading under it.

A section with nothing to show is not shown at all, even under "Show all" —
there is no point revealing a Scout heading over a blank canvas for a study
that has no localizer. Availability and context are separate questions, and
both have to agree before a section appears.

**Hiding is never losing.** A section holding something that is switched on
— a slab, a bone cut, an open crop, measurements on screen, cine running, an
oblique tilt — stays visible whatever the context, because the one control
that must never be hidden is the one silently doing something. **Show all**
pins the whole panel, and the tag browser has its own route under
**⋯ More → DICOM tags**.

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
| Clear focus point | Stops pulling the panes to one place |
| Reset 3D crop | Brings back the whole volume in the 3D pane |
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

## The empty viewport

With nothing open the image area leads with **📁 Open DICOM folder** and
**📂 Open files…** as buttons, names the formats that decode here, and says
a folder can be dragged onto the window. A blank grid carrying an
instruction is a dead end on a first run; the action belongs where the eye
already is.

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
| `N` / `W` | Navigate — a plain left-drag is window/level |
| `M` | Measure a distance |
| `A` | Measure an angle |
| `R` | Draw an elliptical ROI |
| `F` | Expand the active pane, and back |
| `G` | Go to a slice number |
| `Space` | Play or pause cine |
| `X` | Arm the crosshair tool — drag anywhere to move the + |
| `C` | Open this patient's prior beside the current study |
| `Shift`+`F` | Arm the focus point |
| `Shift`+`G` | Go to the focus point |
| `Enter` | Finish a polygon or polyline |
| `Esc` | Abandon the shape being drawn, or close a menu |
| `Delete` | Delete the selected measurement |
| `Shift`+drag | Move the crosshair from anywhere in the pane |
| `P` | Pan — drag to move the image |
| `Z` | Zoom — drag up to zoom in |
| `S` | Scroll — drag to page through the stack |
| `Shift`+`R` | Reset the view (zoom, pan, rotation, flip) |
| `Ctrl`/`⌘`+`Z` | Undo the last annotation change |
| `Ctrl`/`⌘`+`Shift`+`Z`, `Ctrl`+`Y` | Redo it |
| `?` | Show the shortcut list |

Press `?` for that table inside the viewer. It is generated from the same
list the key handler dispatches from, so a shortcut cannot be documented
without being bound, or rebound without the list following it. Keys do
nothing while the cursor is in a text box, and every other `Ctrl`/`⌘`
chord is left to the browser — `Ctrl`+`R` reloads rather than resetting
the view.

Mouse: **left-drag = window/level** (right widens · down darkens) ·
**wheel = change slice** · **right-drag = zoom** · **middle-drag = pan** ·
`Shift`+wheel = zoom · `Ctrl`/`⌘`+drag = pan · `Shift`+click = move crosshair ·
**`Alt`+drag = tilt the other two planes (oblique MPR)** · double-click =
expand a pane and back.

`F`, `G` and `R` follow the convention every workstation uses — expand,
go-to-image and ROI. The three things they displaced moved to the `Shift`
variants: `Shift`+`F` and `Shift`+`G` for the focus point, `Shift`+`R` to
reset the view.

### Zoom, pan and scroll as tools

All three of those were already reachable — `Shift`+wheel, right-drag, the
wheel. That is not the same as having them. A modifier chord is invisible:
nothing on screen says it exists, and on a trackpad or a tablet there may be
no right button and no wheel at all.

So **✋ Pan**, **🔍 Zoom** and **⇅ Scroll** each arm a plain left-drag for
that one thing, exactly like the crosshair and the measurement tools, and
pressing the armed one puts you back in Navigate.

| Tool | A left-drag does | Calibration |
| --- | --- | --- |
| **✋ Pan** | Moves the image inside its pane | 1:1 with the cursor |
| **🔍 Zoom** | Up zooms in, down zooms out | 200 px doubles the zoom; clamped to 0.2×–12× |
| **⇅ Scroll** | Down goes further into the stack | 8 px per slice |

Zoom is exponential rather than linear, so the same travel is the same
factor at every scale — a linear step feels dead when you are zoomed in and
uncontrollable when you are out. All three are seeded from where the drag
began rather than accumulated per mouse event, so a long drag cannot drift
away from the cursor, and a click that moves nothing changes nothing.

Each tool also changes the cursor over the image — a grab hand for Pan, a
vertical resize arrow for Zoom and Scroll — because the armed mode has to be
visible *before* the drag, and the cursor is the only thing on the image
itself that can say so.

They add a way in; they take none away. The wheel, `Shift`+wheel and
right-drag keep doing their jobs whichever tool is armed — which the tests
check, because a new mode that quietly swallows right-drag is the obvious
way for this to go wrong.

**⇕ Stack**, **🔗 Sync** and **⇅ Scroll** are three separate controls doing
three unrelated jobs: how many slices apart repeated panes sit, whether
panes on different series are linked by patient position, and what a
left-drag does. Setting one leaves the other two alone.

## The toolbar

Related controls sit behind one button each, which keeps the bar to a single
row from 1100 px up and leaves the height for the images. Where it will not
fit it wraps rather than scrolling sideways — a button scrolled past the edge
is still in the DOM and still passes a scripted click, but a person cannot
press it, which is how the Tools and Report toggles once went unclickable at
1920 px. `browser-hu.js` asserts the row count and that every control is
hit-testable at seven widths; adding Pan, Zoom and Scroll broke the 1100 px
row and that assertion is what caught it.

| Button | Holds |
| --- | --- |
| **📂 Open ▾** | Open files, open a folder, clear the loaded series |
| **▦ 2×2 ▾** | Every layout: 1×1 · 1×2 · 2×1 · 1×3 · 3×1 · 2×2 · 2×3 · 3×3 · MPR · 3D |
| **Ax · Cor · Sag · Seq · Mix** | Which plane fills the grid, or one sequence per pane — separate buttons, because it is a thing you do while reading |
| **◐ Window ▾** | Window presets for the modality, invert, back to the study's own W/L |
| **✥** / **📏 Measure ▾** | Navigate, undo and redo, and every measurement, ROI and annotation tool |
| **✋ 🔍 ⇅** | Pan · Zoom · Scroll — each arms a plain left-drag for that one thing |
| **✛ 🎯 ▶** | Crosshair tool · focus point · cine |
| **📸** | Screenshot the active pane — to the share sheet on a phone or tablet, to a file elsewhere. **⋯ More** holds send-to-Photos, all-panes, save-as, copy-to-clipboard, attach-to-report and the patient-banner switch |
| **⇄ Compare** | This patient's prior scan, beside the current one. Right-click to choose which |
| **⇕ Stack ▾** / **🔗 Sync ▾** | Slices between repeated panes; and what is linked across panes bound to different series. Two separate controls: they do unrelated jobs |
| **⟳ ▾** | Rotate and flip the active pane |
| **⋯ More ▾** | Value readout, show/hide markers, go to focus, PNG export, patient and study data, the DICOM tags, the shortcut list |
| **⤾ Reset ▾** | The reset options below |

Each button names what it is holding — the layout button reads `▦ 2×2`, the
measure button reads `◯ Ellipse ROI` while that tool is armed — because a
menu that hides the active state makes it the one setting on the toolbar you
cannot read off the toolbar.

Everything that is not needed every minute lives in the **⚙️ Tools** panel
instead: slab thickness, bone cut and the sculpting brush, 3D rendering and
its crop sliders, the scout, cine speed and direction, the focus point,
oblique MPR, the measurement list with undo/redo and the ROI histogram,
volume geometry, the patient-and-study summary and the DICOM tag browser. The
panel shows the sections belonging to the armed tool — see **The Tools panel follows the tool**.

Menus are fixed-position siblings of the toolbar, not children of it, and
their height is clamped to the room actually below the button. Both are
deliberate: a menu inside a scrolling container is clipped while still
looking fine and still passing a scripted click, which is how the Reset menu
was once unreachable by an actual cursor.

## Running the tests

Every claim this README makes is checked in `test/`, in a real browser,
against synthetic data whose right answer is known in advance.

```sh
python3 test/fixtures/make_phantom.py        # and the other make_*.py
(cd dicom-viewer && python3 -m http.server 8412) &
node test/run.js
```

34 suites: four in Node for the arithmetic, twenty-eight in a browser for
the behaviour, and two probes for the chrome. `test/README.md` says what each
fixture pins down and what you need installed. The fixtures are generated,
not committed — a checkout builds them in a minute.

Several bugs in this codebase passed a green suite and were caught only by
looking at what actually came out: a redaction mosaic that left the patient's
name perfectly legible, a hash that sampled one byte in ninety-nine, a menu
that was visible and unclickable. Where that happened, the test file says so.

## Project structure

```
dicom-viewer/
  index.html                    # Workstation layout
  css/styles.css                # Dark radiology-console theme
  js/app.js                     # Parsing, UI, pane grid, MPR viewports, interaction
  js/codecs.js                  # RLE and JPEG Lossless pixel decoders
  js/volume.js                  # Volume build, orthogonal + oblique reslicing, slab/MIP, bone mask
  js/measure.js                 # Distance / angle / ROI math and calibration
  js/report.js                  # Report drafts, key images, storage
  js/templates.js               # CT and MRI report templates
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

## Privacy and security

All parsing, reconstruction and rendering happens locally in your browser. No
image data, metadata, or files are sent to any server — this page makes no
network requests once loaded, and loads nothing from a third-party origin:
every script and stylesheet is served from the same directory as the page,
including the DICOM parser.

`test/browser-security.js` asserts that, rather than taking it on trust. It
checks that the page issues no request after load, that there is no `eval`
or `Function` constructor anywhere in the source, and that no element points
at an off-origin URL.

**Header text is data, not markup.** A DICOM file is an untrusted input:
anyone can write anything into `PatientName`, and a viewer that drops that
string into the page unescaped hands the file's author script execution
against every study you subsequently open in that browser. Every place a
header string reaches the DOM escapes it. `test/fixtures/make_hostile.py`
builds a study whose `PatientName`, `PatientID`, `SeriesDescription`,
`AccessionNumber`, `InstitutionName`, `Manufacturer` and `BodyPartExamined`
carry `<img src=x onerror=…>`, `"><script>…</script>` and
`</span><svg onload=…>` payloads; the suite loads it, opens the worklist,
the tag browser, the series list and a screenshot, and requires that no
markup is parsed, no handler fires — and that the text is still **shown
literally** rather than silently stripped, because a radiologist needs to
see that a file's header is malformed.

**A header string is not a dictionary key.** The viewer keys its series,
volume and cache dictionaries by values taken straight out of the file:
Series Instance UID, Study Instance UID, SOP Instance UID. A plain `{}`
answers truthily for `__proto__`, `constructor` and `toString` whether or not
anything was ever stored under them, so a file naming itself one of those was
read as an *already loaded* series and then used as one — and writing to
`__proto__` on a plain object does not create a key at all, it replaces the
object's prototype. Every map keyed by untrusted text is now built by
`dict()`, which returns an `Object.create(null)` with no prototype to inherit
from or overwrite. `test/fixtures/make_hostile.py` writes six files whose
UIDs are exactly those three names; the suite loads them and requires that
all three series appear, that each opens as itself, and that
`Object.prototype` and `Array.prototype` are untouched afterwards.

**Browser storage is not a trust boundary.** Reports and measurements are
kept in `localStorage`, which anything on this origin can write and which
can be hand-edited or corrupted. A stored key image is read back through a
validator that accepts only a bounded `data:image/(png|jpeg|webp);base64,…`
URL — a value like `x" onerror="…` would otherwise have become script when
it was put into an `<img src>` — and it is escaped again on the way out,
because one of the two being right is not a guarantee. A report holds at
most 24 key images.

A saved measurement is read back the same way. The tool must be one this
build actually has — `toString` is not a tool, however truthily a plain
object answers to it — the plane must be one it can draw on, the slice index
a number or absent, and the points finite; a note is cut to 500 characters.
Anything else is dropped rather than half-restored, because a record whose
`plane` is an object reaches `plane.slice(0, 3)` in the measurement list and
takes the whole panel down with it.

**A file it cannot read says why.** A per-file `catch` that only counted the
failure made a corrupt file and a bug in this viewer look identical from the
outside, which is the wrong way round: the second is the one worth hearing
about. Each refusal now records a reason, and the message groups them —
`Couldn't read any DICOM files from the selection. not a DICOM file (×2); the
file is truncated or corrupt`. A folder of two hundred JPEGs says one thing
rather than two hundred. The reasons are the parser's, translated only where
the cause is unambiguous: a file too short to hold a Part 10 preamble, or one
without the `DICM` prefix, is "not a DICOM file"; a file that runs off the end
mid-element is "truncated or corrupt"; an unsupported transfer syntax is
passed through verbatim because it already names the codec. Anything else is
shown as the parser worded it rather than guessed at, since a confident wrong
explanation is worse than a technical one.

**A failed save is reported, not swallowed.** Storage can be full or
blocked. If a report fails to save, a toast says so and the status line
reads `⚠ NOT SAVING — storage full or blocked` until a save succeeds. It is
the one failure in this viewer that costs work rather than convenience, and
a draft that quietly stops saving while you keep typing is the worst way to
lose it.

## Screenshots

**📸** saves the active pane as a PNG — the pixels as rendered, with the
overlays on top: crosshair, orientation letters, measurements. **⋯ More**
adds *Save all panes* (the whole grid laid out as you see it, with hairlines
between panes so a grid of similar slices does not read as one image),
*Copy this pane to the clipboard*, and *Attach this pane to the report*.

The file is named after the pane it came from — its own plane and its own
series. Both halves, deliberately: taking the plane from the active pane and
the description from whichever series happened to be "current" produced
names like `axial-SAG_T1`, which is worse than no name because it reads as
if it were true.

### Getting it into Photos

On a phone or tablet, **📸** opens the system share sheet — choose **Save
Image** (iOS) or **Save to Photos** (Android) and the screenshot lands in
your photo library. On a desktop browser the same button writes a PNG,
because no desktop browser can hand a file to a share sheet.

A web page **cannot** write to the photo library directly. There is no API
for it on any platform, and there should not be. The share sheet is the only
route, and it is one tap. A plain download does not get there — on iOS it
lands in Files, which is why the camera button used to look as though it had
done nothing useful.

**⋯ More** names both paths explicitly — *Send this pane to Photos…* and
*Save this pane* — so neither is reachable only by guessing what this device
does. The "send to Photos" entries disable themselves, with the reason
shown, on a browser that cannot share files.

Every fallback leaves you with the image and says why in the same message:
*"Too large for the share sheet. Saved …"*, *"Sharing failed. Saved …"*.
Closing the share sheet yourself is not a failure and writes nothing.

### Where the file goes

**⋯ More → Save this pane as…** opens the browser's save dialog so you can
choose the folder, and falls back to a download if the dialog will not open.
The camera button never uses that dialog, deliberately: it can refuse for
reasons that cannot be told apart from the person cancelling it — no
transient activation, an embedding that forbids it — so a button that
sometimes silently produces no file is worse than one that always writes
something.

Nothing is uploaded on any path; the image is composed in the tab and never
leaves it except through the share sheet you choose.

### Patient details in a screenshot

The patient banner is DOM text above the canvas, so by default it is **not**
in the image. **⋯ More → Include patient details** writes a banner of name,
ID, date, modality and series across the foot of the shot — off by default,
because this is the one place the viewer will *add* identity to an image.

The identity that can be in a screenshot without being asked for is **burned
into the pixels**: some scanners write the name, ID and date into the image
data itself. Where the DICOM declares it, in Burned In Annotation
(0028,0301), saving a screenshot warns once per session and points at the
Redact tool. Absence of that tag proves nothing — plenty of equipment burns
text in and never sets it.

### Redact

**📏 Measure → ▬ Redact** covers a rectangle of the image. Two clicks place
it; it behaves like any other annotation — drag its handles, hide it,
delete it, and it is saved with the series.

What it draws is a **mosaic, not a blur**. A Gaussian blur of small text is
partly invertible; averaging a block down to a single value throws the
information away. The cell is sized in *source* pixels rather than screen
pixels, which matters more than it sounds: an earlier version used a fixed
screen-pixel cell, and at 7× zoom one cell covered 1.2 source pixels, so the
averaging changed nothing and the burned-in name stayed perfectly legible in
the saved file. A test now burns real block text into a fixture and checks
every mosaic cell is uniform inside — no detail below the cell survives.

The redaction is drawn **on screen as well as in the screenshot**, so what
gets saved is what you checked.

**None of this is de-identification.** It covers what you tell it to cover
in the one image you are saving. The DICOM files are untouched, the header
is untouched, and a screenshot is still the patient's imaging.

## Report templates

The report panel ships **19 templates**: six skeletons written for this
viewer, and thirteen imported from
[mdvthu/report-templates](https://github.com/mdvthu/report-templates) —
CT pulmonary angiogram (two variants), CT stroke angiogram, and MRI ankle,
cervical spine, elbow, foot, knee, lumbar spine, musculoskeletal pelvis,
shoulder, thoracic spine and wrist.

Those thirteen are **third-party work under the Apache License 2.0**,
© 2024 Mark Thurston and © Thomas Rawet. Their wording is reproduced
unchanged — punctuation, spacing and all, including the source's own
"Perserved" in the thoracic spine template. `NOTICE.md` records the
attribution the licence requires and every change that *was* made (format,
section mapping, and nothing else); a test compares each template word for
word against the source document, so "wording preserved" is checked rather
than asserted.

Inserting a template records its credit, which is printed at the foot of the
exported report.

### Placeholders

Every template states normal findings by default. That is what makes them
quick and what makes them hazardous: a template inserted and signed unread is
a normal report on an abnormal study.

So the bracketed spans their authors left to be filled — `[]`, `[T2|STIR]`,
`[No PE]` — are treated as unfinished work:

- counted and listed in the report panel as you type,
- printed in the exported text under **UNFILLED PLACEHOLDERS**,
- and **Mark final** refuses to sign a report still holding one without an
  explicit confirmation naming what is outstanding.

Inserting a template never finalises anything, and never silently overwrites
text already written.

A report belongs to a study, so with nothing open the picker and the report
actions are **disabled**, and the panel says why. They used to be fully
enabled and simply do nothing when pressed — nineteen templates on offer and
no response to any of them, which reads as a broken viewer rather than a
missing study. The same applies once a report is marked final: the picker is
disabled with "reopen it first" rather than refusing after the click.

### Measurements into the report

**＋ Insert measurements** appends every measurement to *Findings*, each with
its value, plane, slice and series, under a `Measurements:` heading:

```
Measurements:
- Distance — 40.0 mm (axial slice 13, Portal venous 1.0mm)
- Ellipse ROI — 42.1 ± 9.8 HU (coronal slice 96, Portal venous 1.0mm)
```

Appended, never substituted — your own sentences stay where they are.

Only measurements that can be evaluated at that moment are included. A
measurement whose cut no pane is currently showing has no slab to measure
against, and the button says so rather than writing a line with a guessed
number in it. Annotations are left out: an arrow has nothing to report.

## Credits

Built on [`dicom-parser`](https://github.com/cornerstonejs/dicomParser)
(MIT License) by Chris Hafey / the Cornerstone.js project, vendored in
`js/vendor/` — see `js/vendor/LICENSE-dicom-parser.txt`.
