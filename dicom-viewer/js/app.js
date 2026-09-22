/* ==========================================================================
   CT Console — a client-side DICOM viewer and MPR / 3D workstation.

   Everything runs in the browser: files are parsed, reconstructed and
   rendered locally and nothing is ever uploaded. Built on the open-source
   `dicom-parser` library (vendored in js/vendor/), with the volume engine in
   volume.js and the WebGL2 volume renderer in vr.js.
   ========================================================================== */
(function () {
  "use strict";

  var V = window.CTVolume;
  var VR = window.CTVolumeRenderer;
  var MEAS = window.CTMeasure;

  /* ---------------------------------------------------------------------
   * Constants
   * ------------------------------------------------------------------- */
  var UNCOMPRESSED_TRANSFER_SYNTAXES = {
    "1.2.840.10008.1.2": "implicit-little-endian",
    "1.2.840.10008.1.2.1": "explicit-little-endian",
    "1.2.840.10008.1.2.2": "explicit-big-endian",
  };

  var PRESETS = {
    lung: { ww: 1500, wc: -600, label: "Lung" },
    bone: { ww: 2000, wc: 480, label: "Bone" },
    brain: { ww: 80, wc: 40, label: "Brain" },
    soft: { ww: 400, wc: 40, label: "Soft" },
    abdomen: { ww: 400, wc: 50, label: "Abdomen" },
    mediastinum: { ww: 350, wc: 50, label: "Mediast." },
    angio: { ww: 600, wc: 150, label: "Angio" },
  };

  var MAX_SERIES_FOR_THUMBNAILS = 60;
  var MPR_PLANES = ["axial", "coronal", "sagittal"];

  // The 3D texture is packed once over the full diagnostic HU range so the
  // transfer-function presets can be expressed in real Hounsfield Units.
  var VR_WINDOW_LOW = -1024;
  var VR_WINDOW_HIGH = 3071;

  /* Window/level drag response.
   *
   * A fixed number of HU per pixel cannot work across the windows CT
   * actually uses: the same step that is barely perceptible on a lung window
   * (W1500) swings a brain window (W80) past its own width in a twitch. So
   * the width moves multiplicatively and the level steps in proportion to
   * the current width, which makes the gesture scale-invariant — it feels
   * identical wherever you start.
   */
  var WL_WIDTH_DOUBLE_PX = 160;   // drag this far right to double the width
  var WL_LEVEL_SPAN_PX = 250;     // drag this far down to shift level by one width
  var WL_MIN_WIDTH = 1;
  var WL_MAX_WIDTH = 20000;

  /* Viewport layouts.
   *
   * A layout is a grid plus the planes its panes start out showing. Panes are
   * reassignable afterwards, so the fill is only a starting point — but only
   * one pane may hold the 3D view, since that is a single WebGL context.
   * `fill: null` means "cycle the MPR planes", used by the larger grids.
   */
  var LAYOUTS = {
    quad: { label: "2×2", cols: 2, rows: 2, fill: ["axial", "coronal", "sagittal", "vr"] },
    axial: { label: "Axial", cols: 1, rows: 1, fill: ["axial"] },
    mpr: { label: "MPR", cols: 3, rows: 1, fill: ["axial", "coronal", "sagittal"] },
    vr: { label: "3D", cols: 1, rows: 1, fill: ["vr"] },
    "1x2": { label: "1×2", cols: 2, rows: 1, fill: ["axial", "coronal"] },
    "2x3": { label: "2×3", cols: 3, rows: 2, fill: null },
    "4x4": { label: "4×4", cols: 4, rows: 4, fill: null },
  };

  /** Planes a layout's panes start on. */
  function layoutFill(key) {
    var def = LAYOUTS[key] || LAYOUTS.quad;
    var total = def.cols * def.rows;
    if (def.fill) return def.fill.slice(0, total);
    var out = [];
    for (var i = 0; i < total; i++) out.push(MPR_PLANES[i % MPR_PLANES.length]);
    // One 3D pane, in the fourth slot, where the 2x2 layout also puts it.
    if (total >= 4) out[3] = "vr";
    return out;
  }

  var PLANE_LABELS = { axial: "Axial", coronal: "Coronal", sagittal: "Sagittal", vr: "3D" };

  /* Oblique MPR reslicing frames.
   *
   * Each plane carries an orthonormal triple in volume-axis space:
   *   u — the output's +column direction
   *   v — the output's +row direction
   *   n — the direction the plane's slice index advances along
   *
   * At rest these are the volume axes, and reslicing takes the fast
   * axis-aligned path. Rotating the crosshair in one plane rotates the other
   * two frames about that plane's normal, which tilts their cuts while
   * leaving the plane you dragged in untouched — the three frames stay
   * mutually orthogonal, so the slice indices still decompose a single point.
   */
  var BASE_FRAMES = {
    axial: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
    coronal: { u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
    sagittal: { u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
  };

  /* ---------------------------------------------------------------------
   * State
   * ------------------------------------------------------------------- */
  var state = {
    seriesOrder: [],
    seriesMap: {},
    currentSeriesUID: null,
    duplicateCount: 0,

    volume: null,
    geometryWarnings: [],
    index: { axial: 0, coronal: 0, sagittal: 0 },
    frames: null,                 // set from BASE_FRAMES on init / reset

    // One entry per pane in the current layout. Each pane carries its own
    // view transform, its own window/level override and its own slice when
    // unlinked, so two panes on the same plane are not redundant.
    cells: [],
    activeCell: 0,
    measureCell: 0,             // pane the in-progress measurement started in

    tool: "none",
    measurements: [],
    pendingMeasure: null,
    selectedMeasurement: null,

    windowWidth: 400,
    windowCenter: 40,
    invert: false,

    thicknessMm: 0,
    projectionMode: "average",

    boneCut: false,
    boneThreshold: 200,
    boneMaskVersion: 0,

    vrMode: "vr",
    vrPreset: "bone",
    vrOpacity: 1,

    layout: "quad",
    // Slices between one pane and the next on the same plane. 0 makes every
    // pane show the same slice; 1 makes a grid a filmstrip.
    stackStep: 1,
    crosshair: true,

    drag: null,
  };

  var dom = {};
  var cellEls = [];             // DOM for each pane, parallel to state.cells
  var toastTimer = null;
  var renderer = null;          // CTVolumeRenderer.Renderer
  var vrDirty = true;           // texture needs re-upload
  var planeCache = {};          // request key -> extracted plane
  var planeCacheKeys = [];      // insertion order, for trimming
  var seriesNodes = {};         // uid -> { wrapper, sliceCount }

  /* ---------------------------------------------------------------------
   * DOM
   * ------------------------------------------------------------------- */
  // The grid layout to return to when a pane is un-expanded.
  var lastGridLayout = "quad";

  function cacheDom() {
    dom.fileInput = byId("fileInput");
    dom.folderInput = byId("folderInput");
    dom.clearBtn = byId("clearBtn");
    dom.layoutSeg = byId("layoutSeg");
    dom.toolSeg = byId("toolSeg");
    dom.presetSelect = byId("presetSelect");
    dom.invertBtn = byId("invertBtn");
    dom.flipHBtn = byId("flipHBtn");
    dom.flipVBtn = byId("flipVBtn");
    dom.rotateBtn = byId("rotateBtn");
    dom.crosshairBtn = byId("crosshairBtn");
    dom.exportBtn = byId("exportBtn");
    dom.resetBtn = byId("resetBtn");
    dom.measureList = byId("measureList");
    dom.clearMeasureBtn = byId("clearMeasureBtn");
    dom.calibrationNote = byId("calibrationNote");
    dom.stackStep = byId("stackStep");
    dom.stackNote = byId("stackNote");
    dom.obliqueInfo = byId("obliqueInfo");
    dom.obliqueReset = byId("obliqueResetBtn");
    dom.geometryWarnings = byId("geometryWarnings");
    dom.tagSearch = byId("tagSearch");
    dom.seriesToggleBtn = byId("seriesToggleBtn");
    dom.panelToggleBtn = byId("panelToggleBtn");

    dom.seriesPanel = byId("seriesPanel");
    dom.toolsPanel = byId("toolsPanel");
    dom.dropHint = byId("dropHint");
    dom.seriesList = byId("seriesList");
    dom.viewGrid = byId("viewGrid");
    dom.viewportEmpty = byId("viewportEmpty");

    dom.windowWidthInput = byId("windowWidth");
    dom.windowCenterInput = byId("windowCenter");
    dom.thicknessRange = byId("thicknessRange");
    dom.thicknessValue = byId("thicknessValue");
    dom.projectionMode = byId("projectionMode");
    dom.boneCutToggle = byId("boneCutToggle");
    dom.boneThreshold = byId("boneThreshold");
    dom.boneThresholdValue = byId("boneThresholdValue");
    dom.boneCutStatus = byId("boneCutStatus");
    dom.vrMode = byId("vrMode");
    dom.vrPreset = byId("vrPreset");
    dom.vrOpacity = byId("vrOpacity");
    dom.volumeInfo = byId("volumeInfo");
    dom.metaTable = byId("metaTable");
    dom.statusText = byId("statusText");
    dom.toast = byId("toast");
    dom.busy = byId("busy");
    dom.busyText = byId("busyText");

  }

  /* ---------------------------------------------------------------------
   * Panes
   *
   * The grid is built from state.cells rather than from fixed markup, so a
   * layout can hold any number of panes and a pane can be reassigned to a
   * different plane without disturbing the others.
   * ------------------------------------------------------------------- */

  function newCell(plane) {
    return {
      plane: plane,
      offset: 0,            // slices ahead of the shared cut for this plane
      index: 0,             // absolute slice, used only while pinned
      pinned: false,        // true = hold this slice, ignore scrolling
      view: { zoom: 1, panX: 0, panY: 0, rotation: 0, flipH: false, flipV: false },
      wl: null,             // own window/level; null while following the global one
    };
  }

  /**
   * The slice a pane is showing.
   *
   * Panes track the shared cut at a fixed offset, so scrolling anywhere moves
   * the whole stack together and a grid reads as a run of consecutive images
   * rather than one image repeated. A pinned pane opts out and holds still.
   */
  function cellIndex(cell) {
    if (!state.volume || cell.plane === "vr") return 0;
    var count = V.planeCount(state.volume, cell.plane);
    var i = cell.pinned ? cell.index : state.index[cell.plane] + (cell.offset || 0);
    return Math.max(0, Math.min(count - 1, i));
  }

  /**
   * Spread the panes of each plane across consecutive slices.
   *
   * Without this a grid of repeated planes is the same image several times
   * over, and scrolling it gains you nothing. Pinned panes are left alone.
   */
  function restack() {
    var seen = {};
    state.cells.forEach(function (cell) {
      if (cell.plane === "vr") return;
      var k = seen[cell.plane] || 0;
      seen[cell.plane] = k + 1;
      if (!cell.pinned) cell.offset = k * state.stackStep;
    });
  }

  /** The window a pane draws with: its own override, or the global one. */
  function cellWindow(cell) {
    if (cell.wl) return cell.wl;
    return { ww: state.windowWidth, wc: state.windowCenter };
  }

  function activeCell() {
    return state.cells[state.activeCell] || state.cells[0] || null;
  }

  /** The active pane's plane, or the first MPR pane, or axial. */
  function activeMprPlane() {
    var cell = activeCell();
    if (cell && cell.plane !== "vr") return cell.plane;
    for (var i = 0; i < state.cells.length; i++) {
      if (state.cells[i].plane !== "vr") return state.cells[i].plane;
    }
    return "axial";
  }

  /**
   * Only one pane may hold the 3D view — it is a single WebGL context.
   * `keep` names the pane that just claimed it, if any; otherwise the first
   * 3D pane wins and the rest fall back to axial.
   */
  function enforceSingleVR(keep) {
    var winner = -1;
    state.cells.forEach(function (cell, i) {
      if (cell.plane !== "vr") return;
      if (winner === -1 || i === keep) {
        if (winner !== -1) state.cells[winner].plane = "axial";
        winner = i;
      } else {
        cell.plane = "axial";
      }
    });
  }

  /** Apply a layout: fresh panes on the layout's starting planes. */
  function applyLayout(key) {
    state.layout = LAYOUTS[key] ? key : "quad";
    state.cells = layoutFill(state.layout).map(newCell);
    enforceSingleVR();
    restack();
    state.activeCell = 0;
    rebuildCells();
  }

  /** Rebuild the pane DOM from state.cells, keeping their state. */
  function rebuildCells() {
    var def = LAYOUTS[state.layout] || LAYOUTS.quad;
    dom.viewGrid.style.gridTemplateColumns = "repeat(" + def.cols + ", minmax(0, 1fr))";
    dom.viewGrid.style.gridTemplateRows = "repeat(" + def.rows + ", minmax(0, 1fr))";

    // The 3D renderer holds a canvas, so it cannot outlive a rebuild.
    var camera = renderer ? { rotX: renderer.rotX, rotY: renderer.rotY, distance: renderer.distance } : null;
    if (renderer) { renderer.dispose(); renderer = null; vrDirty = true; }

    cellEls.forEach(function (rec) {
      if (rec.root.parentNode) rec.root.parentNode.removeChild(rec.root);
    });
    cellEls = state.cells.map(buildCellEl);

    if (camera) {
      var r = ensureRenderer();
      if (r) { r.rotX = camera.rotX; r.rotY = camera.rotY; r.distance = camera.distance; }
    }
    setActiveCell(Math.min(state.activeCell, state.cells.length - 1));
    syncCellControls();
    syncSliders();
    updateStackNote();
    requestAnimationFrame(renderAll);
  }

  function buildCellEl(cell, i) {
    var root = document.createElement("section");
    root.className = "vp" + (cell.plane === "vr" ? " vp-3d" : "");
    root.dataset.cell = String(i);

    var canvas = mk("canvas", "vp-canvas");
    var cross = mk("canvas", "vp-cross");
    var tl = mk("div", "vp-overlay vp-tl"), tr = mk("div", "vp-overlay vp-tr");
    var bl = mk("div", "vp-overlay vp-bl"), br = mk("div", "vp-overlay vp-br");

    var bar = mk("div", "vp-bar");
    var planeSel = mk("select", "vp-plane");
    planeSel.title = "Which view this pane shows";
    ["axial", "coronal", "sagittal", "vr"].forEach(function (p) {
      var o = document.createElement("option");
      o.value = p; o.textContent = PLANE_LABELS[p];
      planeSel.appendChild(o);
    });
    planeSel.value = cell.plane;
    bar.appendChild(planeSel);

    var wlSel = null, linkBtn = null, slider = null;
    if (cell.plane !== "vr") {
      wlSel = mk("select", "vp-wl");
      wlSel.title = "Window for this pane";
      var g = document.createElement("option");
      g.value = ""; g.textContent = "W/L: global";
      wlSel.appendChild(g);
      Object.keys(PRESETS).forEach(function (key) {
        var o = document.createElement("option");
        o.value = key; o.textContent = PRESETS[key].label || key;
        wlSel.appendChild(o);
      });
      bar.appendChild(wlSel);

      linkBtn = mk("button", "vp-link");
      linkBtn.type = "button";
      bar.appendChild(linkBtn);

      slider = document.createElement("input");
      slider.type = "range"; slider.className = "vp-slider";
      slider.min = "0"; slider.max = "0"; slider.value = "0"; slider.step = "1";
    }

    root.appendChild(canvas);
    root.appendChild(tl); root.appendChild(tr); root.appendChild(bl); root.appendChild(br);
    root.appendChild(bar);
    root.appendChild(cross);
    if (slider) root.appendChild(slider);

    var empty = null;
    if (cell.plane === "vr") {
      empty = mk("div", "vp-empty");
      empty.innerHTML = "3D volume rendering<br /><span class='muted small'>needs a multi-slice series</span>";
      root.appendChild(empty);
    }

    dom.viewGrid.insertBefore(root, dom.viewportEmpty);

    var rec = {
      root: root, canvas: canvas, cross: cross, tl: tl, tr: tr, bl: bl, br: br,
      bar: bar, planeSel: planeSel, wlSel: wlSel, linkBtn: linkBtn, slider: slider,
      empty: empty, geom: null,
      // A 2D context on the 3D pane's canvas would lock WebGL out of it.
      ctx: cell.plane === "vr" ? null : canvas.getContext("2d"),
    };
    wireCell(i, rec);
    return rec;
  }

  function mk(tag, className) {
    var el = document.createElement(tag);
    el.className = className;
    return el;
  }

  /** Point a pane at a different view. */
  function setCellPlane(i, plane) {
    var cell = state.cells[i];
    if (!cell || cell.plane === plane) return;
    cell.plane = plane;
    cell.pinned = false;
    cell.offset = 0;
    if (plane === "vr") enforceSingleVR(i);
    restack();
    planeCacheTrim();
    rebuildCells();
  }

  /** Push pane state back into its controls. */
  function syncCellControls() {
    state.cells.forEach(function (cell, i) {
      var rec = cellEls[i];
      if (!rec) return;
      if (rec.planeSel) rec.planeSel.value = cell.plane;
      if (rec.wlSel) rec.wlSel.value = cell.wl && cell.wl.preset ? cell.wl.preset : "";
      if (rec.linkBtn) {
        rec.linkBtn.textContent = "📌";
        rec.linkBtn.title = cell.pinned
          ? "Pinned to slice " + (cell.index + 1) + " — click to rejoin the stack"
          : "Scrolling with the stack" +
            (cell.offset ? " at +" + cell.offset + " slices" : "") +
            " — click to pin this slice";
        rec.linkBtn.classList.toggle("on", !!cell.pinned);
      }
    });
  }

  function byId(id) { return document.getElementById(id); }

  function showToast(message, isError) {
    dom.toast.textContent = message;
    dom.toast.classList.toggle("error", !!isError);
    dom.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { dom.toast.hidden = true; }, 3600);
  }

  function setStatus(text) { dom.statusText.textContent = text; }

  function setBusy(on, text) {
    dom.busyText.textContent = text || "Working…";
    dom.busy.hidden = !on;
  }

  /** Let the browser paint before starting a long synchronous job. */
  function afterPaint(fn) {
    requestAnimationFrame(function () { requestAnimationFrame(fn); });
  }

  /* ---------------------------------------------------------------------
   * DICOM tag helpers
   * ------------------------------------------------------------------- */
  function str(dataSet, tag, fallback) {
    var v = dataSet.string(tag);
    return v === undefined || v === null || v === "" ? fallback : v;
  }
  function num(dataSet, tag, fallback) {
    var el = dataSet.elements[tag];
    if (!el) return fallback;
    var v = dataSet.floatString(tag, 0);
    return isNaN(v) ? fallback : v;
  }
  function uint16(dataSet, tag, fallback) {
    var v = dataSet.uint16(tag);
    return v === undefined ? fallback : v;
  }
  function formatPersonName(pn) {
    if (!pn) return "";
    return pn.split("^").filter(function (s) { return s.length > 0; }).join(" ").trim() || pn;
  }
  function formatDicomDate(d) {
    if (!d || d.length < 8) return d || "";
    return d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8);
  }

  /**
   * Whether this instance's rescaled values can honestly be called
   * Hounsfield Units. CT with an explicit HU Rescale Type is unambiguous;
   * CT with a rescale slope/intercept but no Rescale Type is the common
   * real-world case and is accepted. Anything else reports plain values.
   */
  function huUnitOf(instance) {
    var type = (instance.rescaleType || "").toUpperCase().trim();
    if (type === "HU") return "HU";
    if (type && type !== "US") return type;           // e.g. OD, MGML
    if (instance.modality === "CT") return "HU";
    return "";                                        // unitless stored value
  }

  /** Label for intensity readouts, honest about unknown units. */
  function intensityUnit() {
    var group = getCurrentGroup();
    if (!group || !group.slices.length) return "";
    return huUnitOf(group.slices[0].instance);
  }

  // A Window Center of 0 is a legitimate value, so these can't use `||`.
  function wwOf(instance) {
    var v = instance.fileWW;
    return v != null && isFinite(v) && v > 0 ? v : 400;
  }
  function wcOf(instance) {
    var v = instance.fileWC;
    return v != null && isFinite(v) ? v : 40;
  }

  /* ---------------------------------------------------------------------
   * Parsing a File into an "instance" record
   * ------------------------------------------------------------------- */
  function parseFile(file, arrayBuffer) {
    var byteArray = new Uint8Array(arrayBuffer);
    var dataSet = dicomParser.parseDicom(byteArray);

    var transferSyntax = str(dataSet, "x00020010", "1.2.840.10008.1.2.1");
    var syntaxKind = UNCOMPRESSED_TRANSFER_SYNTAXES[transferSyntax];

    var rows = uint16(dataSet, "x00280010", 0);
    var columns = uint16(dataSet, "x00280011", 0);

    // Pixel Spacing is what makes millimetre measurements legitimate; track
    // whether it was actually present rather than silently defaulting to 1.
    var pixelSpacingRow = 1, pixelSpacingCol = 1;
    var hasPixelSpacing = false;
    if (dataSet.elements.x00280030) {
      var psr = num(dataSet, "x00280030", NaN);
      var psc = dataSet.floatString("x00280030", 1);
      if (isFinite(psr) && psr > 0) {
        pixelSpacingRow = psr;
        pixelSpacingCol = isFinite(psc) && psc > 0 ? psc : psr;
        hasPixelSpacing = true;
      }
    }

    // Image Orientation (Patient): row and column direction cosines.
    var orientation = null;
    if (dataSet.elements.x00200037) {
      var o = [];
      for (var oi = 0; oi < 6; oi++) o.push(dataSet.floatString("x00200037", oi));
      if (o.every(function (v) { return isFinite(v); })) orientation = o;
    }

    var instanceNumber = parseInt(str(dataSet, "x00200013", ""), 10);
    var sliceLocation = parseFloat(str(dataSet, "x00201041", ""));
    var imagePositionZ = NaN;
    if (dataSet.elements.x00200032) {
      var z = dataSet.floatString("x00200032", 2);
      if (!isNaN(z)) imagePositionZ = z;
    }

    return {
      file: file,
      fileName: file.name,
      dataSet: dataSet,
      byteArray: byteArray,
      transferSyntax: transferSyntax,
      syntaxKind: syntaxKind,
      pixelDataElement: dataSet.elements.x7fe00010,

      rows: rows,
      columns: columns,
      bitsAllocated: uint16(dataSet, "x00280100", 16),
      pixelRepresentation: uint16(dataSet, "x00280103", 0),
      samplesPerPixel: uint16(dataSet, "x00280002", 1),
      photometric: str(dataSet, "x00280004", "MONOCHROME2"),
      numberOfFrames: parseInt(str(dataSet, "x00280008", "1"), 10) || 1,
      planarConfiguration: uint16(dataSet, "x00280006", 0),

      rescaleSlope: num(dataSet, "x00281053", 1),
      rescaleIntercept: num(dataSet, "x00281052", 0),
      rescaleType: str(dataSet, "x00281054", ""),
      fileWW: num(dataSet, "x00281051", null),
      fileWC: num(dataSet, "x00281050", null),
      pixelSpacingRow: pixelSpacingRow,
      pixelSpacingCol: pixelSpacingCol,
      hasPixelSpacing: hasPixelSpacing,
      sliceThickness: num(dataSet, "x00180050", null),
      imageOrientation: orientation,
      frameOfReferenceUID: str(dataSet, "x00200052", ""),

      instanceNumber: isNaN(instanceNumber) ? null : instanceNumber,
      sliceLocation: isNaN(sliceLocation) ? null : sliceLocation,
      imagePositionZ: isNaN(imagePositionZ) ? null : imagePositionZ,

      studyUID: str(dataSet, "x0020000d", "(no study UID)"),
      studyDescription: str(dataSet, "x00081030", ""),
      studyDate: str(dataSet, "x00080020", ""),
      seriesUID: str(dataSet, "x0020000e", file.name),
      seriesNumber: parseInt(str(dataSet, "x00200011", ""), 10),
      seriesDescription: str(dataSet, "x0008103e", ""),
      modality: str(dataSet, "x00080060", ""),
      sopInstanceUID: str(dataSet, "x00080018", ""),

      _frameCache: {},
    };
  }

  /* ---------------------------------------------------------------------
   * Pixel decoding: raw stored values -> real-world (rescaled) values
   * ------------------------------------------------------------------- */
  function decodeFrameRealValues(instance, frameIndex) {
    var cached = instance._frameCache[frameIndex];
    if (cached) return cached;

    if (!instance.syntaxKind) {
      throw new Error(
        "Unsupported transfer syntax (" + instance.transferSyntax + "). " +
        "This viewer supports uncompressed DICOM only. Re-export as " +
        "Explicit/Implicit VR Little Endian, or convert with dcm2niix/GDCM first."
      );
    }
    if (!instance.pixelDataElement) throw new Error("File has no Pixel Data element.");

    var rows = instance.rows, cols = instance.columns;
    var samplesPerPixel = instance.samplesPerPixel;
    var bytesPerSample = instance.bitsAllocated <= 8 ? 1 : 2;
    var pixelsPerFrame = rows * cols * samplesPerPixel;
    var bytesPerFrame = pixelsPerFrame * bytesPerSample;

    var baseOffset = instance.pixelDataElement.dataOffset + frameIndex * bytesPerFrame;
    var buffer = instance.byteArray.buffer;
    var byteOffset = instance.byteArray.byteOffset + baseOffset;

    var raw;
    if (bytesPerSample === 1) {
      raw = new Uint8Array(buffer, byteOffset, pixelsPerFrame);
    } else if (instance.syntaxKind === "explicit-big-endian") {
      // Rare (retired in modern DICOM) — byte-swap explicitly.
      var swapped = new Uint16Array(pixelsPerFrame);
      var dv = new DataView(buffer, byteOffset, pixelsPerFrame * 2);
      for (var i = 0; i < pixelsPerFrame; i++) swapped[i] = dv.getUint16(i * 2, false);
      raw = instance.pixelRepresentation === 1 ? new Int16Array(swapped.buffer) : swapped;
    } else if (instance.pixelRepresentation === 1) {
      raw = new Int16Array(buffer, byteOffset, pixelsPerFrame);
    } else {
      raw = new Uint16Array(buffer, byteOffset, pixelsPerFrame);
    }

    var out = new Float32Array(rows * cols);
    var slope = instance.rescaleSlope, intercept = instance.rescaleIntercept;
    if (samplesPerPixel >= 3) {
      for (var p = 0; p < rows * cols; p++) {
        var r = raw[p * samplesPerPixel], g = raw[p * samplesPerPixel + 1], b = raw[p * samplesPerPixel + 2];
        out[p] = (0.299 * r + 0.587 * g + 0.114 * b) * slope + intercept;
      }
    } else {
      for (var j = 0; j < out.length; j++) out[j] = raw[j] * slope + intercept;
    }

    var min = Infinity, max = -Infinity;
    for (var k = 0; k < out.length; k++) {
      if (out[k] < min) min = out[k];
      if (out[k] > max) max = out[k];
    }

    var result = { values: out, min: min, max: max };
    instance._frameCache[frameIndex] = result;
    return result;
  }

  /** Decode helper shaped for the volume builder. */
  function decodeForVolume(instance, frameIndex) {
    return decodeFrameRealValues(instance, frameIndex).values;
  }

  /* ---------------------------------------------------------------------
   * Windowing: real values -> grayscale canvas
   * ------------------------------------------------------------------- */
  function windowToCanvas(values, width, height, ww, wc, invert, monochrome1) {
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext("2d");
    var imageData = ctx.createImageData(width, height);
    var data = imageData.data;

    var widthSafe = ww <= 0 ? 1 : ww;
    var lower = wc - widthSafe / 2;
    var scale = 255 / widthSafe;

    for (var i = 0, n = values.length; i < n; i++) {
      var v = values[i];
      var g;
      if (v <= lower) g = 0;
      else if (v >= lower + widthSafe) g = 255;
      else g = (v - lower) * scale;

      // MONOCHROME1 is inherently "0 = white"; invert unless the user has
      // already toggled invert (the double negative cancels out).
      if (monochrome1) g = 255 - g;
      if (invert) g = 255 - g;

      var idx = i * 4;
      data[idx] = data[idx + 1] = data[idx + 2] = g;
      data[idx + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  function buildWindowedCanvas(instance, frameIndex, ww, wc, invert) {
    var decoded = decodeFrameRealValues(instance, frameIndex);
    return windowToCanvas(
      decoded.values, instance.columns, instance.rows,
      ww, wc, invert, instance.photometric === "MONOCHROME1"
    );
  }

  /* ---------------------------------------------------------------------
   * Series management
   * ------------------------------------------------------------------- */
  function addInstance(instance) {
    var group = state.seriesMap[instance.seriesUID];
    if (!group) {
      group = {
        uid: instance.seriesUID,
        studyUID: instance.studyUID,
        studyDescription: instance.studyDescription,
        studyDate: instance.studyDate,
        seriesNumber: isNaN(instance.seriesNumber) ? null : instance.seriesNumber,
        description: instance.seriesDescription || "(no series description)",
        modality: instance.modality || "",
        instances: [],
        seenSopUids: {},
      };
      state.seriesMap[instance.seriesUID] = group;
      state.seriesOrder.push(instance.seriesUID);
    }
    // Opening the same folder twice shouldn't double the stack.
    var key = instance.sopInstanceUID;
    if (key) {
      if (group.seenSopUids[key]) {
        state.duplicateCount++;
        return;
      }
      group.seenSopUids[key] = true;
    }
    group.instances.push(instance);
  }

  /** Series grouped under their Study, in load order. */
  function studyGroups() {
    var studies = [], byUid = {};
    state.seriesOrder.forEach(function (uid) {
      var group = state.seriesMap[uid];
      var sUid = group.studyUID || "(no study UID)";
      if (!byUid[sUid]) {
        byUid[sUid] = {
          uid: sUid,
          description: group.studyDescription || "",
          date: group.studyDate || "",
          series: [],
        };
        studies.push(byUid[sUid]);
      }
      byUid[sUid].series.push(group);
    });
    studies.forEach(function (s) {
      s.series.sort(function (a, b) {
        if (a.seriesNumber != null && b.seriesNumber != null && a.seriesNumber !== b.seriesNumber) {
          return a.seriesNumber - b.seriesNumber;
        }
        return 0;
      });
    });
    return studies;
  }

  function sortSeriesInstances(group) {
    group.instances.sort(function (a, b) {
      if (a.imagePositionZ !== null && b.imagePositionZ !== null && a.imagePositionZ !== b.imagePositionZ) {
        return a.imagePositionZ - b.imagePositionZ;
      }
      if (a.sliceLocation !== null && b.sliceLocation !== null && a.sliceLocation !== b.sliceLocation) {
        return a.sliceLocation - b.sliceLocation;
      }
      if (a.instanceNumber !== null && b.instanceNumber !== null && a.instanceNumber !== b.instanceNumber) {
        return a.instanceNumber - b.instanceNumber;
      }
      return a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0;
    });
  }

  function expandMultiFrame(group) {
    var expanded = [];
    group.instances.forEach(function (inst) {
      for (var f = 0; f < inst.numberOfFrames; f++) expanded.push({ instance: inst, frameIndex: f });
    });
    group.slices = expanded;
  }

  function getCurrentGroup() {
    return state.currentSeriesUID ? state.seriesMap[state.currentSeriesUID] : null;
  }

  /* ---------------------------------------------------------------------
   * Loading
   * ------------------------------------------------------------------- */
  function loadFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;

    var pending = files.length, loaded = 0, skipped = 0, firstNewSeriesUID = null;
    setBusy(true, "Reading " + files.length + " file" + (files.length === 1 ? "" : "s") + "…");

    files.forEach(function (file) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var instance = parseFile(file, reader.result);
          if (firstNewSeriesUID === null) firstNewSeriesUID = instance.seriesUID;
          addInstance(instance);
          loaded++;
        } catch (err) {
          skipped++;
        } finally {
          if (--pending === 0) onAllFilesProcessed(loaded, skipped, firstNewSeriesUID);
        }
      };
      reader.onerror = function () {
        skipped++;
        if (--pending === 0) onAllFilesProcessed(loaded, skipped, firstNewSeriesUID);
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function onAllFilesProcessed(loaded, skipped, firstNewSeriesUID) {
    state.seriesOrder.forEach(function (uid) {
      var group = state.seriesMap[uid];
      sortSeriesInstances(group);
      expandMultiFrame(group);
    });

    setBusy(false);
    if (!loaded) {
      showToast("Couldn't read any DICOM files from the selection.", true);
      return;
    }

    renderSeriesList();
    var parts = [loaded + " image" + (loaded === 1 ? "" : "s") + " loaded"];
    if (skipped) parts.push(skipped + " skipped (not readable DICOM)");
    if (state.duplicateCount) parts.push(state.duplicateCount + " duplicate(s) ignored");
    showToast(parts.join(", ") + ".");

    if (!state.currentSeriesUID) selectSeries(firstNewSeriesUID || state.seriesOrder[0]);
    else renderSeriesList();
  }

  /* ---------------------------------------------------------------------
   * Series list UI
   * ------------------------------------------------------------------- */
  function renderSeriesList() {
    dom.dropHint.style.display = state.seriesOrder.length ? "none" : "block";

    Object.keys(seriesNodes).forEach(function (uid) {
      if (state.seriesMap[uid]) return;
      var stale = seriesNodes[uid].wrapper;
      if (stale.parentNode) stale.parentNode.removeChild(stale);
      delete seriesNodes[uid];
    });

    var studies = studyGroups();
    var showStudyHeaders = studies.length > 1 || (studies[0] && studies[0].description);

    studies.forEach(function (study) {
      if (showStudyHeaders) {
        var headerId = "study-" + study.uid;
        if (!seriesNodes[headerId]) {
          var head = document.createElement("div");
          head.className = "study-header";
          head.innerHTML =
            "<span>" + escapeHtml(study.description || "Study") + "</span>" +
            '<span class="study-date">' + escapeHtml(formatDicomDate(study.date)) + "</span>";
          dom.seriesList.appendChild(head);
          seriesNodes[headerId] = { wrapper: head, sliceCount: -1 };
        }
      }

      study.series.forEach(function (group) {
        var uid = group.uid;
        var cached = seriesNodes[uid];
        if (cached && cached.sliceCount === group.slices.length) {
          cached.wrapper.classList.toggle("active", uid === state.currentSeriesUID);
          return;
        }
        var wrapper = buildSeriesNode(group, uid);
        if (cached && cached.wrapper.parentNode) dom.seriesList.replaceChild(wrapper, cached.wrapper);
        else dom.seriesList.appendChild(wrapper);
        seriesNodes[uid] = { wrapper: wrapper, sliceCount: group.slices.length };
      });
    });
  }

  function buildSeriesNode(group, uid) {
    var wrapper = document.createElement("div");
    wrapper.className = "series-group" + (uid === state.currentSeriesUID ? " active" : "");

    var header = document.createElement("div");
    header.className = "series-header";
    header.innerHTML =
      "<span>" + escapeHtml(group.modality ? group.modality + " — " : "") +
      escapeHtml(group.description) + "</span>" +
      '<span class="series-count">' + group.slices.length + "</span>";
    header.addEventListener("click", function () { selectSeries(uid); });
    wrapper.appendChild(header);

    if (group.slices.length <= MAX_SERIES_FOR_THUMBNAILS) {
      var grid = document.createElement("div");
      grid.className = "thumb-grid";
      wrapper.appendChild(grid);
      buildThumbnailsAsync(group, grid, uid);
    }
    return wrapper;
  }

  function buildThumbnailsAsync(group, grid, uid) {
    var i = 0;
    function step() {
      var batchEnd = Math.min(i + 4, group.slices.length);
      for (; i < batchEnd; i++) {
        (function (index) {
          var slice = group.slices[index];
          var thumb = document.createElement("div");
          thumb.className = "thumb";
          thumb.title = "Slice " + (index + 1);
          thumb.dataset.uid = uid;
          thumb.dataset.index = String(index);
          try {
            thumb.appendChild(buildWindowedCanvas(
              slice.instance, slice.frameIndex, wwOf(slice.instance), wcOf(slice.instance), false
            ));
          } catch (err) {
            thumb.textContent = "⚠";
          }
          var idxLabel = document.createElement("span");
          idxLabel.className = "thumb-idx";
          idxLabel.textContent = String(index + 1);
          thumb.appendChild(idxLabel);
          thumb.addEventListener("click", function () {
            if (uid !== state.currentSeriesUID) selectSeries(uid);
            setPlaneIndex("axial", index);
          });
          grid.appendChild(thumb);
        })(i);
      }
      if (i < group.slices.length) setTimeout(step, 0);
    }
    step();
  }

  function highlightActiveThumb() {
    var previous = dom.seriesList.querySelector(".thumb.active");
    if (previous) previous.classList.remove("active");
    if (!state.currentSeriesUID) return;
    var sel = '.thumb[data-uid="' + cssEscape(state.currentSeriesUID) + '"][data-index="' + state.index.axial + '"]';
    var current = dom.seriesList.querySelector(sel);
    if (current) {
      current.classList.add("active");
      if (current.scrollIntoView) current.scrollIntoView({ block: "nearest" });
    }
  }

  function cssEscape(value) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------------------------------------------------------------
   * Selecting a series -> build the volume
   * ------------------------------------------------------------------- */
  function selectSeries(uid) {
    state.currentSeriesUID = uid;
    var group = getCurrentGroup();
    if (!group || !group.slices.length) return;

    var first = group.slices[0].instance;
    state.windowWidth = wwOf(first);
    state.windowCenter = wcOf(first);
    dom.presetSelect.value = "";

    state.volume = null;
    planeCache = {}; planeCacheKeys = [];
    vrDirty = true;
    renderSeriesList();

    setBusy(true, "Reconstructing volume from " + group.slices.length + " slices…");
    afterPaint(function () {
      try {
        state.volume = group.slices.length >= 2 ? V.build(group.slices, decodeForVolume) : null;
      } catch (err) {
        state.volume = null;
        showToast("Couldn't build a volume: " + err.message, true);
      }

      if (state.volume) {
        // Start at the middle of each axis, which is where anatomy usually is.
        MPR_PLANES.forEach(function (plane) {
          state.index[plane] = Math.floor(V.planeCount(state.volume, plane) / 2);
        });
        if (state.boneCut) recomputeBoneMask();
      }

      resetView();
      clearMeasurements();
      setBusy(false);
      updateVolumeInfo();
      updateObliqueInfo();
      updateGeometryWarnings();
      updateCalibrationNote();
      syncSliders();
      renderAll();
      highlightActiveThumb();
      setStatus(state.volume
        ? "Volume " + state.volume.cols + "×" + state.volume.rows + "×" + state.volume.depth +
          " · " + fmt(state.volume.spacingZ) + "mm slices"
        : "Single-slice series — MPR and 3D need a stack.");
    });
  }

  /* ---------------------------------------------------------------------
   * Bone segmentation
   * ------------------------------------------------------------------- */
  function recomputeBoneMask() {
    if (!state.volume) return;
    V.computeBoneMask(state.volume, state.boneThreshold, 2);
    state.boneMaskVersion++;
    planeCache = {}; planeCacheKeys = [];
    vrDirty = true;
  }

  /* ---------------------------------------------------------------------
   * MPR rendering
   * ------------------------------------------------------------------- */

  /* ---------------------------------------------------------------------
   * Oblique reslicing frames
   * ------------------------------------------------------------------- */

  function resetFrames() {
    state.frames = {
      axial: cloneFrame(BASE_FRAMES.axial),
      coronal: cloneFrame(BASE_FRAMES.coronal),
      sagittal: cloneFrame(BASE_FRAMES.sagittal),
    };
  }

  function cloneFrame(f) {
    return { u: f.u.slice(), v: f.v.slice(), n: f.n.slice() };
  }

  function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  /** Angle, in degrees, between a plane's current cut and its resting one. */
  function tiltOf(plane) {
    var d = Math.abs(dot3(state.frames[plane].n, BASE_FRAMES[plane].n));
    return (Math.acos(Math.min(1, d)) * 180) / Math.PI;
  }

  /** True when this plane's own cut has been tilted off the volume axes. */
  function planeOblique(plane) {
    var f = state.frames[plane], b = BASE_FRAMES[plane];
    return Math.abs(dot3(f.n, b.n) - 1) > 1e-9 || Math.abs(dot3(f.u, b.u) - 1) > 1e-9;
  }

  /** True once any plane has been tilted off its resting orientation. */
  function obliqueActive() {
    return MPR_PLANES.some(planeOblique);
  }

  /**
   * Rotate the *other* two planes about this plane's normal.
   *
   * Leaving the acting plane's own frame alone is what makes the interaction
   * read correctly: the image you are dragging on holds still while its
   * crosshair arms — the intersection lines of the companion planes — swing
   * round, and those companion cuts tilt to follow.
   */
  function rotateOblique(plane, theta) {
    if (!theta) return;
    var f = state.frames[plane];
    var axis = V.cross(f.u, f.v);
    MPR_PLANES.forEach(function (other) {
      if (other === plane) return;
      var g = state.frames[other];
      state.frames[other] = V.orthonormalize({
        u: V.rotateAbout(g.u, axis, theta),
        v: V.rotateAbout(g.v, axis, theta),
        n: V.rotateAbout(g.n, axis, theta),
      });
    });
    planeCache = {}; planeCacheKeys = [];
  }

  /** Pointer angle about the crosshair, in this plane's own u/v basis. */
  function obliqueAngleAt(i, clientX, clientY) {
    var rec = cellEls[i], geom = rec && rec.geom;
    if (!state.volume || !geom) return null;
    var p = eventToCell(i, clientX, clientY);
    if (!p) return null;
    var slab = geom.slab;
    var a = (p.x - slab.width / 2) * slab.spacingX;
    var b = (p.y - slab.height / 2) * slab.spacingY;
    if (!a && !b) return null;
    return Math.atan2(b, a);
  }

  function resetOblique() {
    resetFrames();
    planeCache = {}; planeCacheKeys = [];
    renderAll();
  }

  /* ---------------------------------------------------------------------
   * Plane <-> world (millimetre) geometry
   *
   * The three slice indices address a single point in the volume: each one
   * measures a distance along its own plane's normal, and those normals stay
   * mutually orthogonal however the frames are tilted.
   * ------------------------------------------------------------------- */

  function volumeCenterMm() {
    var v = state.volume;
    return [
      ((v.cols - 1) / 2) * v.spacingX,
      ((v.rows - 1) / 2) * v.spacingY,
      ((v.depth - 1) / 2) * v.spacingZ,
    ];
  }

  /** Signed distance of a plane's cut from the volume centre, in mm. */
  function planeOffsetMm(plane) {
    var count = V.planeCount(state.volume, plane);
    return (state.index[plane] - (count - 1) / 2) * V.normalSpacing(state.volume, plane);
  }

  /** The crosshair point — where all three cuts meet — in millimetres. */
  function crosshairWorld() {
    var c = volumeCenterMm();
    MPR_PLANES.forEach(function (plane) {
      var n = state.frames[plane].n;
      var off = planeOffsetMm(plane);
      c[0] += n[0] * off; c[1] += n[1] * off; c[2] += n[2] * off;
    });
    return c;
  }

  /** Inverse of crosshairWorld: nearest slice index on each plane. */
  function indicesFromWorld(w) {
    var vc = volumeCenterMm();
    var d = [w[0] - vc[0], w[1] - vc[1], w[2] - vc[2]];
    var out = {};
    MPR_PLANES.forEach(function (plane) {
      var count = V.planeCount(state.volume, plane);
      var pitch = V.normalSpacing(state.volume, plane);
      out[plane] = Math.round(dot3(d, state.frames[plane].n) / pitch + (count - 1) / 2);
    });
    return out;
  }

  /** World centre of a rendered plane. */
  function planeCenterWorld(plane, slab, index) {
    if (slab && slab.oblique) return slab.center;
    if (index === undefined || index === null) index = state.index[plane];
    var c = volumeCenterMm();
    var n = state.frames[plane].n;
    var count = V.planeCount(state.volume, plane);
    var off = (index - (count - 1) / 2) * V.normalSpacing(state.volume, plane);
    return [c[0] + n[0] * off, c[1] + n[1] * off, c[2] + n[2] * off];
  }

  function planeAxesOf(plane, slab) {
    if (slab && slab.oblique) return { u: slab.axisU, v: slab.axisV };
    return state.frames[plane];
  }

  /** Plane column/row -> millimetres. Valid for orthogonal and oblique alike. */
  function planeToWorld(plane, slab, px, py, index) {
    var f = planeAxesOf(plane, slab);
    var c = planeCenterWorld(plane, slab, index);
    var a = (px - slab.width / 2) * slab.spacingX;
    var b = (py - slab.height / 2) * slab.spacingY;
    return [
      c[0] + f.u[0] * a + f.v[0] * b,
      c[1] + f.u[1] * a + f.v[1] * b,
      c[2] + f.u[2] * a + f.v[2] * b,
    ];
  }

  /** Millimetres -> plane column/row (the in-plane part; exact inverse). */
  function worldToPlane(plane, slab, w, index) {
    var f = planeAxesOf(plane, slab);
    var c = planeCenterWorld(plane, slab, index);
    var d = [w[0] - c[0], w[1] - c[1], w[2] - c[2]];
    return {
      x: dot3(d, f.u) / slab.spacingX + slab.width / 2,
      y: dot3(d, f.v) / slab.spacingY + slab.height / 2,
    };
  }

  /**
   * Extract a plane, memoised so W/L drags don't re-slice the volume.
   *
   * `index` defaults to the shared cut, but unlinked panes ask for their own,
   * so the cache is keyed on the whole request and bounded rather than being
   * one slot per plane.
   */
  function getPlaneData(plane, index) {
    if (index === undefined || index === null) index = state.index[plane];
    // Decided per plane: rotating in the axial view tilts coronal and
    // sagittal but leaves axial square, so axial keeps the fast path and its
    // full in-plane resolution.
    var oblique = planeOblique(plane);
    var frame = state.frames[plane];
    var key = [
      plane, index, state.thicknessMm, state.projectionMode,
      state.boneCut ? "cut" + state.boneMaskVersion : "raw",
      oblique ? frameKey(frame) + "|" + state.index.axial + "," +
        state.index.coronal + "," + state.index.sagittal : "ortho",
    ].join("|");

    if (planeCache[key]) return planeCache[key];

    var opts = {
      thicknessMm: state.thicknessMm,
      mode: state.projectionMode,
      boneCut: state.boneCut,
    };
    // The axis-aligned path is a plain blit, so keep using it while the frames
    // are at rest; only a genuine tilt pays for trilinear resampling.
    var result = oblique
      ? V.extractOblique(state.volume, obliqueCenterFor(plane, index), frame.u, frame.v, opts)
      : V.extractPlane(state.volume, plane, index, opts);

    planeCache[key] = result;
    planeCacheKeys.push(key);
    planeCacheTrim();
    return result;
  }

  /** Keep the reslice cache to a handful of panes' worth of planes. */
  function planeCacheTrim() {
    var limit = Math.max(8, state.cells.length * 2);
    while (planeCacheKeys.length > limit) {
      delete planeCache[planeCacheKeys.shift()];
    }
  }

  /**
   * Centre of an oblique cut. The crosshair fixes where the three planes
   * meet; an unlinked pane slides from there along its own normal.
   */
  function obliqueCenterFor(plane, index) {
    var c = crosshairWorld();
    var delta = (index - state.index[plane]) * V.normalSpacing(state.volume, plane);
    if (!delta) return c;
    var nv = state.frames[plane].n;
    return [c[0] + nv[0] * delta, c[1] + nv[1] * delta, c[2] + nv[2] * delta];
  }

  function frameKey(f) {
    return f.u.concat(f.v).map(function (x) { return x.toFixed(6); }).join(",");
  }

  function renderAll() {
    var hasVolume = !!state.volume;
    dom.viewportEmpty.style.display = hasVolume || getCurrentGroup() ? "none" : "flex";

    state.cells.forEach(function (cell, i) {
      if (cell.plane === "vr") renderVRCell(i);
      else renderCell(i);
    });
    updateObliqueInfo();
    updateMetadata();
  }

  function renderCell(i) {
    var cell = state.cells[i], rec = cellEls[i];
    if (!cell || !rec || !rec.ctx) return;
    var ctx = rec.ctx;
    resizeCanvas(rec.canvas);
    resizeCanvas(rec.cross);

    var cw = rec.canvas.width, ch = rec.canvas.height;
    // A 4x4 grid leaves little room, so the patient banner and the letters
    // step aside rather than covering the image.
    rec.root.classList.toggle("compact", rec.root.clientWidth < 320 || rec.root.clientHeight < 250);

    ctx.save();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cw, ch);

    if (!state.volume) {
      ctx.restore();
      clearOverlays(i);
      rec.geom = null;
      drawAnnotations(i, null);
      return;
    }

    var index = cellIndex(cell);
    var slab = getPlaneData(cell.plane, index);
    var win = cellWindow(cell);
    var img = windowToCanvas(
      slab.data, slab.width, slab.height, win.ww, win.wc, state.invert, false
    );

    var t = planeTransform(cell, slab, cw, ch);

    // Canvas composes right-to-left, so this applies flip, then rotation,
    // then the translate — matching planeToCanvas() exactly.
    ctx.imageSmoothingEnabled = true;
    ctx.translate(t.tx, t.ty);
    ctx.rotate(t.rot);
    ctx.scale(t.flipH ? -1 : 1, t.flipV ? -1 : 1);
    var drawW = t.physW * t.scale, drawH = t.physH * t.scale;
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    rec.geom = { t: t, cw: cw, ch: ch, slab: slab, index: index, plane: cell.plane };
    updateOverlays(i, slab);
    drawAnnotations(i, rec.geom);
  }

  /* ---------------------------------------------------------------------
   * Plane <-> canvas transform
   *
   * Measurements are stored in plane (column/row) coordinates, so the view
   * transform has to be invertible: zooming, panning, rotating or flipping
   * moves the drawing but must not move a measurement off the anatomy.
   * ------------------------------------------------------------------- */
  function planeTransform(cell, slab, cw, ch) {
    var view = cell.view;
    var physW = slab.width * slab.spacingX;
    var physH = slab.height * slab.spacingY;
    var rot = ((view.rotation || 0) * Math.PI) / 180;

    // Fit the *rotated* bounding box so a 90° rotation still fits the pane.
    var c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
    var boundW = physW * c + physH * s;
    var boundH = physW * s + physH * c;
    var scale = Math.min(cw / boundW, ch / boundH) * view.zoom;

    return {
      physW: physW, physH: physH, scale: scale, rot: rot,
      flipH: !!view.flipH, flipV: !!view.flipV,
      tx: cw / 2 + view.panX, ty: ch / 2 + view.panY,
      width: slab.width, height: slab.height,
      spacingX: slab.spacingX, spacingY: slab.spacingY,
    };
  }

  /** Plane column/row -> canvas device pixels. */
  function planeToCanvas(t, px, py) {
    var x = (px - t.width / 2) * t.spacingX;
    var y = (py - t.height / 2) * t.spacingY;
    if (t.flipH) x = -x;
    if (t.flipV) y = -y;
    var cos = Math.cos(t.rot), sin = Math.sin(t.rot);
    return {
      x: t.tx + (x * cos - y * sin) * t.scale,
      y: t.ty + (x * sin + y * cos) * t.scale,
    };
  }

  /** Canvas device pixels -> plane column/row (inverse of the above). */
  function canvasToPlane(t, cx, cy) {
    var rx = (cx - t.tx) / t.scale;
    var ry = (cy - t.ty) / t.scale;
    var cos = Math.cos(-t.rot), sin = Math.sin(-t.rot);
    var x = rx * cos - ry * sin;
    var y = rx * sin + ry * cos;
    if (t.flipH) x = -x;
    if (t.flipV) y = -y;
    return { x: x / t.spacingX + t.width / 2, y: y / t.spacingY + t.height / 2 };
  }

  /** Mouse event -> plane coordinates within a pane. */
  function eventToCell(i, clientX, clientY) {
    var rec = cellEls[i];
    if (!rec || !rec.geom) return null;
    var rect = rec.canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    return canvasToPlane(rec.geom.t, (clientX - rect.left) * dpr, (clientY - rect.top) * dpr);
  }

  function resizeCanvas(canvas) {
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(1, Math.round(rect.width * dpr));
    var h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  /* ---------------------------------------------------------------------
   * Crosshair: shows where the other two planes cut through this one
   * ------------------------------------------------------------------- */

  /**
   * Overlay layer: crosshair, orientation markers and measurements.
   * Drawn on a separate canvas so it can be refreshed without re-windowing
   * the image underneath.
   */
  function drawAnnotations(i, geom) {
    var rec = cellEls[i];
    if (!rec) return;
    var ctx = rec.cross.getContext("2d");
    ctx.clearRect(0, 0, rec.cross.width, rec.cross.height);
    if (!geom || !state.volume) return;

    var dpr = window.devicePixelRatio || 1;
    if (state.crosshair) drawCrosshair(ctx, geom, dpr);
    if (!rec.root.classList.contains("compact")) drawOrientationMarkers(ctx, geom, dpr);
    drawMeasurements(ctx, geom, dpr);
  }

  /**
   * Each arm is the line where a companion plane cuts this one, solved in
   * millimetres rather than read off the slice indices — so it stays correct
   * once the frames are tilted, and reduces to the axis-aligned lines when
   * they are not.
   */
  function crosshairArm(geom, other) {
    var plane = geom.plane;
    var slab = geom.slab;
    var f = planeAxesOf(plane, slab);
    var cp = planeCenterWorld(plane, slab, geom.index);
    var cq = planeCenterWorld(other, null);
    var nq = state.frames[other].n;

    // Points on this plane are cp + u*a + v*b; the companion plane is
    // (W - cq)·nq = 0. Substituting gives a line A*a + B*b + C = 0 in mm.
    var A = dot3(f.u, nq), B = dot3(f.v, nq);
    var C = dot3([cp[0] - cq[0], cp[1] - cq[1], cp[2] - cq[2]], nq);
    var denom = A * A + B * B;
    if (denom < 1e-12) return null;          // parallel: no intersection line

    var a0 = (-C * A) / denom, b0 = (-C * B) / denom;
    var dirA = -B / Math.sqrt(denom), dirB = A / Math.sqrt(denom);
    var reach = Math.hypot(slab.width * slab.spacingX, slab.height * slab.spacingY);

    return {
      at: function (t) {
        var a = a0 + dirA * t * reach, b = b0 + dirB * t * reach;
        return { x: a / slab.spacingX + slab.width / 2, y: b / slab.spacingY + slab.height / 2 };
      },
      centre: { x: a0 / slab.spacingX + slab.width / 2, y: b0 / slab.spacingY + slab.height / 2 },
    };
  }

  function drawCrosshair(ctx, geom, dpr) {
    var t = geom.t;
    var others = MPR_PLANES.filter(function (p) { return p !== geom.plane; });
    var tilted = obliqueActive();

    ctx.save();
    ctx.strokeStyle = "rgba(255, 210, 74, 0.75)";
    ctx.lineWidth = Math.max(1, dpr);
    ctx.setLineDash([6 * dpr, 5 * dpr]);
    ctx.beginPath();
    others.forEach(function (other) {
      var arm = crosshairArm(geom, other);
      if (!arm) return;
      var a = planeToCanvas(t, arm.at(-1).x, arm.at(-1).y);
      var b = planeToCanvas(t, arm.at(1).x, arm.at(1).y);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    });
    ctx.stroke();

    // Rotation handles: only shown once the arms can actually be grabbed,
    // i.e. when a volume is loaded and the crosshair is live.
    var arm0 = crosshairArm(geom, others[0]);
    if (arm0) {
      ctx.setLineDash([]);
      ctx.fillStyle = tilted ? "rgba(110, 242, 160, 0.9)" : "rgba(255, 210, 74, 0.55)";
      [0.72, -0.72].forEach(function (k) {
        var h = arm0.at(k);
        var c = planeToCanvas(t, h.x, h.y);
        ctx.beginPath();
        ctx.arc(c.x, c.y, 4 * dpr, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.restore();
  }

  /**
   * Anatomical direction letters on each edge. They are derived from the
   * plane's patient axes and pushed through the *same* transform as the
   * image, so they stay correct after rotation and flipping.
   */
  function drawOrientationMarkers(ctx, geom, dpr) {
    var labels = orientationLabels(geom.plane);
    if (!labels) return;
    var t = geom.t;

    // Edge midpoints in plane space: left, right, top, bottom. The top edge
    // is inset further so the letter clears the plane-name badge.
    var edges = [
      { p: planeToCanvas(t, 0, t.height / 2), text: labels.left, ax: 1, ay: 0, inset: 14 },
      { p: planeToCanvas(t, t.width, t.height / 2), text: labels.right, ax: -1, ay: 0, inset: 14 },
      { p: planeToCanvas(t, t.width / 2, 0), text: labels.top, ax: 0, ay: 1, inset: 32 },
      { p: planeToCanvas(t, t.width / 2, t.height), text: labels.bottom, ax: 0, ay: -1, inset: 30 },
    ];

    ctx.save();
    ctx.font = "bold " + Math.round(12 * dpr) + "px 'Segoe UI', Roboto, sans-serif";
    ctx.fillStyle = "rgba(216, 240, 255, 0.92)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 3 * dpr;
    edges.forEach(function (e) {
      if (!e.text) return;
      var inset = e.inset * dpr;
      var margin = 14 * dpr;
      var x = Math.max(margin, Math.min(geom.cw - margin, e.p.x + e.ax * inset));
      var y = Math.max(32 * dpr, Math.min(geom.ch - 30 * dpr, e.p.y + e.ay * inset));
      ctx.fillText(e.text, x, y);
    });
    ctx.restore();
  }

  /**
   * Patient-direction letters for each plane edge.
   *
   * The volume is built by stacking slices along the patient Z axis, so the
   * plane axes map onto patient axes directly. Returns null when the source
   * orientation is missing or non-axial, since guessing would be worse than
   * showing nothing.
   */
  function orientationLabels(plane) {
    var group = getCurrentGroup();
    if (!group || !group.slices.length) return null;
    var o = group.slices[0].instance.imageOrientation;
    if (!o) return null;

    // Only label when the acquisition is (near) axial: row along +x, col
    // along +y in patient space.
    var rowIsX = Math.abs(o[0]) > 0.9, colIsY = Math.abs(o[4]) > 0.9;
    if (!rowIsX || !colIsY) return null;

    var rowPos = o[0] > 0 ? "L" : "R";   // increasing column -> patient left
    var rowNeg = o[0] > 0 ? "R" : "L";
    var colPos = o[4] > 0 ? "P" : "A";   // increasing row -> patient posterior
    var colNeg = o[4] > 0 ? "A" : "P";

    // Letters for each volume-axis direction, so an arbitrarily tilted frame
    // can be labelled by projecting its axes onto them.
    var letters = {
      px: rowPos, nx: rowNeg,          // +/- volume X
      py: colPos, ny: colNeg,          // +/- volume Y
      pz: "F", nz: "H",                // +/- slice order: away from / toward the head
    };

    function letterFor(vec) {
      var ax = Math.abs(vec[0]), ay = Math.abs(vec[1]), az = Math.abs(vec[2]);
      var m = Math.max(ax, ay, az);
      // Near 45 degrees between two axes no single letter is honest.
      if (m < 0.75) return "";
      if (m === ax) return vec[0] > 0 ? letters.px : letters.nx;
      if (m === ay) return vec[1] > 0 ? letters.py : letters.ny;
      return vec[2] > 0 ? letters.pz : letters.nz;
    }

    var f = (state.frames && state.frames[plane]) || BASE_FRAMES[plane];
    var neg = function (v) { return [-v[0], -v[1], -v[2]]; };
    return {
      left: letterFor(neg(f.u)), right: letterFor(f.u),
      top: letterFor(neg(f.v)), bottom: letterFor(f.v),
    };
  }

  /** Map a viewport click to indices on the two companion planes. */
  function crosshairFromPoint(i, clientX, clientY) {
    if (!state.volume) return;
    var rec = cellEls[i], geom = rec && rec.geom;
    if (!geom) return;
    var p = eventToCell(i, clientX, clientY);
    if (!p) return;
    var t = geom.t;
    if (p.x < 0 || p.x > t.width || p.y < 0 || p.y > t.height) return;

    // Go through millimetres so the click lands correctly on a tilted plane.
    var world = planeToWorld(geom.plane, geom.slab, p.x, p.y, geom.index);
    var want = indicesFromWorld(world);
    MPR_PLANES.forEach(function (q) {
      if (q === geom.plane) return;    // clicking in-plane must not move this cut
      setPlaneIndex(q, want[q], true);
    });
    renderAll();
    syncSliders();
  }

  /* ---------------------------------------------------------------------
   * Measurements
   * ------------------------------------------------------------------- */

  /** Calibration for a plane, carrying provenance so units stay honest. */
  function calibrationFor(plane, slab) {
    var group = getCurrentGroup();
    var inst = group && group.slices.length ? group.slices[0].instance : null;
    var source = inst && inst.hasPixelSpacing ? "PixelSpacing" : null;
    // Anything that samples across slices — coronal, sagittal, or any oblique
    // cut — also depends on the slice spacing being trustworthy.
    var crossesSlices = plane !== "axial" || (slab && slab.oblique);
    if (source && crossesSlices && !state.volume.spacingZReliable) source = null;
    return MEAS.calibrationOf(slab, source);
  }

  /**
   * Identity of the cut currently shown in a plane.
   *
   * A measurement is anchored to the slice it was drawn on. While the frames
   * are at rest that is just the slice index; once a plane is tilted the cut
   * is defined by its orientation too, so the key carries the frame. Tilting
   * therefore hides measurements taken on the old cut rather than redrawing
   * them over different anatomy.
   */
  function sliceKeyFor(plane, index) {
    if (index === undefined || index === null) index = state.index[plane];
    if (!planeOblique(plane)) return index;
    return "obl:" + index + ":" + state.index.axial + "," + state.index.coronal + "," +
      state.index.sagittal + ":" + frameKey(state.frames[plane]);
  }

  function sliceLabel(m) {
    return typeof m.sliceIndex === "number" ? String(m.sliceIndex + 1) : "obl";
  }

  /** Measurements that belong to the plane/slice currently shown. */
  function measurementsFor(plane, index) {
    var key = sliceKeyFor(plane, index);
    return state.measurements.filter(function (m) {
      return m.plane === plane && m.sliceIndex === key;
    });
  }

  function drawMeasurements(ctx, geom, dpr) {
    var plane = geom.plane;
    var list = measurementsFor(plane, geom.index);
    var pending = state.pendingMeasure && state.pendingMeasure.plane === plane &&
      state.pendingMeasure.sliceIndex === sliceKeyFor(plane, geom.index) ? state.pendingMeasure : null;
    if (!list.length && !pending) return;

    var t = geom.t;
    var cal = calibrationFor(plane, geom.slab);

    ctx.save();
    ctx.lineWidth = Math.max(1.5, 1.5 * dpr);
    ctx.font = Math.round(12 * dpr) + "px 'Segoe UI', Roboto, sans-serif";
    ctx.textBaseline = "bottom";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 3 * dpr;

    list.forEach(function (m) {
      drawOne(m, m.id === state.selectedMeasurement ? "#6ef2a0" : "#4ad6ff", false);
    });
    if (pending) drawOne(pending, "#ffd24a", true);
    ctx.restore();

    function drawOne(m, colour, isPending) {
      var pts = m.points.map(function (p) { return planeToCanvas(t, p.x, p.y); });
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;

      if (m.tool === MEAS.TOOLS.ellipse && pts.length >= 2) {
        // Draw the ellipse through the transform so it rotates with the image.
        var c = planeToCanvas(t, (m.points[0].x + m.points[1].x) / 2, (m.points[0].y + m.points[1].y) / 2);
        var rxPlane = Math.abs(m.points[1].x - m.points[0].x) / 2;
        var ryPlane = Math.abs(m.points[1].y - m.points[0].y) / 2;
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(t.rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, rxPlane * t.spacingX * t.scale, ryPlane * t.spacingY * t.scale, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (pts.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }

      pts.forEach(function (p) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
      });

      if (isPending) return;
      var res = MEAS.evaluate(m, geom.slab, cal);
      var unit = m.tool === MEAS.TOOLS.ellipse ? (" " + intensityUnit()).trimEnd() : "";
      var label = res.primary + unit;
      var anchor = pts[pts.length - 1];
      ctx.fillText(label, anchor.x + 8 * dpr, anchor.y - 6 * dpr);
    }
  }

  /** Handle a click while a measurement tool is active. */
  function measureClick(i, clientX, clientY) {
    var rec = cellEls[i], geom = rec && rec.geom;
    if (!geom) return;
    var p = eventToCell(i, clientX, clientY);
    if (!p) return;
    var need = MEAS.pointsNeeded(state.tool);
    if (!need) return;

    var key = sliceKeyFor(geom.plane, geom.index);
    var pending = state.pendingMeasure;
    if (!pending || pending.plane !== geom.plane || pending.sliceIndex !== key) {
      pending = state.pendingMeasure = MEAS.createMeasurement(state.tool, geom.plane, key, [p]);
      state.measureCell = i;
      renderCellOverlay(i);
      return;
    }

    pending.points.push({ x: p.x, y: p.y });
    if (pending.points.length >= need) {
      state.measurements.push(pending);
      state.selectedMeasurement = pending.id;
      state.pendingMeasure = null;
      renderMeasurementList();
    }
    renderAllOverlays();
  }

  /** Live preview of the in-progress measurement as the mouse moves. */
  function measureHover(i, clientX, clientY) {
    var pending = state.pendingMeasure;
    var geom = cellEls[i] && cellEls[i].geom;
    if (!pending || !geom || pending.plane !== geom.plane) return;
    var p = eventToCell(i, clientX, clientY);
    if (!p) return;
    var need = MEAS.pointsNeeded(state.tool);
    var preview = pending.points.slice(0, need - 1);
    preview.push(p);
    var saved = pending.points;
    pending.points = preview;
    renderCellOverlay(i);
    pending.points = saved;
  }

  /** Redraw just the annotation layer for one pane. */
  function renderCellOverlay(i) {
    var rec = cellEls[i];
    if (rec && rec.geom) drawAnnotations(i, rec.geom);
  }

  function renderAllOverlays() {
    cellEls.forEach(function (rec, i) { if (rec.geom) drawAnnotations(i, rec.geom); });
  }

  /** The slab of a visible pane showing this measurement's cut, if any. */
  function visibleSlabFor(m) {
    for (var i = 0; i < state.cells.length; i++) {
      var rec = cellEls[i], geom = rec && rec.geom;
      if (!geom || geom.plane !== m.plane) continue;
      if (sliceKeyFor(geom.plane, geom.index) === m.sliceIndex) return geom.slab;
    }
    return null;
  }

  function renderMeasurementList() {
    var list = state.measurements;
    if (!list.length) {
      dom.measureList.innerHTML = '<p class="muted small">No measurements yet.</p>';
      return;
    }
    var unit = intensityUnit();
    var html = "";
    list.forEach(function (m) {
      var slab = visibleSlabFor(m);
      var res = slab ? MEAS.evaluate(m, slab, calibrationFor(m.plane, slab)) : null;
      var value = res ? res.primary + (m.tool === MEAS.TOOLS.ellipse && unit ? " " + unit : "") : "—";
      html +=
        '<div class="measure-row' + (m.id === state.selectedMeasurement ? " selected" : "") +
        '" data-id="' + m.id + '">' +
        '<span class="measure-kind">' + toolGlyph(m.tool) + "</span>" +
        '<span class="measure-main">' + escapeHtml(value) +
        (res && res.detail ? '<span class="measure-detail">' + escapeHtml(res.detail) + "</span>" : "") +
        "</span>" +
        '<span class="measure-loc">' + m.plane.slice(0, 3) + " " + sliceLabel(m) + "</span>" +
        '<button class="measure-del" data-del="' + m.id + '" title="Delete">×</button>' +
        "</div>";
    });
    dom.measureList.innerHTML = html;
  }

  function toolGlyph(tool) {
    if (tool === MEAS.TOOLS.distance) return "↔";
    if (tool === MEAS.TOOLS.angle) return "∠";
    if (tool === MEAS.TOOLS.ellipse) return "◯";
    return "•";
  }

  function setTool(tool) {
    state.tool = tool;
    state.pendingMeasure = null;
    Array.prototype.forEach.call(dom.toolSeg.querySelectorAll(".seg-btn"), function (btn) {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    });
    cellEls.forEach(function (rec, i) {
      if (state.cells[i] && state.cells[i].plane !== "vr") {
        rec.root.style.cursor = tool === MEAS.TOOLS.none ? "crosshair" : "cell";
      }
    });
    renderAllOverlays();
  }

  function clearMeasurements() {
    state.measurements = [];
    state.pendingMeasure = null;
    state.selectedMeasurement = null;
    renderMeasurementList();
    renderAllOverlays();
  }

  /* ---------------------------------------------------------------------
   * Overlays
   * ------------------------------------------------------------------- */
  function clearOverlays(i) {
    var rec = cellEls[i];
    if (!rec) return;
    rec.tl.textContent = rec.tr.textContent = rec.bl.textContent = rec.br.textContent = "";
  }

  function updateOverlays(i, slab) {
    var rec = cellEls[i], cell = state.cells[i];
    if (!rec || !cell) return;
    var plane = cell.plane;
    var group = getCurrentGroup();
    var first = group && group.slices.length ? group.slices[0].instance : null;
    var vol = state.volume;

    if (first) {
      var name = formatPersonName(str(first.dataSet, "x00100010", ""));
      var id = str(first.dataSet, "x00100020", "");
      rec.tl.textContent = (name ? name + "\n" : "") + (id ? "ID: " + id : "");
      rec.tr.textContent = (first.modality || "") + "\n" + (group.description || "");
    }

    var win = cellWindow(cell);
    rec.bl.textContent =
      "WW: " + Math.round(win.ww) + "  WL: " + Math.round(win.wc) +
      (cell.wl ? " *" : "") +
      (state.invert ? "  [Inv]" : "") +
      (state.boneCut ? "\nBone cut ≥ " + state.boneThreshold + " HU" : "");

    var count = V.planeCount(vol, plane);
    var pitch = V.normalSpacing(vol, plane);
    var thicknessLabel = slab.samples > 1
      ? fmt(slab.samples * pitch) + "mm " + modeLabel(state.projectionMode)
      : fmt(pitch) + "mm";
    var tilt = tiltOf(plane);
    rec.br.textContent =
      (cellIndex(cell) + 1) + " / " + count +
      (cell.pinned ? "  pinned" : cell.offset ? "  " + (cell.offset > 0 ? "+" : "") + cell.offset : "") +
      "\n" + thicknessLabel +
      (tilt > 0.05 ? "\nOblique " + tilt.toFixed(1) + "°" : "") +
      "\n" + Math.round(cell.view.zoom * 100) + "%";
  }

  function modeLabel(mode) {
    return mode === "mip" ? "MIP" : mode === "minip" ? "MinIP" : "Avg";
  }

  function fmt(v) {
    if (!isFinite(v)) return "—";
    return (Math.round(v * 100) / 100).toString();
  }

  function updateVolumeInfo() {
    var vol = state.volume;
    if (!vol) {
      dom.volumeInfo.innerHTML = '<p class="muted small">No volume built.</p>';
      return;
    }
    var html = "";
    html += metaRow("Dimensions", vol.cols + " × " + vol.rows + " × " + vol.depth);
    html += metaRow("Voxel size", fmt(vol.spacingX) + " × " + fmt(vol.spacingY) + " × " + fmt(vol.spacingZ) + " mm");
    html += metaRow("Extent", fmt(vol.cols * vol.spacingX) + " × " + fmt(vol.rows * vol.spacingY) +
      " × " + fmt(vol.depth * vol.spacingZ) + " mm");
    html += metaRow("HU range", Math.round(vol.minHU) + " … " + Math.round(vol.maxHU));
    if (vol.downsample > 1) html += metaRow("Downsampled", vol.downsample + "× in-plane");
    dom.volumeInfo.innerHTML = html;
  }

  /**
   * A named subset of tags, plus free-text search across everything in the
   * dataset so the panel doubles as a DICOM tag browser.
   */
  var TAG_TABLE = [
    ["Patient", [
      ["x00100010", "Patient Name", formatPersonName],
      ["x00100020", "Patient ID"],
      ["x00100040", "Patient Sex"],
      ["x00101010", "Patient Age"],
    ]],
    ["Study", [
      ["x0020000d", "Study Instance UID"],
      ["x00080020", "Study Date", formatDicomDate],
      ["x00081030", "Study Description"],
      ["x00080050", "Accession Number"],
    ]],
    ["Series", [
      ["x0020000e", "Series Instance UID"],
      ["x00200011", "Series Number"],
      ["x0008103e", "Series Description"],
      ["x00080060", "Modality"],
      ["x00180050", "Slice Thickness"],
      ["x00180088", "Spacing Between Slices"],
    ]],
    ["Image", [
      ["x00080018", "SOP Instance UID"],
      ["x00200013", "Instance Number"],
      ["x00280010", "Rows"],
      ["x00280011", "Columns"],
      ["x00280030", "Pixel Spacing"],
      ["x00200032", "Image Position (Patient)"],
      ["x00200037", "Image Orientation (Patient)"],
      ["x00200052", "Frame of Reference UID"],
    ]],
    ["Pixel Data", [
      ["x00280100", "Bits Allocated"],
      ["x00280101", "Bits Stored"],
      ["x00280103", "Pixel Representation"],
      ["x00280004", "Photometric Interpretation"],
      ["x00280008", "Number of Frames"],
      ["x00281052", "Rescale Intercept"],
      ["x00281053", "Rescale Slope"],
      ["x00281054", "Rescale Type"],
      ["x00281050", "Window Center"],
      ["x00281051", "Window Width"],
      ["x00020010", "Transfer Syntax UID"],
    ]],
  ];

  function updateMetadata() {
    var group = getCurrentGroup();
    if (!group || !group.slices.length) {
      dom.metaTable.innerHTML = '<p class="muted small">No image loaded.</p>';
      return;
    }
    var inst = group.slices[Math.min(state.index.axial, group.slices.length - 1)].instance;
    var ds = inst.dataSet;
    var query = (dom.tagSearch.value || "").trim().toLowerCase();

    var html = "";
    if (query) {
      html += renderTagSearch(ds, query, inst);
    } else {
      TAG_TABLE.forEach(function (section) {
        var rows = "";
        section[1].forEach(function (def) {
          var raw = str(ds, def[0], "");
          if (raw === "") return;
          rows += metaRow(def[1], def[2] ? def[2](raw) : raw);
        });
        if (rows) html += metaSection(section[0]) + rows;
      });
      html += metaSection("Derived");
      html += metaRow("Intensity units", intensityUnit() || "stored values (not HU)");
      html += metaRow("Calibration", inst.hasPixelSpacing ? "Pixel Spacing present" : "absent — measurements in pixels");
      html += metaRow("File", inst.fileName);
    }
    dom.metaTable.innerHTML = html || '<p class="muted small">No matching tags.</p>';
  }

  /** Free-text search over every element present in the dataset. */
  function renderTagSearch(ds, query, inst) {
    var names = {};
    TAG_TABLE.forEach(function (section) {
      section[1].forEach(function (def) { names[def[0]] = def[1]; });
    });

    var hits = 0, html = metaSection("Search results");
    Object.keys(ds.elements).sort().forEach(function (tag) {
      if (hits >= 80) return;
      var label = names[tag] || tagToDisplay(tag);
      var value;
      try {
        value = ds.string(tag);
      } catch (err) {
        value = null;
      }
      if (value === undefined || value === null) value = "";
      // Include both spellings of the tag: a named element's label is its
      // keyword, so without this a search for "0028,1053" missed exactly the
      // tags the panel knows best.
      var haystack = (tag + " " + tagToDisplay(tag) + " " + label + " " + value).toLowerCase();
      if (haystack.indexOf(query) === -1) return;
      hits++;
      html += metaRow(label + "  " + tagToDisplay(tag), value === "" ? "(binary / empty)" : value);
    });
    void inst;
    return hits ? html : "";
  }

  /** x0010,0010 -> (0010,0010) */
  function tagToDisplay(tag) {
    if (!/^x[0-9a-f]{8}$/i.test(tag)) return tag;
    return "(" + tag.slice(1, 5) + "," + tag.slice(5) + ")";
  }

  function metaRow(key, value) {
    return '<div class="meta-row"><span class="meta-key">' + escapeHtml(key) +
      '</span><span class="meta-val">' + escapeHtml(value) + "</span></div>";
  }
  function metaSection(title) {
    return '<div class="meta-section">' + escapeHtml(title) + "</div>";
  }

  /* ---------------------------------------------------------------------
   * 3D volume rendering
   * ------------------------------------------------------------------- */
  /** Index of the pane holding the 3D view, or -1. */
  function vrCellIndex() {
    for (var i = 0; i < state.cells.length; i++) if (state.cells[i].plane === "vr") return i;
    return -1;
  }

  function ensureRenderer() {
    if (renderer) return renderer;
    var i = vrCellIndex();
    var rec = i >= 0 ? cellEls[i] : null;
    if (!rec) return null;
    try {
      renderer = new VR.Renderer(rec.canvas);
      renderer.setTransferFunction(state.vrPreset, VR_WINDOW_LOW, VR_WINDOW_HIGH);
    } catch (err) {
      renderer = null;
      rec.empty.innerHTML = "3D unavailable<br /><span class='muted small'>" +
        escapeHtml(err.message) + "</span>";
      rec.empty.style.display = "flex";
    }
    return renderer;
  }

  function renderVRCell(i) {
    var rec = cellEls[i];
    if (!rec) return;
    if (!state.volume) {
      rec.empty.style.display = "flex";
      if (renderer) renderer.render();
      return;
    }
    var r = ensureRenderer();
    if (!r) return;
    rec.empty.style.display = "none";

    if (vrDirty) {
      var packed = V.packTexture(state.volume, VR_WINDOW_LOW, VR_WINDOW_HIGH, 256, state.boneCut);
      r.setVolume(packed);
      r.setTransferFunction(state.vrPreset, VR_WINDOW_LOW, VR_WINDOW_HIGH);
      vrDirty = false;
    }

    r.mode = state.vrMode;
    r.opacity = state.vrOpacity;
    r.render();

    rec.tl.textContent = state.vrMode === "mip" ? "3D MIP" : "Volume Rendering";
    rec.br.textContent = (VR.TRANSFER_FUNCTIONS[state.vrPreset] || {}).label || state.vrPreset;
  }

  /** Redraw only the 3D pane, for camera drags. */
  function renderVR() {
    var i = vrCellIndex();
    if (i >= 0) renderVRCell(i);
  }

  /* ---------------------------------------------------------------------
   * View state
   * ------------------------------------------------------------------- */
  function resetView() {
    state.cells.forEach(function (cell) {
      cell.view = { zoom: 1, panX: 0, panY: 0, rotation: 0, flipH: false, flipV: false };
    });
    resetFrames();
    planeCache = {}; planeCacheKeys = [];
    if (renderer) {
      renderer.rotX = -1.35;
      renderer.rotY = 0;
      renderer.distance = 2.6;
    }
  }

  function setPlaneIndex(plane, index, skipRender) {
    if (!state.volume) return;
    var count = V.planeCount(state.volume, plane);
    var clamped = Math.max(0, Math.min(index, count - 1));
    if (clamped === state.index[plane]) return;
    state.index[plane] = clamped;
    if (plane === "axial") highlightActiveThumb();
    if (!skipRender) {
      renderAll();
      syncSliders();
    }
  }

  function syncSliders() {
    state.cells.forEach(function (cell, i) {
      var rec = cellEls[i];
      if (!rec || !rec.slider) return;
      if (!state.volume) {
        rec.slider.disabled = true;
        rec.slider.max = 0;
        rec.slider.value = 0;
        return;
      }
      rec.slider.disabled = false;
      rec.slider.max = Math.max(0, V.planeCount(state.volume, cell.plane) - 1);
      rec.slider.value = cellIndex(cell);
    });
  }

  function applyPreset(key) {
    var preset = PRESETS[key];
    if (!preset) return;
    state.windowWidth = preset.ww;
    state.windowCenter = preset.wc;
    updateWLInputs();
    renderAll();
  }

  function updateWLInputs() {
    dom.windowWidthInput.value = Math.round(state.windowWidth);
    dom.windowCenterInput.value = Math.round(state.windowCenter);
  }

  function setLayout(layout) {
    if (!LAYOUTS[layout]) return;
    applyLayout(layout);
    Array.prototype.forEach.call(dom.layoutSeg.querySelectorAll(".seg-btn"), function (btn) {
      btn.classList.toggle("active", btn.dataset.layout === layout);
    });
  }

  /* ---------------------------------------------------------------------
   * Events
   * ------------------------------------------------------------------- */
  function wireEvents() {
    dom.fileInput.addEventListener("change", function (e) {
      loadFiles(e.target.files);
      e.target.value = "";
    });
    dom.folderInput.addEventListener("change", function (e) {
      loadFiles(e.target.files);
      e.target.value = "";
    });

    dom.clearBtn.addEventListener("click", function () {
      if (!state.seriesOrder.length) return;
      if (!confirm("Clear all loaded series?")) return;
      state.seriesOrder = [];
      state.seriesMap = {};
      state.currentSeriesUID = null;
      state.volume = null;
      state.index = { axial: 0, coronal: 0, sagittal: 0 };
      state.measurements = [];
      state.pendingMeasure = null;
      planeCache = {}; planeCacheKeys = [];
      vrDirty = true;
      if (renderer) renderer.dispose();
      resetView();
      renderSeriesList();
      renderMeasurementList();
      syncSliders();
      updateVolumeInfo();
      updateObliqueInfo();
      renderAll();
      setStatus("Ready");
    });

    dom.layoutSeg.addEventListener("click", function (e) {
      var btn = e.target.closest(".seg-btn");
      if (btn) setLayout(btn.dataset.layout);
    });

    dom.presetSelect.addEventListener("change", function (e) { applyPreset(e.target.value); });

    dom.invertBtn.addEventListener("click", function () {
      state.invert = !state.invert;
      dom.invertBtn.classList.toggle("active", state.invert);
      renderAll();
    });

    if (dom.stackStep) {
      dom.stackStep.addEventListener("change", function (e) {
        state.stackStep = parseInt(e.target.value, 10) || 0;
        restack();
        syncCellControls();
        syncSliders();
        renderAll();
        updateStackNote();
      });
    }

    if (dom.obliqueReset) {
      dom.obliqueReset.addEventListener("click", resetOblique);
    }

    dom.crosshairBtn.addEventListener("click", function () {
      state.crosshair = !state.crosshair;
      dom.crosshairBtn.classList.toggle("active", state.crosshair);
      renderAll();
    });

    // Rotate / flip act on the active pane, keeping each pane's display
    // state independent as the plan calls for.
    dom.rotateBtn.addEventListener("click", function () {
      withActiveMprCell(function (cell, i) {
        cell.view.rotation = ((cell.view.rotation || 0) + 90) % 360;
        renderCell(i);
      });
    });
    dom.flipHBtn.addEventListener("click", function () {
      withActiveMprCell(function (cell, i) {
        cell.view.flipH = !cell.view.flipH;
        dom.flipHBtn.classList.toggle("active", cell.view.flipH);
        renderCell(i);
      });
    });
    dom.flipVBtn.addEventListener("click", function () {
      withActiveMprCell(function (cell, i) {
        cell.view.flipV = !cell.view.flipV;
        dom.flipVBtn.classList.toggle("active", cell.view.flipV);
        renderCell(i);
      });
    });

    dom.toolSeg.addEventListener("click", function (e) {
      var btn = e.target.closest(".seg-btn");
      if (btn) setTool(btn.dataset.tool);
    });

    dom.clearMeasureBtn.addEventListener("click", clearMeasurements);

    dom.measureList.addEventListener("click", function (e) {
      var del = e.target.closest("[data-del]");
      if (del) {
        var id = parseInt(del.dataset.del, 10);
        state.measurements = state.measurements.filter(function (m) { return m.id !== id; });
        if (state.selectedMeasurement === id) state.selectedMeasurement = null;
        renderMeasurementList();
        renderAllOverlays();
        return;
      }
      var row = e.target.closest(".measure-row");
      if (!row) return;
      var rid = parseInt(row.dataset.id, 10);
      var m = state.measurements.filter(function (x) { return x.id === rid; })[0];
      if (!m) return;
      state.selectedMeasurement = rid;
      // Jump to the slice the measurement was made on.
      // Oblique measurements carry a composite key, not a slice number.
      if (typeof m.sliceIndex === "number") setPlaneIndex(m.plane, m.sliceIndex);
      renderMeasurementList();
      renderAllOverlays();
    });

    dom.tagSearch.addEventListener("input", debounce(updateMetadata, 120));

    dom.exportBtn.addEventListener("click", exportActiveViewport);

    dom.resetBtn.addEventListener("click", function () {
      resetView();
      renderAll();
    });

    dom.seriesToggleBtn.addEventListener("click", function () {
      dom.seriesPanel.classList.toggle("collapsed");
      dom.seriesToggleBtn.classList.toggle("active", !dom.seriesPanel.classList.contains("collapsed"));
      requestAnimationFrame(renderAll);
    });
    dom.panelToggleBtn.addEventListener("click", function () {
      dom.toolsPanel.classList.toggle("collapsed");
      dom.panelToggleBtn.classList.toggle("active", !dom.toolsPanel.classList.contains("collapsed"));
      requestAnimationFrame(renderAll);
    });

    dom.windowWidthInput.addEventListener("change", function (e) {
      var v = parseFloat(e.target.value);
      if (isFinite(v) && v > 0) { state.windowWidth = v; dom.presetSelect.value = ""; renderAll(); }
    });
    dom.windowCenterInput.addEventListener("change", function (e) {
      var v = parseFloat(e.target.value);
      if (isFinite(v)) { state.windowCenter = v; dom.presetSelect.value = ""; renderAll(); }
    });

    dom.thicknessRange.addEventListener("input", function (e) {
      state.thicknessMm = parseFloat(e.target.value) || 0;
      dom.thicknessValue.textContent = state.thicknessMm ? fmt(state.thicknessMm) + "mm" : "Thin";
      renderAll();
    });
    dom.projectionMode.addEventListener("change", function (e) {
      state.projectionMode = e.target.value;
      renderAll();
    });

    dom.boneCutToggle.addEventListener("change", function (e) {
      state.boneCut = e.target.checked;
      if (state.boneCut && state.volume && !state.volume.boneMask) {
        setBusy(true, "Segmenting bone…");
        afterPaint(function () {
          recomputeBoneMask();
          setBusy(false);
          renderAll();
          updateBoneStatus();
        });
        return;
      }
      planeCache = {}; planeCacheKeys = [];
      vrDirty = true;
      renderAll();
      updateBoneStatus();
    });

    dom.boneThreshold.addEventListener("input", function (e) {
      state.boneThreshold = parseInt(e.target.value, 10);
      dom.boneThresholdValue.textContent = state.boneThreshold;
    });
    dom.boneThreshold.addEventListener("change", function () {
      if (!state.boneCut || !state.volume) return;
      setBusy(true, "Re-segmenting bone…");
      afterPaint(function () {
        recomputeBoneMask();
        setBusy(false);
        renderAll();
        updateBoneStatus();
      });
    });

    dom.vrMode.addEventListener("change", function (e) {
      state.vrMode = e.target.value;
      renderVR();
    });
    dom.vrPreset.addEventListener("change", function (e) {
      state.vrPreset = e.target.value;
      if (renderer) renderer.setTransferFunction(state.vrPreset, VR_WINDOW_LOW, VR_WINDOW_HIGH);
      renderVR();
    });
    dom.vrOpacity.addEventListener("input", function (e) {
      state.vrOpacity = parseFloat(e.target.value);
      renderVR();
    });

    window.addEventListener("resize", debounce(function () { renderAll(); }, 120));
    document.addEventListener("keydown", onKeyDown);
    wireDragAndDrop();
  }

  function wireCell(i, rec) {
    var cell = state.cells[i];

    rec.planeSel.addEventListener("change", function (e) {
      setCellPlane(i, e.target.value);
    });
    rec.planeSel.addEventListener("mousedown", function (e) { e.stopPropagation(); });

    if (rec.wlSel) {
      rec.wlSel.addEventListener("change", function (e) {
        var key = e.target.value;
        var preset = PRESETS[key];
        cell.wl = preset ? { ww: preset.ww, wc: preset.wc, preset: key } : null;
        renderCell(i);
      });
      rec.wlSel.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    }

    if (rec.linkBtn) {
      rec.linkBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        // Pinning holds the slice the pane is already on; unpinning rejoins
        // the stack at whatever offset keeps it where it is.
        var at = cellIndex(cell);
        cell.pinned = !cell.pinned;
        if (cell.pinned) cell.index = at;
        else cell.offset = at - state.index[cell.plane];
        syncCellControls();
        renderCell(i);
      });
      rec.linkBtn.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    }

    if (rec.slider) {
      rec.slider.addEventListener("input", function (e) {
        setCellIndex(i, parseInt(e.target.value, 10));
      });
      rec.slider.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    }

    rec.root.addEventListener("mousedown", function (e) {
      if (e.target === rec.slider || rec.bar.contains(e.target)) return;
      setActiveCell(i);
      e.preventDefault();

      if (cell.plane === "vr") {
        state.drag = { cell: i, mode: "orbit", x: e.clientX, y: e.clientY };
        return;
      }
      if (e.button === 0 && e.altKey) {
        var a0 = obliqueAngleAt(i, e.clientX, e.clientY);
        if (a0 !== null) state.drag = { cell: i, mode: "oblique", angle: a0 };
        return;
      }
      if (e.button === 0 && e.shiftKey) {
        crosshairFromPoint(i, e.clientX, e.clientY);
        return;
      }
      if (e.button === 0 && state.tool !== MEAS.TOOLS.none) {
        measureClick(i, e.clientX, e.clientY);
        return;
      }
      var win = cellWindow(cell);
      state.drag = {
        cell: i,
        mode: e.button === 0 ? "wl" : "pan",
        x: e.clientX, y: e.clientY,
        ww: win.ww, wc: win.wc,
        panX: cell.view.panX, panY: cell.view.panY,
      };
    });

    rec.root.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    rec.root.addEventListener("wheel", function (e) {
      e.preventDefault();
      setActiveCell(i);
      if (cell.plane === "vr") {
        if (!renderer) return;
        renderer.zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1);
        renderVR();
        return;
      }
      if (!state.volume) return;
      if (e.shiftKey) {
        var view = cell.view;
        view.zoom = Math.max(0.2, Math.min(12, view.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
        renderCell(i);
      } else {
        setCellIndex(i, cellIndex(cell) + (e.deltaY > 0 ? 1 : -1));
      }
    }, { passive: false });

    // Double-click expands a pane to fill the grid, and back again.
    rec.root.addEventListener("dblclick", function (e) {
      if (rec.bar.contains(e.target)) return;
      if (state.layout === "axial" || state.layout === "vr") {
        setLayout(lastGridLayout);
      } else {
        lastGridLayout = state.layout;
        expandCell(i);
      }
    });
  }

  /** Blow one pane up to fill the window, keeping its plane. */
  function expandCell(i) {
    var cell = state.cells[i];
    var target = cell.plane === "vr" ? "vr" : "axial";
    applyLayout(target);
    if (state.cells[0]) state.cells[0].plane = cell.plane;
    Array.prototype.forEach.call(dom.layoutSeg.querySelectorAll(".seg-btn"), function (btn) {
      btn.classList.toggle("active", btn.dataset.layout === target);
    });
    rebuildCells();
  }

  function setActiveCell(i) {
    state.activeCell = i;
    cellEls.forEach(function (rec, j) { rec.root.classList.toggle("active", i === j); });
  }

  /**
   * Move a pane's slice. A linked pane drives the shared cut, so every other
   * linked pane on that plane follows and the crosshair stays consistent.
   */
  function setCellIndex(i, index) {
    var cell = state.cells[i];
    if (!cell || !state.volume || cell.plane === "vr") return;
    var count = V.planeCount(state.volume, cell.plane);
    if (!cell.pinned) {
      // Move the shared cut so every unpinned pane on this plane follows,
      // keeping its offset, and this pane lands where it was asked to.
      setPlaneIndex(cell.plane, index - (cell.offset || 0));
      return;
    }
    var clamped = Math.max(0, Math.min(index, count - 1));
    if (clamped === cell.index) return;
    cell.index = clamped;
    renderCell(i);
    if (cellEls[i] && cellEls[i].slider) cellEls[i].slider.value = clamped;
  }

  function onMouseMove(e) {
    if (state.pendingMeasure && state.measureCell !== undefined) {
      measureHover(state.measureCell, e.clientX, e.clientY);
    }
    var drag = state.drag;
    if (!drag) return;
    var dx = e.clientX - drag.x;
    var dy = e.clientY - drag.y;

    if (drag.mode === "oblique") {
      var a = obliqueAngleAt(drag.cell, e.clientX, e.clientY);
      if (a === null) return;
      // Incremental, so the drag can pass through any number of turns without
      // the shortest-arc wrap that an absolute angle would suffer.
      var d = a - drag.angle;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      drag.angle = a;
      rotateOblique(state.cells[drag.cell].plane, d);
      renderAll();
      return;
    }

    if (drag.mode === "orbit") {
      if (renderer) { renderer.orbit(dx, dy); renderVR(); }
      drag.x = e.clientX;
      drag.y = e.clientY;
      return;
    }

    if (drag.mode === "wl") {
      // Seeded from the window at mousedown, so the gesture never drifts.
      var ww = Math.max(WL_MIN_WIDTH, Math.min(WL_MAX_WIDTH,
        drag.ww * Math.pow(2, dx / WL_WIDTH_DOUBLE_PX)));
      // Down darkens, up brightens — the convention every mainstream viewer uses.
      var wc = drag.wc + (dy * drag.ww) / WL_LEVEL_SPAN_PX;
      var cell = state.cells[drag.cell];
      if (cell && cell.wl) {
        // This pane has its own window, so keep the drag local to it.
        cell.wl = { ww: ww, wc: wc, preset: "" };
        if (cellEls[drag.cell].wlSel) cellEls[drag.cell].wlSel.value = "";
        renderCell(drag.cell);
      } else {
        state.windowWidth = ww;
        state.windowCenter = wc;
        dom.presetSelect.value = "";
        updateWLInputs();
        renderAll();
      }
      return;
    }

    // Pan: panX/panY live in device pixels, mouse deltas are CSS pixels.
    var dpr = window.devicePixelRatio || 1;
    var cellP = state.cells[drag.cell];
    if (!cellP) return;
    cellP.view.panX = drag.panX + dx * dpr;
    cellP.view.panY = drag.panY + dy * dpr;
    renderCell(drag.cell);
  }

  function onKeyDown(e) {
    if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
    var i = state.activeCell;
    var cell = state.cells[i];
    if (!cell || cell.plane === "vr") {
      i = state.cells.findIndex(function (c) { return c.plane !== "vr"; });
      cell = state.cells[i];
    }
    var at = cell ? cellIndex(cell) : 0;
    switch (e.key) {
      case "ArrowDown": case "ArrowRight":
        setCellIndex(i, at + 1); e.preventDefault(); break;
      case "ArrowUp": case "ArrowLeft":
        setCellIndex(i, at - 1); e.preventDefault(); break;
      case "PageDown":
        setCellIndex(i, at + 10); e.preventDefault(); break;
      case "PageUp":
        setCellIndex(i, at - 10); e.preventDefault(); break;
      case "i": case "I":
        dom.invertBtn.click(); break;
      case "r": case "R":
        resetView(); renderAll(); break;
      case "1": setLayout("quad"); break;
      case "2": setLayout("axial"); break;
      case "3": setLayout("mpr"); break;
      case "4": setLayout("vr"); break;
      case "5": setLayout("1x2"); break;
      case "6": setLayout("2x3"); break;
      case "7": setLayout("4x4"); break;
    }
  }

  function wireDragAndDrop() {
    ["dragenter", "dragover"].forEach(function (type) {
      window.addEventListener(type, function (e) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
    });
    window.addEventListener("drop", function (e) {
      e.preventDefault();
      handleDrop(e.dataTransfer);
    });
  }

  function handleDrop(dataTransfer) {
    var items = dataTransfer.items;
    if (items && items.length && items[0].webkitGetAsEntry) {
      var entries = [];
      for (var i = 0; i < items.length; i++) {
        var entry = items[i].webkitGetAsEntry();
        if (entry) entries.push(entry);
      }
      if (entries.length) {
        collectEntries(entries, function (files) { loadFiles(files); });
        return;
      }
    }
    loadFiles(dataTransfer.files);
  }

  /** Recursively walk dropped directory entries into a flat file list. */
  function collectEntries(entries, done) {
    var files = [];
    var pending = entries.length;
    if (!pending) return done(files);

    entries.forEach(function (entry) { walk(entry); });

    function walk(entry) {
      if (entry.isFile) {
        entry.file(function (file) {
          files.push(file);
          if (--pending === 0) done(files);
        }, function () { if (--pending === 0) done(files); });
      } else if (entry.isDirectory) {
        var reader = entry.createReader();
        var readBatch = function () {
          reader.readEntries(function (batch) {
            if (!batch.length) {
              if (--pending === 0) done(files);
              return;
            }
            pending += batch.length;
            batch.forEach(walk);
            readBatch();
          }, function () { if (--pending === 0) done(files); });
        };
        readBatch();
      } else if (--pending === 0) {
        done(files);
      }
    }
  }

  function updateBoneStatus() {
    if (!state.boneCut) {
      dom.boneCutStatus.textContent =
        "Threshold segmentation — applies to MPR and 3D. Raise the threshold " +
        "above contrast density (~350 HU) to keep opacified vessels.";
      return;
    }
    dom.boneCutStatus.textContent =
      "Bone removed at ≥ " + state.boneThreshold + " HU (dilated 2 voxels)." +
      (state.boneThreshold < 350 ? " Contrast-filled vessels are cut too at this threshold." : "");
  }

  /** Run fn against the active pane, or the first 2D pane if 3D is focused. */
  function withActiveMprCell(fn) {
    var i = state.activeCell;
    if (!state.cells[i] || state.cells[i].plane === "vr") {
      i = state.cells.findIndex(function (c) { return c.plane !== "vr"; });
    }
    if (i >= 0 && state.cells[i]) fn(state.cells[i], i);
  }

  /**
   * Export the active viewport as a PNG, compositing the annotation layer
   * (crosshair, orientation markers, measurements) over the image so what is
   * saved matches what is on screen.
   */
  function exportActiveViewport() {
    var i = state.activeCell;
    var cell = state.cells[i], rec = cellEls[i];
    if (!cell || !rec || !rec.canvas) return;
    var plane = cell.plane;

    var out = document.createElement("canvas");
    var src = rec.canvas;
    out.width = src.width;
    out.height = src.height;
    var ctx = out.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, out.width, out.height);

    if (plane === "vr") {
      if (!renderer) return showToast("Nothing to export from the 3D view yet.", true);
      renderer.render();                       // ensure the buffer is current
      ctx.drawImage(src, 0, 0);
    } else {
      if (!rec.geom) return showToast("Nothing to export yet.", true);
      ctx.drawImage(src, 0, 0);
      ctx.drawImage(rec.cross, 0, 0);
    }

    var group = getCurrentGroup();
    var stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    var name = "ct-console-" + plane + "-" +
      (group ? group.description.replace(/[^\w-]+/g, "_").slice(0, 40) : "view") +
      "-" + stamp + ".png";

    out.toBlob(function (blob) {
      if (!blob) return showToast("Export failed.", true);
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      showToast("Exported " + name);
    }, "image/png");
  }

  /** Surface geometry problems found during reconstruction. */
  function updateGeometryWarnings() {
    var warnings = state.volume && state.volume.warnings ? state.volume.warnings : [];
    if (!warnings.length) {
      dom.geometryWarnings.innerHTML = "";
      return;
    }
    dom.geometryWarnings.innerHTML =
      '<div class="warn-block"><div class="warn-title">⚠ Geometry</div>' +
      warnings.map(function (w) { return '<p class="warn-item">' + escapeHtml(w) + "</p>"; }).join("") +
      "</div>";
  }

  /** Explain what the measurement units are based on. */
  /** Per-plane tilt readout, so the reslice angle is never implicit. */
  /** Say what the stack setting is doing to the panes on screen. */
  function updateStackNote() {
    if (!dom.stackNote) return;
    var counts = {};
    state.cells.forEach(function (c) {
      if (c.plane !== "vr") counts[c.plane] = (counts[c.plane] || 0) + 1;
    });
    var most = Math.max.apply(null, [1].concat(Object.keys(counts).map(function (k) { return counts[k]; })));
    if (most < 2) {
      dom.stackNote.textContent =
        "No plane is repeated in this layout, so there is nothing to stack. " +
        "Try the 2\u00d73 or 4\u00d74 grid.";
      return;
    }
    if (!state.stackStep) {
      dom.stackNote.textContent =
        "Repeated panes all show the same slice. Scrolling moves them together.";
      return;
    }
    var span = (most - 1) * state.stackStep;
    dom.stackNote.textContent =
      "Repeated panes step " + state.stackStep + " slice" + (state.stackStep > 1 ? "s" : "") +
      " apart, covering " + (span + 1) + " slices at a time. Scrolling any pane moves the whole run.";
  }

  var obliqueInfoKey = null;

  function updateObliqueInfo() {
    if (!dom.obliqueInfo) return;
    // Called on every render, so skip the DOM write unless something moved.
    var key = !state.volume ? "none" : MPR_PLANES.map(function (p) {
      return tiltOf(p).toFixed(3);
    }).join("/");
    if (key === obliqueInfoKey) return;
    obliqueInfoKey = key;
    if (!state.volume) {
      dom.obliqueInfo.innerHTML = '<p class="muted small">No volume built.</p>';
      if (dom.obliqueReset) dom.obliqueReset.disabled = true;
      return;
    }
    var tilted = obliqueActive();
    if (dom.obliqueReset) dom.obliqueReset.disabled = !tilted;
    if (!tilted) {
      dom.obliqueInfo.innerHTML =
        '<p class="muted small">Orthogonal — planes are square to the volume axes.</p>';
      return;
    }
    var rows = MPR_PLANES.map(function (plane) {
      return '<div class="meta-row"><span class="meta-key">' +
        plane.charAt(0).toUpperCase() + plane.slice(1) +
        '</span><span class="meta-val">' + tiltOf(plane).toFixed(1) + "°</span></div>";
    }).join("");
    dom.obliqueInfo.innerHTML = rows;
  }

  function updateCalibrationNote() {
    var group = getCurrentGroup();
    if (!group || !group.slices.length) {
      dom.calibrationNote.textContent = "";
      return;
    }
    var inst = group.slices[0].instance;
    var unit = intensityUnit();
    if (!inst.hasPixelSpacing) {
      dom.calibrationNote.textContent =
        "No Pixel Spacing in this series — distances and areas are reported in pixels, not millimetres.";
      return;
    }
    var note = "Distances use Pixel Spacing " +
      fmt(inst.pixelSpacingCol) + " × " + fmt(inst.pixelSpacingRow) + " mm.";
    if (state.volume && !state.volume.spacingZReliable) {
      note += " Slice spacing is irregular, so coronal/sagittal distances are uncalibrated.";
    }
    note += unit
      ? " ROI statistics are in " + unit + "."
      : " ROI statistics are stored pixel values — this series does not declare Hounsfield Units.";
    dom.calibrationNote.textContent = note;
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, wait);
    };
  }

  /* ---------------------------------------------------------------------
   * Init
   * ------------------------------------------------------------------- */
  function init() {
    cacheDom();
    resetFrames();
    wireEvents();

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", function () { state.drag = null; });

    dom.crosshairBtn.classList.toggle("active", state.crosshair);
    updateWLInputs();
    updateBoneStatus();
    updateStackNote();
    updateObliqueInfo();
    renderMeasurementList();
    syncSliders();
    setTool("none");
    setLayout(state.layout);
    setStatus("Ready — open a DICOM folder to begin");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Exposed for headless testing.
  window.__ctConsole = {
    BASE_FRAMES: BASE_FRAMES,
    rotateOblique: rotateOblique,
    resetOblique: resetOblique,
    obliqueActive: obliqueActive,
    tiltOf: tiltOf,
    crosshairWorld: crosshairWorld,
    indicesFromWorld: indicesFromWorld,
    planeToWorld: planeToWorld,
    worldToPlane: worldToPlane,
    state: state,
    getPlaneData: getPlaneData,
    renderAll: renderAll,
    orientationLabels: orientationLabels,
    planeToCanvas: planeToCanvas,
    canvasToPlane: canvasToPlane,
    planeTransform: planeTransform,
    LAYOUTS: LAYOUTS,
    layoutFill: layoutFill,
    setLayout: setLayout,
    setCellPlane: setCellPlane,
    setCellIndex: setCellIndex,
    setActiveCell: setActiveCell,
    cellIndex: cellIndex,
    cellWindow: cellWindow,
    restack: restack,
    cellGeom: function (i) { return cellEls[i] ? cellEls[i].geom : null; },
    cellEl: function (i) { return cellEls[i] ? cellEls[i].root : null; },
    cellCount: function () { return cellEls.length; },
  };
})();
