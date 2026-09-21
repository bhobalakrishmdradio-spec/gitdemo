# RadiAnt DICOM Viewer — Base Plan for Claude

Prepared: 21 September 2026

## 1. Purpose and scope

This file interprets “base plan” as a product and development blueprint for an independent DICOM viewer inspired by RadiAnt's documented capabilities. It is not a subscription/pricing plan, RadiAnt source code, or an official internal architecture document. Public product documentation was accessed; the installed application and private development materials were not inspected.

Sections 2–3 summarize public information. Sections 4–10 are an original proposed implementation plan, not claims about how RadiAnt is built.

## 2. Publicly documented product baseline

RadiAnt is a Windows medical-image viewer with local study access, a searchable local archive, and PACS query/retrieve workflows. Its core tools include window width/level, presets, zoom, pan, rotation, flipping, length and angle measurements, elliptical ROI statistics, and annotations. Multiple series can be compared with synchronization and cross-reference lines. Advanced capabilities include multiplanar reconstruction, volume rendering, PET/CT fusion, digital subtraction angiography, and time-intensity curves. [Official product overview](https://www.radiantviewer.com/)

The comparison table also documents cine playback, searchable DICOM tags, structured reports, encapsulated PDFs, compressed pixel formats, and image/movie/original-DICOM export. The installed desktop edition includes oblique MPR with MIP/MinIP/average modes, 3D rendering, STL export, and external launch integration. The separate CD/DVD edition has different capabilities and media restrictions; do not assume identical feature coverage. [Official feature matrix](https://www.radiantviewer.com/products/)

## 3. Reference workflow

The following is a simplified synthesis of those documented capabilities, not a literal reproduction of RadiAnt's screens:

1. Open a study from local storage or retrieve it from PACS.
2. Select a series and browse images.
3. Adjust display settings and make measurements.
4. Compare series or open reconstruction tools.
5. Export selected results or retain the study locally.

## 4. Proposed first version: a working 2D viewer

### Objective

Build a responsive viewer that opens real DICOM studies, preserves image geometry, and supports basic review and measurements. Start with local CT/MR image stacks and common single-image radiographs. Explicitly document supported SOP Classes and transfer syntaxes.

### Required capabilities

| Area | Proposed first-version requirement |
|---|---|
| Import | Select files or folders; show progress, cancellation, duplicates, and failures |
| Organization | Group images by Study Instance UID and Series Instance UID |
| Series selection | Show thumbnails, modality, series description, and image count |
| Image display | Decode actual pixel data; support the declared grayscale and color formats |
| Navigation | Mouse-wheel slice browsing, frame slider, keyboard navigation |
| Display tools | Window/level, editable presets, zoom, pan, invert, rotate, flip, reset |
| Measurements | Distance, angle, ellipse ROI with area and supported intensity statistics |
| Comparison | Single, two-panel, and four-panel layouts |
| Metadata | Searchable tag panel and configurable image overlays |
| Export | Save a rendered image with explicit overlay/annotation options |
| Reliability | Clear unsupported-format messages; continue past individual bad files |

Defer PACS, 3D rendering, fusion, DSA, and advanced temporal analysis until the first version is stable.

## 5. Proposed screen layout

```text
+-------------------------------------------------------------------+
| Open | Layout | Window | Zoom/Pan | Measure | Reset | Export         |
+----------------+--------------------------------------------------+
| Study details  |                                                  |
|                |             Active image viewport                |
| Series list    |                                                  |
| + thumbnails  |       Optional second / third / fourth panel     |
|                |                                                  |
+----------------+--------------------------------------------------+
| Loading status | Frame / slice | Window values | Zoom | Active tool |
+-------------------------------------------------------------------+
```

Use a dark image workspace, clear active-panel borders, compact controls, and optional overlays. Put metadata, export settings, and measurement lists in collapsible panels. Give each viewport independent display state, with explicit linking controls for compatible series.

## 6. Proposed architecture

Choose the target platform before choosing a framework. A Windows desktop application, a macOS application, and a browser application have different file-access, graphics, and deployment constraints. The user has not yet specified a target.

| Module | Responsibility |
|---|---|
| Application shell | Windows, menus, shortcuts, preferences, and study selection |
| Import service | Discover files, inspect metadata, deduplicate, report errors |
| DICOM layer | Parse datasets, dispatch decoders, expose frames and geometry |
| Study model | Maintain studies, series, instances, and frame-level metadata |
| Rendering layer | Apply display transforms and draw images efficiently |
| Interaction layer | Handle tools, measurements, annotations, and viewport state |
| Cache | Limit decoded-image memory and prefetch neighboring frames |
| Optional archive | Persist study metadata and managed file locations |
| Export service | Produce rendered outputs and explicit DICOM copies |
| Later network adapter | Add PACS integration without coupling it to rendering |

Processing flow:

```text
Files → Metadata scan → Study/series grouping → Frame selection
      → Pixel decode → Modality/VOI display pipeline → Viewport
                                                  → Tool overlays
```

Decode away from the UI thread, show the first usable image before the entire study loads, and bound caches. Preserve source files and keep display adjustments separate from original data.

### Minimal data entities

- **Study:** Study Instance UID, patient context, date, description, series references.
- **Series:** Series Instance UID, modality, description, instance references.
- **Instance/frame:** SOP Instance UID, frame index, source location, transfer syntax, pixel dimensions, spatial and temporal metadata.
- **Viewport:** Selected series/frame, window settings, transform, active tool, linking state.
- **Measurement:** Type, source image/frame reference, image-space coordinates, units, calibration provenance.

Patient identifiers may be absent or repeated across institutions; they should not be the sole database key.

## 7. Image correctness requirements for the proposed build

Treat these as engineering requirements to verify against the current DICOM standard during implementation:

- Handle stored pixel representation, bit depth, photometric interpretation, and applicable modality/VOI transforms explicitly.
- Compute quantitative statistics from appropriate pixel values, not from the displayed screenshot. Report HU only when the image metadata supports that interpretation.
- Use valid image geometry for spatial ordering. Do not rely exclusively on filenames or instance numbers; distinguish time points, echoes, and other dimensions before assembling a stack.
- Base physical measurements on applicable calibration metadata. When it is missing, report pixels or an explicit uncalibrated state rather than inventing millimeters.
- Keep orientation indicators and measurements correct after rotation, flipping, zooming, and panning.
- Detect incompatible or incomplete geometry before volume reconstruction or linked spatial navigation.
- Treat enhanced multi-frame data as a distinct capability requiring frame-level handling; do not silently assume conventional single-frame layout.
- Preserve source data and test malformed inputs and oversized allocations.

## 8. Delivery phases and acceptance criteria

### Phase 1 — Import and display

Deliver local import, grouping, real pixel decoding, thumbnails, navigation, and display controls.

Acceptance: supported reference studies open correctly; invalid files produce useful errors; the interface remains usable during loading; resetting restores a predictable display.

### Phase 2 — Measurements and comparison

Add calibrated tools, metadata inspection, multiple panels, export, and optional persistent archive.

Acceptance: known distances and pixel statistics match reference values within documented tolerances; tools remain anchored during view transformations; exported images match chosen settings.

### Phase 3 — Reconstruction

Add orthogonal MPR, linked crosshairs, then oblique planes and slab projections. Add volume rendering after volume geometry is validated.

Acceptance: known landmarks align across planes; anisotropic and oblique test datasets behave correctly; unsupported geometry is explained.

### Phase 4 — PACS

Add connection configuration, connectivity testing, study search, retrieval, progress, cancellation, and failure recovery. Select supported DICOM network services explicitly and test against a controlled server.

Acceptance: searches and transfers succeed with representative datasets; failures are recoverable; transferred instances are tracked accurately.

### Phase 5 — Advanced workflows

Evaluate fusion, PET quantification, temporal curves, DSA, and 3D export as separate validated features. Do not represent overlays as image registration or display arbitrary PET intensities as SUV.

## 9. Validation and data handling

Use de-identified or synthetic datasets covering the declared support matrix, including different compression formats, orientations, pixel spacings, signed pixels, and damaged files. Compare outputs with trusted reference results and record limitations.

Keep local data local by default. Make network transfers explicit. Hiding patient overlays is not DICOM de-identification; any future de-identification feature must also address metadata, private fields, and possible identifiers burned into pixels.

The proposed prototype is an engineering/research deliverable. Clinical deployment requires a separate intended-use and validation process; this document does not establish diagnostic suitability.

## 10. Prompt to use in Claude

> Use this document as the starting specification for an independent DICOM viewer. Treat the RadiAnt feature summary as a public reference and the remaining sections as a proposed plan, not RadiAnt's internal architecture.
>
> First ask which platform I want: Windows desktop, macOS desktop, or browser. Ask whether the immediate goal is a working prototype or a longer-term clinical product. Then propose a suitable technology stack, check current primary documentation, explain major tradeoffs, and define a small supported DICOM format matrix.
>
> Implement Phase 1 first: real local DICOM import, study/series grouping, decoding, scrolling, window/level, zoom, pan, and reset. Provide setup instructions and concrete verification steps. Do not substitute static screenshots or mock data for working image loading. Identify unsupported cases clearly. Keep the architecture extensible for measurements, MPR, and PACS. Use original branding and UI assets.

## Sources

Accessed 21 September 2026:

1. [RadiAnt official product overview](https://www.radiantviewer.com/)
2. [RadiAnt official feature comparison](https://www.radiantviewer.com/products/)
3. [RadiAnt desktop product page](https://www.radiantviewer.com/products/radiant-dicom-viewer-standard/)

No private source code, internal architecture, patient studies, or licensed application assets are included.
