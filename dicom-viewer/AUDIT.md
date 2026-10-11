# CT Console — MedSynapse function cross-check, audited

First audited 23 September 2026 against commit `cd8bbdd`.
Re-audited 29 September 2026: every row whose status changed since then has
been re-checked against the running application and names the suite that
holds it. Rows still carrying their original status were not re-run for this
pass, so treat an unchanged **Missing** as "was missing at `cd8bbdd` and has
not been built since" rather than as a fresh observation.

## How to read this

Every row was checked against the running application, not against the
source or an icon. Statuses mean:

| Status | Meaning |
| --- | --- |
| **Pass** | Behaviour verified in a browser, usually by an automated check in the suite |
| **Partial** | Works for the common case, with a named limitation |
| **Missing** | Not implemented |
| **N/A** | Does not apply to a single-user, local-file, browser-only tool |

The checklist's own caution applies in reverse too: a **Missing** here says
nothing about MedSynapse, and the `U` rows were candidate audit items rather
than established vendor features.

**This is not a medical device and is not validated for diagnosis.**

## Gap summary

Implemented during the first audit: comparison of two studies with linked
scrolling, hand sculpting, cine, the report editor, MR support, the
Angiographic/Bone/Muscle VRT presets, acquisition-dimension splitting, and
the worklist filter.

Closed since, and re-checked for this pass: the full annotation set (arrow,
text, freehand, polygon, polyline, Cobb, circle), measurement editing by
dragging handles, per-series persistence, hide-without-deleting, the ROI
histogram, undo and redo, one-press comparison with a patient's own prior,
the focus point across series, the 3D crop box, the report template library,
inserting measurements into Findings, screenshots with redaction of
burned-in identifiers, and the shortcut list.

Closed in the workstation sprint: the series browser as cards with
drag-to-pane, four-corner overlays, the PACS mouse map (right-drag zoom,
middle-drag pan), scout/localizer navigation, the contextual Tools panel,
the full set of grids, and the measurement and navigation shortcuts.

Closed since the workstation sprint: the Patient-and-study summary panel, the
Technique tag group and the scale bar; and on the security side, prototype-safe
dictionaries for everything keyed by a header value, validation of stored
measurements on the way in, and a stated reason for every file the viewer
refuses.

The largest remaining gaps, in priority order:

1. **P1 — Report output is plain text only.** No rich formatting, no PDF, no
   signature, no amendment or version history.
2. **P2 — No 2D colour map, magnifier, 2D shutter, or fit/1:1 zoom modes.**
3. **P2 — No hanging protocols or saved layouts.**
4. **P2 — No automatic growth or delta table across studies.** Two studies
   can be read side by side with their own measurements, but nothing
   computes the change for you.
5. **P3 — No 3D pan, orientation cube, editable transfer-function curve, or
   surface/mesh rendering.**
6. **P3 — No curved planar reconstruction or vessel analysis.** Asked for,
   and the single largest remaining piece of work: a centreline, a
   straightened vessel, perpendicular cross-sections and diameter/stenosis
   measurement. Not started, and not worth starting half-done — an
   authoritative-looking stenosis percentage from an unvalidated centreline
   is the one output here that could change management while being wrong.
7. **P3 — No lesion tracker or RECIST.** Measurements persist per series and
   two studies can be read side by side, but nothing collects a lesion list
   or computes the change.
8. **P3 — No hanging protocols, saved layouts, or a shortcut editor.**
9. **Out of scope by design** — PACS retrieval, portals, peer review, AI
   detection, fusion, anatomical segmentation, de-identification,
   multi-user workflow.

## 1. Study access, toolbar, and navigation

| ID | Function | Status | Evidence / gap |
| --- | --- | --- | --- |
| NAV-01 | Worklist | Partial | Series panel groups by study with dates. No assignment, priority or reporting-status columns |
| NAV-02 | Search and filters | Pass | Filter box over patient, ID, accession, date, modality, description; every word must match. `browser-worklist.js` |
| NAV-03 | Open local files / folder | Pass | Real DICOM decoded; unreadable files counted and reported; unsupported syntaxes named |
| NAV-04 | Upload / receive studies | N/A | No network by design. Duplicate SOP UIDs are detected and reported on re-import |
| NAV-05 | Series thumbnails | Pass | One card per series: middle-slice thumbnail, modality, series number, description, slice thickness, image count, and kernel/contrast agent/body part when the file states them. The per-slice strip is behind a disclosure and built only when opened, so a 300-slice series costs nothing until asked. `browser-workstation.js` |
| NAV-06 | Drag series into panel | Pass | Drag a card onto any pane; the pane highlights while the series is over it and the others are undisturbed. The per-pane selector remains. A drop naming a series that is not loaded — or an inherited property name — is refused. `browser-workstation.js`, `browser-security.js` |
| NAV-07 | Previous / next image | Pass | **⇅ Scroll** arms a left-drag (8 px per slice), plus wheel, slider, arrow keys and cine. `browser-viewtools.js` |
| NAV-08 | First / last; slice slider | Partial | Slider, Page Up/Down, `G` to jump to a slice number, and the scout for gross navigation. No explicit first/last buttons |
| NAV-09 | Previous / next series | Partial | Click in the series list. No next/previous series control |
| NAV-10 | Cine play / pause | Pass | `browser-sculpt-cine.js` |
| NAV-11 | Cine speed / reverse / loop | Pass | 5/12/25/40 fps, reverse, loop; with loop off it stops on the last slice |
| NAV-12 | Tooltips / active tool | Pass | Every control has a tooltip; active tool and modes are highlighted |
| NAV-13a | Keyboard shortcuts documented | Pass | `?` opens a list generated from the same table the key handler dispatches from, so a key cannot be documented without being bound. `browser-undo.js` presses every listed key and requires it to reach the entry it is listed under |
| NAV-12a | Contextual tool panel | Pass | The Tools panel shows only the sections belonging to the armed tool, with any section that is switched on pinned regardless, a "Show all" escape hatch and a named route to the tag browser. `browser-workstation.js` |
| NAV-13 | Overflow menu | Partial | The toolbar **wraps** rather than scrolling, and tightens at 1760, 1520 and 1240 px; Orient, More and Reset are menus. `browser-hu.js` asserts one row from 1100 px up and that every control is hit-testable at seven widths. No explicit overflow menu |
| NAV-14 | Favourites / pinned tools | Missing | — |
| NAV-15 | Keyboard / mouse bindings | Pass | Shortcuts are ignored while typing in any input, so report typing is unaffected |
| NAV-16 | Reset panel / all panels | Pass | Reset menu resets view, window, planes, panes or measurements separately |
| NAV-17 | Full screen / hide panels | Partial | Series, Tools and Report panels toggle; double-click expands a pane. No browser full-screen |
| NAV-18 | Loading / failure indicators | Pass | Progress during reconstruction; geometry warnings; unsupported codecs named with a conversion command |

## 2. Basic image display tools

| ID | Function | Status | Evidence / gap |
| --- | --- | --- | --- |
| IMG-01 | Window width / level | Pass | Scale-invariant drag; values update live. `browser-wl.js` |
| IMG-02 | Numeric WW/WL | Pass | Width and Level boxes apply and track the drag |
| IMG-03 | Window presets | Pass | Lung, Bone, Brain, Soft, Abdomen, Mediastinum, Angio for CT |
| IMG-04 | Auto window | Pass | Non-CT only: "Auto contrast" from the 2nd–98th percentile. CT uses fixed HU presets by design |
| IMG-05 | Zoom | Pass | **🔍 Zoom** arms a left-drag (200 px doubles it, clamped 0.2×–12×); Shift+wheel still works. Measurements stay anchored through it. `browser-viewtools.js` |
| IMG-06 | Pan | Pass | **✋ Pan** arms a left-drag; right-drag still pans whatever tool is armed. Per pane. `browser-viewtools.js` |
| IMG-07 | Fit to window / 1:1 | **Missing** | Always fits the pane at true physical aspect. No 1:1 pixel mode |
| IMG-08 | Magnifier | **Missing** | — |
| IMG-09 | Rotate cw / ccw | Pass | Orient menu, both directions, plus free rotation. Orientation letters and measurements follow |
| IMG-10 | Horizontal / vertical flip | Pass | Orient menu; letters update, annotations stay attached |
| IMG-11 | Invert grayscale | Pass | Verified not to change HU or ROI statistics |
| IMG-12 | Colour map / LUT | **Missing** for 2D | 3D has transfer functions; 2D is greyscale only |
| IMG-13 | Sharpen / smooth | **Missing** | — |
| IMG-14 | Shutter / crop | Partial | **3D**: a crop box with independent handles on each anatomical axis, named for the cut they make, plus Reset crop. `browser-crop.js`. **No 2D shutter** |
| IMG-15 | Orientation labels / scale | Pass | R/L/A/P/H/F derived from Image Orientation and suppressed when no single letter is honest, plus four-corner overlays carrying patient, series, display and acquisition facts, plus a scale bar on every 2D pane — the longest round number of mm fitting a third of the pane, drawn only when Pixel Spacing (and, on a cut that crosses slices, slice spacing) makes the millimetre real. Checked against the distance tool, not against the formula that drew it. `browser-info.js` |
| IMG-16 | Patient / image overlay toggle | **Missing** | Overlays always shown on large panes, hidden on small ones. Would not anonymise anything regardless |
| IMG-17 | DICOM tags / metadata | Pass | Searchable by keyword, value or tag number; shows the displayed instance. Grouped Patient / Study / Series / Technique / Image / Pixel Data / Derived; the Technique rows cover CT (kernel, kVp, mA, mAs, CTDIvol, tilt, recon diameter) and MR (TR, TE, TI, flip, field strength, ETL, sequence, variant, options, acquisition type), and an absent tag is dropped rather than shown empty. `browser-info.js` |
| IMG-18 | Patient / study summary panel | Pass | **⋯ More → Patient and study**: name, ID, age and sex; description, date, accession, institution, referrer; manufacturer and model, station, protocol, patient position. The contents line counts what is actually loaded (`2 series · 77 images loaded`) and says so. No row is invented — no birth date from an age, no acquisition phase. `browser-info.js` |

## 3. HU, ROI, measurements, and annotations

| ID | Function | Status | Evidence / gap |
| --- | --- | --- | --- |
| MEA-01 | Point HU / pixel probe | Pass | Live readout plus a pinned probe; reads one pixel, never an interpolation |
| MEA-02 | Circle ROI | Pass | Centre then edge; circular in **millimetres**, so on anisotropic pixels it is drawn as an ellipse |
| MEA-03 | Ellipse ROI | Pass | Mean ± SD, min, max, area, count. Verified π/4 of the enclosing rectangle |
| MEA-04 | Rectangle ROI | Pass | 10×10 px at 1 mm = exactly 100.000000 mm², 100 pixels |
| MEA-05 | Polygon / freehand ROI | Pass | Polygon (click each vertex, Enter or click the first to close) and traced freehand ROI. `browser-annot.js` |
| MEA-06 | SD / pixel count | Pass | Population SD over pixel centres inside the shape; count reported |
| MEA-07 | ROI area / perimeter | Partial | Area yes, in mm² when calibrated. **No perimeter** |
| MEA-08 | Distance / ruler | Pass | Computed in physical space, so unequal row/column spacing is handled |
| MEA-09 | Polyline length | Pass | Summed segments, Enter to finish |
| MEA-10 | Angle | Pass | 90.00° on a right-angle phantom; unchanged by zoom, pan and rotation |
| MEA-11 | Cobb angle | Pass | Two lines, four points; the acute angle between them. `measure-unit.js` |
| MEA-12 | Manual calibration | **Missing** | Uncalibrated data is labelled as such rather than allowing an override |
| MEA-13 | Arrow / text annotation | Pass | Arrow and typed caption; listed as annotations, never as measurements that measured nothing |
| MEA-14 | Freehand drawing | Pass | Hold and trace |
| MEA-15 | Edit / move / delete | Pass | With Navigate active, drag any handle to reshape or the centre grip to move; statistics recalculate as you go. Undo and redo cover every change, restoring the measurement's numbers and not merely its shape. `browser-undo.js` |
| MEA-16 | Hide / show / clear | Pass | Per-marker eye, hide-all under More, clear-all — all three distinct from deleting, and all undoable |
| MEA-17 | Measurement list / persistence | Pass | Saved per **series** in this browser and restored when the series is reopened. Per series, not per study: an ROI drawn on the arterial phase means nothing on the venous one |
| MEA-18 | HU histogram | Pass | Distribution over exactly the pixels the ROI's mean came from, binned over the ROI's own min–max, with the mean marked |
| MEA-19 | Measurements on reconstructed images | Pass | Oblique cuts measure in mm and require reliable slice spacing before claiming them |
| MEA-20 | PET SUV / non-CT units | Partial | MR is never labelled HU. **No PET SUV support at all** |

### HU reference checks

| Check | Result |
| --- | --- |
| HU unchanged by window/level, invert, zoom | **Pass** — asserted directly |
| Signed pixels and negative values | **Pass** — signed RLE fixture decodes exactly; −1000 HU formats as `-1000` |
| Pixel padding policy | **Missing** — Pixel Padding Value is not read or excluded from ROIs |
| ROI mean/min/max against independent values | **Pass** — 300 HU lesion with σ=8 reads 299.1 ± 8.7 |
| Screen interpolation does not replace source sampling | **Pass** — statistics come from plane samples, never the canvas |
| MPR/slab values indicate their meaning | **Pass** — a thick slab reads `HU (MIP)`, `(MinIP)` or `(Avg)`; bone cut adds `(bone cut)` |

## 4. Axial, sagittal, coronal, MPR, and projections

| ID | Function | Status | Evidence / gap |
| --- | --- | --- | --- |
| MPR-01 | Open MPR | Pass | Geometry validated before reconstruction; bad geometry is explained |
| MPR-02–04 | Axial / sagittal / coronal | Pass | Rendered at true physical aspect; orientation letters from Image Orientation |
| MPR-05 | Three-plane view | Pass | MPR layout; all three share one crosshair point |
| MPR-06 | Four-panel MPR + 3D | Pass | 2×2 layout, one source volume |
| MPR-07 | Crosshair movement | Pass | Shift+click drives the other planes; solved in millimetres |
| MPR-08 | Reference / localizer lines | Pass | Each crosshair arm is the real intersection line of a companion plane. A study with a `LOCALIZER` series also gets a scout with the current level marked and click-to-jump, solved in patient coordinates so an obliquely acquired scout works. `browser-workstation.js` |
| MPR-09 | Oblique / double-oblique | Pass | Alt+drag; verified a 30° tilt turns a tilted cylinder's ellipse into its true circle |
| MPR-10 | Reset planes / recenter | Pass | "Straighten planes" in the Reset menu |
| MPR-11 | Reconstructed spacing / thickness | Pass | Volume panel reports voxel size and extent in mm; downsampling disclosed |
| MPR-12 | Thick slab | Pass | 0–50 mm, shown in the pane |
| MPR-13–15 | MIP / MinIP / Average | Pass | Verified identical to the orthogonal slab at identity |
| MPR-16 | Curved planar reconstruction | **Missing** | — |
| MPR-17 | MPR cine / slab scrolling | Pass | Cine drives whichever plane the active pane shows |
| MPR-18 | Save / export reconstructed view | Partial | PNG of the active pane with overlays. **Does not stamp that it is a derived plane** |
| MPR-19 | Invalid / incomplete volume | Pass | Irregular spacing, changing orientation, tilted acquisition, missing positions and mismatched matrices all reported |

## 5. Layout and hanging protocols

| ID | Function | Status | Evidence / gap |
| --- | --- | --- | --- |
| LAY-01 | Layout selector | Pass | Toolbar buttons plus keys 1–6 |
| LAY-02 | 1×1 / 1×2 / 2×2 | Pass | Each verified for pane count and grid geometry |
| LAY-03 | Additional grids | Pass | 1×1, 1×2, 2×1, 1×3, 3×1, 2×2, 2×3, 3×3, MPR three-up and 3D. No user-defined splits |
| LAY-04 | Series layout vs image tiling | Pass | Distinct: the plane selector tiles one series, the per-pane series selector shows different series |
| LAY-05 | Maximize / restore | Pass | Double-click a pane and again to return |
| LAY-06 | Reorder / swap viewports | **Missing** | — |
| LAY-07 | Hanging protocols | **Missing** | — |
| LAY-08 | Protocol matching rules | **Missing** | — |
| LAY-09 | Roaming preferences | N/A | No accounts |
| LAY-10 | Multi-monitor | N/A | Single browser window |
| LAY-11 | Save / reset layout | Partial | Reset yes. **Layouts are not saved**, and switching layout resets pane customisation |

## 6. Comparison and synchronization

| ID | Function | Status | Evidence / gap |
| --- | --- | --- | --- |
| CMP-01 | Prior-examination access | Partial | Any loaded study can be opened in a pane. No archive to fetch priors from |
| CMP-02 | Side-by-side series | Pass | Per-pane series selector; comparison panes are labelled |
| CMP-03 | Current vs prior | Pass | Each pane shows its own modality, description and `[comparison]` marker |
| CMP-04 | Linked scrolling | Pass | **By patient position, not index.** 24×2 mm vs 36×1 mm series match to 0.0 mm while indices differ (20 ↔ 34) |
| CMP-05 | Manual synchronisation / offset | Partial | Panes can be pinned. **No explicit offset between two studies** |
| CMP-06 | Link zoom / pan | Pass | **🔗 Sync → Zoom and pan**, off by default. `browser-reading.js` |
| CMP-07 | Link window/level | Pass | **🔗 Sync → Window/level**, off by default: a pane bound to another series uses that series' own Window Width/Center from its header, so a lung window can sit beside a soft-tissue one. Linked, it follows the toolbar. `browser-reading.js` |
| CMP-08 | Link / unlink selection | Partial | Three independent link switches (position, zoom/pan, window) plus per-pane pinning, and the button shows how many are on. Still no per-pane link membership |
| CMP-09 | Cross-reference cursor | Partial | Crosshair links planes within a volume. **Not across studies** |
| CMP-10 | Compare measurements over time | Partial | Measurements now persist per series and both studies can be open side by side, so the two numbers can be read together. **No automatic delta or growth table** |
| CMP-11 | Exit comparison | Pass | Set the pane back to "Current series" |
| CMP-12 | Registration status | Pass | Alignment is by stated position only; a level outside the other study is labelled "off by N mm — outside this series" |

## 7. 3D and advanced visualization

| ID | Function | Status | Evidence / gap |
| --- | --- | --- | --- |
| VOL-01 | Open 3D | Pass | WebGL2 raymarching; absence of WebGL2 is reported in the pane |
| VOL-02 | Volume rendering mode | Pass | Real volume, transfer functions in HU |
| VOL-03 | 3D rotate / pan / zoom | Partial | Drag to rotate, wheel to zoom, reset via the Reset menu. **No 3D pan** |
| VOL-04 | Orientation cube / standard views | **Missing** | — |
| VOL-05 | Bone / soft tissue / vessel presets | Pass | Bone VRT, Angiographic VRT, Muscle VRT, Soft Tissue, Lung, Skin; MR gets its own set |
| VOL-06 | Opacity / transfer function | Partial | Opacity slider and preset choice. **No editable transfer-function curve** |
| VOL-07 | Threshold | Pass | Bone-cut HU threshold, explicit, and it does not alter source pixels |
| VOL-08 | Clipping plane / crop box | Pass | Crop box with two independent handles per anatomical axis; cropping the ray rather than discarding samples, so the cut face is solid. Verified that cropping removes lit pixels, that opposite fifths of an axis are different pictures, and that the image data is byte-for-byte unchanged. `browser-crop.js` |
| VOL-09 | Sculpt / cut / undo | Pass | Spherical brush in mm, per-stroke undo, clear-all; verified the stored voxel keeps its value |
| VOL-10 | Surface / mesh rendering | **Missing** | — |
| VOL-11 | Segmentation tools | Partial | A Hounsfield threshold mask and a hand brush, in their own **Segmentation** workflow rather than under Measure, both reversible and neither altering the stored pixels. Named as a threshold rather than as bone removal, because it makes no anatomical judgement. Not anatomical segmentation |
| VOL-12 | Lesion tracking | **Missing** | — |
| VOL-13 | Vessel analysis | **Missing** | — |
| VOL-14 | 3D distance / volume measurement | **Missing** | Measurements are 2D on a plane |
| VOL-15–16 | Fusion | **Missing** | — |
| VOL-17 | Time-resolved / 4D | Partial | Time points are split into separate stacks and labelled. **No playback across them** |
| VOL-18 | Snapshot / movie / mesh export | Partial | PNG snapshot. No rotation movie, no mesh export |

## 8. Report editor

| ID | Function | Status | Evidence / gap |
| --- | --- | --- | --- |
| REP-01 | Open / close editor | Pass | Toolbar toggle; opens the current study's report |
| REP-02 | Report alongside images | Pass | Side panel; the grid re-lays out and study association is unaffected |
| REP-03 | Patient / accession / study header | Pass | **No carryover** — the draft is keyed on Study Instance UID and swapped on study change |
| REP-04 | History / technique / findings / impression | Pass | Saved and exported in reading order |
| REP-05 | Templates | Pass | 19 CT and MRI templates, 13 of them imported verbatim from mdvthu/report-templates (Apache-2.0) and checked word for word by `template-fidelity.js`. Confirms before replacing existing text; leaves clinical history alone; unfilled `[placeholders]` are counted and block finalising |
| REP-06 | Structured report forms | **Missing** | — |
| REP-07–11 | Bold / fonts / alignment / lists / tables | **Missing** | Plain text only |
| REP-12 | Copy / paste | Pass | Plain textarea, so no hidden formatting |
| REP-13 | Undo / redo | Pass | Native textarea history, independent of the image tools |
| REP-14 | Find / replace / spell check | Partial | Browser spell-check only |
| REP-15 | Macros / reusable phrases | Partial | Templates, not per-phrase macros |
| REP-16–17 | Speech / dictation | **Missing** | — |
| REP-18 | Insert key images | Pass | Captures the active pane with overlays; caption records plane and slice |
| REP-19 | Insert measurements | Pass | Appends every evaluable measurement to Findings with its plane, slice and series, under a heading; the reader's own text is kept. Measurements on cuts no pane is showing are named as such rather than guessed at |
| REP-20 | Save draft | Pass | Autosaves; status line shows the save time |
| REP-21 | Autosave / recovery | Pass | Survives a reload; also flushed on page unload |
| REP-22 | Preview / print / PDF | Partial | Copy to clipboard and download `.txt`. **No PDF or print layout** |
| REP-23 | Digital signature | **Missing** | "Mark final" is a local lock, not a signature |
| REP-24 | Finalize / lock | Pass | Fields become read-only and the template picker and capture buttons are disabled with a stated reason, rather than accepting a click and doing nothing; reopening is explicit |
| REP-25 | Amendment / addendum | **Missing** | — |
| REP-26 | Version history | **Missing** | Only the latest draft is kept |
| REP-27 | Concurrent editing | N/A | Single user, single browser |
| REP-28 | Report distribution | N/A | No network |
| REP-29 | Unsaved changes on study switch | Pass | The draft is flushed to its own study before the new one loads |
| REP-30 | Report status | Partial | Draft/Final shown in the panel. **Not surfaced in the series list** |

## 9. Export, metadata, and optional modules

| ID | Function | Status | Evidence / gap |
| --- | --- | --- | --- |
| EXT-01 | Image export / clipboard | Partial | PNG of the active pane or the whole grid, with overlays; Save as…, copy to clipboard, and the share sheet on a phone or tablet. **No option to exclude overlays** |
| EXT-02 | Original DICOM download | **Missing** | Files are read, never re-emitted |
| EXT-03 | Series / study export | **Missing** | — |
| EXT-04 | Print / film layout | **Missing** | — |
| EXT-05 | CD/DVD package | N/A | — |
| EXT-06 | Key-image selection | Partial | Key images attach to the report with plane and slice. **Not a DICOM reference** |
| EXT-07 | DICOM SR / encapsulated PDF | **Missing** | Such objects are rejected as having no usable pixel data |
| EXT-08 | De-identification | **Missing** | **Do not rely on this tool to anonymise anything.** Hiding overlays does not touch metadata, private tags or burned-in pixels |
| EXT-09–14 | Portals, peer review, collaboration, mammography, RT objects, AI | **Missing / N/A** | Out of scope for a local single-user viewer |

## 11. Minimum correctness checks

| Check | Result |
| --- | --- |
| Real DICOM input, not a mockup | **Pass** — real Part 10 parsing, including RLE and JPEG Lossless |
| Patient / study / series / frame associations correct | **Pass** — grouped by Study and Series UID; duplicates by SOP UID rejected; echoes and time points split |
| Geometry, orientation, spacing, units respected | **Pass** — irregular geometry detected; mm only when Pixel Spacing supports it |
| Transformations do not change HU or measurements | **Pass** — asserted for window, invert, zoom, rotation and flip |
| Unsupported data fails visibly | **Pass** — unsupported transfer syntaxes named with a conversion command |
| Switching panels or studies does not mix annotations or reports | **Pass** for reports and measurement anchoring |
| Report drafts recover; finalization controlled | **Partial** — recovery yes; no versions, amendments or signature |
| Output checked by reopening exported files | **Partial** — PNG and text verified by content, not by reopening |
| Shared deployment authorizes every request | **N/A** — nothing is served |
| Untrusted header text cannot execute | **Pass** — a study whose PatientName, PatientID, SeriesDescription, AccessionNumber, InstitutionName, Manufacturer and BodyPartExamined carry script payloads renders them literally; no markup parsed, no handler fired. `browser-security.js`, `test/fixtures/make_hostile.py` |
| Stored data is treated as untrusted | **Pass** — key images are read back through a validator that accepts only a bounded `data:image/…;base64` URL, and are escaped again on output. A stored measurement must name a tool this build has, a plane it can draw on, a numeric or absent slice index and finite points; a note is cut to 500 characters. `browser-security.js` §6 |
| A header value cannot reach a prototype | **Pass** — every dictionary keyed by untrusted text (series, volumes, caches, SOP UIDs seen) is an `Object.create(null)`. Six fixture files whose Study, Series and Frame of Reference UIDs are `__proto__`, `constructor` and `toString` load as three independent series, each opening as itself, with `Object.prototype` and `Array.prototype` untouched. `browser-security.js` §7, `make_hostile.py` |
| A file that cannot be read says why | **Pass** — reasons are recorded per file and grouped: *not a DICOM file (×2); the file is truncated or corrupt*. Translated only where the cause is unambiguous; an unsupported transfer syntax is passed through verbatim. `browser-security.js` §8 |
| A failed save is visible | **Pass** — a report that cannot be written to storage says so in a toast and keeps `⚠ NOT SAVING` on the status line until a save succeeds |
| No network, no eval, no third-party origin | **Pass** — asserted, not assumed |
