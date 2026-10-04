# Tests

Every claim the README makes about this viewer is checked here, in a real
browser, against data whose right answer is known in advance.

The suites deliberately do not assert that a function returns what the
function computes. They assert outcomes: that a 36 mm cylinder measures
36 mm, that a redacted name cannot be read out of the saved PNG, that the
four sequences of an MR study all land on the same lesion. Several bugs in
this codebase passed a green suite and were caught only by looking at what
came out — those are noted in the files where they happened.

## Running them

```sh
# 1. Generate the fixtures (once). They are synthetic DICOM, not in the repo.
python3 test/fixtures/make_phantom.py
python3 test/fixtures/make_prior.py
python3 test/fixtures/make_mr.py
python3 test/fixtures/make_mr_study.py
python3 test/fixtures/make_multiecho.py
python3 test/fixtures/make_burned.py
python3 test/fixtures/make_followup.py
python3 test/fixtures/make_hostile.py
python3 test/fixtures/make_scout.py
python3 test/fixtures/make_compressed_series.py
python3 test/fixtures/make_codec_fixtures.py   # needs pylibjpeg-libjpeg

# 2. Serve the viewer.
(cd dicom-viewer && python3 -m http.server 8412) &

# 3. Run.
node test/run.js                # everything
node test/run.js wl annot       # just the suites whose names match
```

`CT_FIXTURES` moves the fixture directory; `CT_PORT` moves the server port.

### What you need

- **Node** with `playwright` reachable (`NODE_PATH` may need to point at a
  global install), and a Chromium it can launch. The suites take an explicit
  `executablePath`; change it if yours lives elsewhere.
- **Python** with `numpy` and `pydicom` for the fixtures.
- `make_codec_fixtures.py` additionally needs `pylibjpeg-libjpeg`, and
  `codec-test.js` will not run without it. It writes the JPEG-lossless and
  RLE bitstreams that suite decodes, and validates this repo's hand-written
  JPEG-lossless encoder against an independent C decoder first — so the
  bytes the JavaScript decoder is measured against are ones a third party
  agrees on, rather than ones this repo produced and then marked its own
  homework with.

## The fixtures

Each is built so that a wrong answer looks wrong, rather than plausible.

| Directory | What it is | What it pins down |
| --- | --- | --- |
| `phantom` | 128³ CT, 1 mm isotropic, with a cylinder tilted 30° | An axial cut sees an ellipse; a cut squared to the cylinder must see a 36 mm circle. Ground truth for oblique MPR and for distance |
| `series-prior` | A second CT of the same region, 1 mm slices starting at z = 6 mm | Linking by slice index lines up the wrong anatomy; linking by patient position must not. Its marker's radius is a function of z, so a mis-link is visible as the wrong size |
| `series-mr` | MR with no Rescale Slope/Intercept | Nothing may be labelled HU |
| `series-mrstudy` | Four MR sequences in three acquisition planes, one marker at a known patient coordinate in all four | That each sequence is laid out as acquired, and that moving the crosshair puts every sequence on the same anatomy |
| `series-echo` | Dual-echo MR | Echoes must not interleave into one stack |
| `series-burned` | CT with the patient name written into the pixel data, in a known rectangle | That redaction destroys it rather than covering it |
| `series-followup` | One patient scanned three times with a lesion that grows 8 → 14 → 22 mm, each study at a different thickness and start, each with a useless scout series — plus a second patient scanned on the same dates | That Compare picks this patient's own prior and never the other patient's, picks the diagnostic series and not the scout, and lines the two up by position rather than slice number |
| `series-raw`, `series-rle`, `series-jpegls` | The same pixels in three transfer syntaxes | Both decoders must return the raw values exactly |
| `series-scout` | A CT with a **coronal** localizer (row +x, column −z) over 300 mm of z, bands burned in at known levels, and an axial series that fills only part of it | That an axial cut appears on the scout as a horizontal line at row (0 − z); a viewer that ignored Image Orientation would draw a vertical one. Also that a level outside the series is refused rather than clamped |
| `series-hostile` | CT whose PatientName, PatientID, SeriesDescription, AccessionNumber, InstitutionName, Manufacturer and BodyPartExamined carry HTML and script payloads | That header text is shown literally and never parsed as markup, anywhere it is displayed |
| `codec` | Bare RLE and JPEG-lossless bitstreams, with a manifest | Decoding, byte for byte, against streams an independent C decoder validated |

## The suites

| Suite | Asks |
| --- | --- |
| `oblique-test.js` | Trilinear sampling, Rodrigues rotation, frame orthonormality |
| `codec-test.js` | RLE and JPEG-lossless decode, byte for byte |
| `measure-unit.js` | Distance, angle, Cobb, areas and histograms on anisotropic pixels |
| `template-fidelity.js` | Every imported report template, word for word against its source |
| `browser-regress.js` | The orthogonal workstation still behaves as it did |
| `browser-oblique*.js` | Oblique reslicing, and measuring on an oblique cut |
| `browser-layouts.js` | Every layout builds the panes it claims |
| `browser-planefill.js` | Filling a grid with one plane |
| `browser-sync.js` | Stacked scrolling and shared cuts |
| `browser-wl.js` | Window/level is scale-invariant; the crosshair grip is small |
| `browser-codecs.js` | Compressed series load and measure identically to raw |
| `browser-hu.js` | HU honesty, ROI statistics, resets, toolbar reachability, menus |
| `browser-mr.js` | MR loads, and nothing claims Hounsfield units |
| `browser-report.js` | Reports stay bound to their study |
| `browser-compare.js` | Two studies linked by patient position |
| `browser-sculpt-cine.js` | Hand sculpting and cine |
| `browser-worklist.js` | Study filtering, acquisition-dimension splitting |
| `browser-annot.js` | Every annotation tool, editing, hiding, persistence |
| `browser-focus.js` | The focus point across series, and what it refuses to claim |
| `browser-templates.js` | Templates, placeholders, and the finalise guard |
| `browser-mrstudy.js` | MR sequence layout, crosshair across sequences, screenshots |
| `browser-redact.js` | Redaction against real burned-in text; saving to a file |
| `browser-compare-prior.js` | One-press comparison with a prior, and the patient it refuses to offer |
| `browser-share.js` | Sending a screenshot to Photos, and every way that can fail |
| `browser-workstation.js` | Series cards, drag-to-pane, the four corners, the contextual panel, scout navigation, the new layouts and keys |
| `browser-viewtools.js` | Zoom, pan and scroll as armed left-drag tools, and that the wheel and modifiers still work |
| `browser-undo.js` | Undo and redo restore a measurement's numbers; the shortcut list matches the keys |
| `browser-crop.js` | 3D cropping removes the voxels it says it does, one side at a time, and resets |
| `browser-security.js` | Hostile DICOM text, untrusted stored reports, and no network or eval anywhere |
| `browser-sweep.js` | Presses every control there is and fails on any error |
| `probe-bar.js` | The toolbar stays one row and nothing is out of reach |
| `probe-menus.js` | Every menu opens on screen with every item hit-testable |
