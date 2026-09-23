# CT Console — MedSynapse function cross-check, audited

Audited: 23 September 2026 against commit `cd8bbdd`.

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

Implemented during this audit: comparison of two studies with linked
scrolling, hand sculpting, cine, the report editor, MR support, the
Angiographic/Bone/Muscle VRT presets, acquisition-dimension splitting, and
the worklist filter.

The largest remaining gaps, in priority order:

1. **P1 — Annotation tools.** No arrow, text, freehand or polygon. A reader
   cannot mark up an image for someone else.
2. **P1 — Measurements are not persisted.** They live in memory and are lost
   on reload, so MEA-17 and CMP-10 (comparing measurements over time) cannot
   work.
3. **P1 — Report output is plain text only.** No rich formatting, no PDF, no
   signature, no amendment or version history.
4. **P2 — No measurement editing after placement.** Points cannot be dragged.
5. **P2 — No 2D colour map, magnifier, shutter, or fit/1:1 zoom modes.**
6. **P2 — No hanging protocols or saved layouts.**
7. **Out of scope by design** — PACS retrieval, portals, peer review, AI,
   fusion, segmentation modules, de-identification, multi-user workflow.

## 1. Study access, toolbar, and navigation

| ID | Function | Status | Evidence / gap |
| --- | --- | --- | --- |
| NAV-01 | Worklist | Partial | Series panel groups by study with dates. No assignment, priority or reporting-status columns |
| NAV-02 | Search and filters | Pass | Filter box over patient, ID, accession, date, modality, description; every word must match. `browser-worklist.js` |
| NAV-03 | Open local files / folder | Pass | Real DICOM decoded; unreadable files counted and reported; unsupported syntaxes named |
| NAV-04 | Upload / receive studies | N/A | No network by design. Duplicate SOP UIDs are detected and reported on re-import |
| NAV-05 | Series thumbnails | Partial | Thumbnails, names, counts, selection state. Suppressed above 60 slices for performance |
| NAV-06 | Drag series into panel | Partial | Per-pane series **selector** rather than drag-and-drop; other panes are undisturbed |
| NAV-07 | Previous / next image | Pass | Wheel, slider, arrow keys, cine |
| NAV-08 | First / last; slice slider | Partial | Slider and Page Up/Down. No explicit first/last buttons |
| NAV-09 | Previous / next series | Partial | Click in the series list. No next/previous series control |
| NAV-10 | Cine play / pause | Pass | `browser-sculpt-cine.js` |
| NAV-11 | Cine speed / reverse / loop | Pass | 5/12/25/40 fps, reverse, loop; with loop off it stops on the last slice |
| NAV-12 | Tooltips / active tool | Pass | Every control has a tooltip; active tool and modes are highlighted |
| NAV-13 | Overflow menu | Partial | Toolbar scrolls sideways and tightens below 1520 px; Orient and Reset are menus. No explicit overflow menu |
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
| IMG-05 | Zoom | Pass | Shift+wheel; measurements stay anchored through it |
| IMG-06 | Pan | Pass | Right-drag, per pane |
| IMG-07 | Fit to window / 1:1 | **Missing** | Always fits the pane at true physical aspect. No 1:1 pixel mode |
| IMG-08 | Magnifier | **Missing** | — |
| IMG-09 | Rotate cw / ccw | Pass | Orient menu, both directions, plus free rotation. Orientation letters and measurements follow |
| IMG-10 | Horizontal / vertical flip | Pass | Orient menu; letters update, annotations stay attached |
| IMG-11 | Invert grayscale | Pass | Verified not to change HU or ROI statistics |
| IMG-12 | Colour map / LUT | **Missing** for 2D | 3D has transfer functions; 2D is greyscale only |
| IMG-13 | Sharpen / smooth | **Missing** | — |
| IMG-14 | Shutter / crop | **Missing** | Sculpting removes voxels, which is not the same thing |
| IMG-15 | Orientation labels / scale | Partial | R/L/A/P/H/F derived from Image Orientation and suppressed when no single letter is honest. **No scale bar** |
| IMG-16 | Patient / image overlay toggle | **Missing** | Overlays always shown on large panes, hidden on small ones. Would not anonymise anything regardless |
| IMG-17 | DICOM tags / metadata | Pass | Searchable by keyword, value or tag number; shows the displayed instance |

## 3. HU, ROI, measurements, and annotations

| ID | Function | Status | Evidence / gap |
| --- | --- | --- | --- |
| MEA-01 | Point HU / pixel probe | Pass | Live readout plus a pinned probe; reads one pixel, never an interpolation |
| MEA-02 | Circle ROI | Partial | Ellipse covers it; no constrained circle |
| MEA-03 | Ellipse ROI | Pass | Mean ± SD, min, max, area, count. Verified π/4 of the enclosing rectangle |
| MEA-04 | Rectangle ROI | Pass | 10×10 px at 1 mm = exactly 100.000000 mm², 100 pixels |
| MEA-05 | Polygon / freehand ROI | **Missing** | — |
| MEA-06 | SD / pixel count | Pass | Population SD over pixel centres inside the shape; count reported |
| MEA-07 | ROI area / perimeter | Partial | Area yes, in mm² when calibrated. **No perimeter** |
| MEA-08 | Distance / ruler | Pass | Computed in physical space, so unequal row/column spacing is handled |
| MEA-09 | Polyline length | **Missing** | — |
| MEA-10 | Angle | Pass | 90.00° on a right-angle phantom; unchanged by zoom, pan and rotation |
| MEA-11 | Cobb angle | **Missing** | — |
| MEA-12 | Manual calibration | **Missing** | Uncalibrated data is labelled as such rather than allowing an override |
| MEA-13 | Arrow / text annotation | **Missing** | **P1 gap** |
| MEA-14 | Freehand drawing | **Missing** | — |
| MEA-15 | Edit / move / delete | Partial | Delete and select yes. **Points cannot be dragged after placement** |
| MEA-16 | Hide / show / clear | Partial | Clear-all yes. **No hide without deleting** |
| MEA-17 | Measurement list / persistence | Partial | Listed and anchored to their slice. **Not saved — lost on reload** |
| MEA-18 | HU histogram | **Missing** | — |
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
| MPR-08 | Reference / localizer lines | Pass | Each arm is the real intersection line of a companion plane |
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
| LAY-03 | Additional grids | Partial | 2×3 and MPR three-up. No 2×1 or custom splits |
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
| CMP-06 | Link zoom / pan | **Missing** | Zoom and pan are per pane |
| CMP-07 | Link window/level | Partial | Panes on "global" share the toolbar W/L; a pane can opt out with its own |
| CMP-08 | Link / unlink selection | Partial | One global Link toggle plus per-pane pinning. No per-pane link membership |
| CMP-09 | Cross-reference cursor | Partial | Crosshair links planes within a volume. **Not across studies** |
| CMP-10 | Compare measurements over time | **Missing** | Measurements are not persisted |
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
| VOL-08 | Clipping plane / crop box | **Missing** | Sculpting is the nearest equivalent and is reversible |
| VOL-09 | Sculpt / cut / undo | Pass | Spherical brush in mm, per-stroke undo, clear-all; verified the stored voxel keeps its value |
| VOL-10 | Surface / mesh rendering | **Missing** | — |
| VOL-11 | Segmentation tools | **Missing** | Threshold and hand sculpting only — not anatomical segmentation |
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
| REP-05 | Templates | Pass | Five starters; confirms before replacing existing text; leaves clinical history alone |
| REP-06 | Structured report forms | **Missing** | — |
| REP-07–11 | Bold / fonts / alignment / lists / tables | **Missing** | Plain text only |
| REP-12 | Copy / paste | Pass | Plain textarea, so no hidden formatting |
| REP-13 | Undo / redo | Pass | Native textarea history, independent of the image tools |
| REP-14 | Find / replace / spell check | Partial | Browser spell-check only |
| REP-15 | Macros / reusable phrases | Partial | Templates, not per-phrase macros |
| REP-16–17 | Speech / dictation | **Missing** | — |
| REP-18 | Insert key images | Pass | Captures the active pane with overlays; caption records plane and slice |
| REP-19 | Insert measurements | **Missing** | — |
| REP-20 | Save draft | Pass | Autosaves; status line shows the save time |
| REP-21 | Autosave / recovery | Pass | Survives a reload; also flushed on page unload |
| REP-22 | Preview / print / PDF | Partial | Copy to clipboard and download `.txt`. **No PDF or print layout** |
| REP-23 | Digital signature | **Missing** | "Mark final" is a local lock, not a signature |
| REP-24 | Finalize / lock | Pass | Fields become read-only; reopening is explicit |
| REP-25 | Amendment / addendum | **Missing** | — |
| REP-26 | Version history | **Missing** | Only the latest draft is kept |
| REP-27 | Concurrent editing | N/A | Single user, single browser |
| REP-28 | Report distribution | N/A | No network |
| REP-29 | Unsaved changes on study switch | Pass | The draft is flushed to its own study before the new one loads |
| REP-30 | Report status | Partial | Draft/Final shown in the panel. **Not surfaced in the series list** |

## 9. Export, metadata, and optional modules

| ID | Function | Status | Evidence / gap |
| --- | --- | --- | --- |
| EXT-01 | Image export / clipboard | Partial | PNG of the active pane with overlays. **No option to exclude overlays**, no clipboard copy |
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
