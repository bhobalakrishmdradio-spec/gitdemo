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
  var CODECS = window.CTCodecs;
  var REPORT = window.CTReport;
  var TPL = window.CTTemplates;

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

  /**
   * Every pop-up menu, by its dom key.
   *
   * They live outside the toolbar as fixed-position siblings: the toolbar
   * scrolls horizontally, and a menu nested inside a scrolling container is
   * clipped — it can look perfectly visible while being unclickable.
   */
  var MENUS = ["openMenu", "orientMenu", "resetMenu", "toolMenu",
               "windowMenu", "moreMenu", "layoutMenu", "stackMenu"];
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
    quad: { label: "2×2", glyph: "▦", cols: 2, rows: 2,
            fill: ["axial", "coronal", "sagittal", "vr"] },
    axial: { label: "1×1", glyph: "▢", cols: 1, rows: 1, fill: ["axial"] },
    // `fixed` layouts are defined by which planes they show, so a whole-grid
    // plane choice does not apply to them.
    mpr: { label: "MPR", glyph: "▤", cols: 3, rows: 1,
           fill: ["axial", "coronal", "sagittal"], fixed: true },
    vr: { label: "3D", glyph: "◈", cols: 1, rows: 1, fill: ["vr"], fixed: true },
    "1x2": { label: "1×2", glyph: "▯▯", cols: 2, rows: 1, fill: ["axial", "coronal"] },
    "2x3": { label: "2×3", glyph: "▦▦", cols: 3, rows: 2, fill: null },
  };

  /**
   * Planes a layout's panes start on.
   *
   * With a single plane chosen, every pane shows it, which is what turns a
   * grid into a filmstrip: sixteen consecutive axial slices that page
   * together. "Mixed" keeps each layout's own arrangement of the three
   * planes plus the 3D view.
   */
  function layoutFill(key) {
    var def = LAYOUTS[key] || LAYOUTS.quad;
    var total = def.cols * def.rows;

    if (!def.fixed && state.planeFill && state.planeFill !== "mix" &&
        state.planeFill !== "seq") {
      var same = [];
      for (var k = 0; k < total; k++) same.push(state.planeFill);
      return same;
    }

    if (def.fill) return def.fill.slice(0, total);
    var out = [];
    for (var i = 0; i < total; i++) out.push(MPR_PLANES[i % MPR_PLANES.length]);
    // One 3D pane, in the fourth slot, where the 2x2 layout also puts it.
    if (total >= 4) out[3] = "vr";
    return out;
  }

  /**
   * Point every pane at one plane, at one sequence each, or back to the
   * layout's own mixture.
   *
   * "seq" is the MR reading layout: one *series* per pane, each shown in the
   * plane it was acquired in. Reformatting a 4 mm sagittal T2 into a coronal
   * image is technically possible and diagnostically useless, so the sections
   * a sequence was taken in are what the grid lays out, not reconstructions
   * of them.
   */
  function setPlaneFill(fill) {
    state.planeFill = fill;
    var def = LAYOUTS[state.layout] || LAYOUTS.quad;
    if (def.fixed || fill === "mix") {
      applyLayout(state.layout);          // rebuild the layout's own arrangement
      syncPlaneFill();
      return;
    }
    if (fill === "seq") { fillWithSequences(); return; }

    state.cells.forEach(function (cell) {
      cell.plane = fill;
      cell.seriesUid = null;
      cell.pinned = false;
      cell.offset = 0;
    });
    restack();
    rebuildCells();
    syncPlaneFill();
  }

  /** Series in this study that can be reconstructed, current one first. */
  function stackableSeries() {
    var current = getCurrentGroup();
    var study = current && current.slices.length
      ? current.slices[0].instance.studyUID : null;
    return state.seriesOrder.filter(function (uid) {
      var g = state.seriesMap[uid];
      if (!g || g.slices.length < 2) return false;
      if (!study) return true;
      return g.slices[0].instance.studyUID === study;
    }).sort(function (a, b) {
      // The series on screen leads, so the pane you were reading stays first.
      if (a === state.currentSeriesUID) return -1;
      if (b === state.currentSeriesUID) return 1;
      return 0;
    });
  }

  /** The plane a series was acquired in, or null when it cannot be told. */
  function nativePlaneOf(uid) {
    var vol = uid === state.currentSeriesUID ? state.volume : state.volumes[uid];
    if (!vol) return null;
    var hit = V.acquisitionPlane(vol);
    return hit ? hit.plane : null;
  }

  /**
   * Give each pane its own sequence.
   *
   * Volumes are built on demand and one at a time, because reconstructing
   * six MR series at once on a laptop is a long freeze with no feedback.
   */
  function fillWithSequences() {
    var uids = stackableSeries();
    if (!uids.length) {
      showToast("Load a study with more than one series first.", true);
      state.planeFill = "mix";
      syncPlaneFill();
      return;
    }
    var want = uids.slice(0, state.cells.length);
    var missing = want.filter(function (u) {
      return u !== state.currentSeriesUID && !state.volumes[u];
    });

    var assign = function () {
      state.cells.forEach(function (cell, i) {
        var uid = want[i % want.length];
        cell.seriesUid = uid === state.currentSeriesUID ? null : uid;
        cell.plane = nativePlaneOf(uid) || cell.plane || "axial";
        cell.pinned = false;
        cell.offset = 0;
      });
      restack();
      rebuildCells();
      syncPlaneFill();
      var n = Math.min(want.length, state.cells.length);
      setStatus("Showing " + n + " sequence" + (n === 1 ? "" : "s") +
        ", each in the plane it was acquired in.");
    };

    if (!missing.length) return assign();

    setBusy(true, "Reconstructing " + missing.length + " series…");
    var at = 0;
    var step = function () {
      if (at >= missing.length) { setBusy(false); assign(); return; }
      var uid = missing[at++];
      var group = state.seriesMap[uid];
      setBusy(true, "Reconstructing " + (group.description || "series") +
        " (" + at + " of " + missing.length + ")…");
      afterPaint(function () {
        try { rememberVolume(uid, V.build(group.slices, decodeForVolume)); }
        catch (err) { /* a series that will not build is simply skipped */ }
        step();
      });
    };
    step();
  }

  /**
   * Reflect what the panes actually show, not what was last clicked — a
   * pane changed on its own makes the grid mixed again.
   */
  function syncPlaneFill() {
    var def = LAYOUTS[state.layout] || LAYOUTS.quad;
    var planes = state.cells.map(function (c) { return c.plane; });
    // One sequence per pane is a choice about *series*, so it cannot be
    // inferred from the planes — two sagittal sequences look like "all
    // sagittal". It holds until something else is picked.
    var bySeries = state.cells.length > 1 && state.cells.some(function (c) {
      return c.seriesUid;
    });
    if (state.planeFill === "seq" && bySeries) {
      syncLayoutControls();
      return;
    }
    // A single-pane layout is trivially "uniform", but inferring a whole-grid
    // plane choice from it would silently turn 1x1 into "All axial" and cost
    // the 3D pane on the way back to 2x2.
    if (planes.length > 1) {
      var uniform = planes.every(function (p) { return p === planes[0]; });
      state.planeFill = uniform && planes[0] !== "vr" ? planes[0] : "mix";
    }
    syncLayoutControls();
  }

  /**
   * Every layout choice lives behind one button, so the button has to say
   * what is currently chosen — a menu that hides the active state makes the
   * layout the only setting on the toolbar you cannot read off it.
   */
  function syncLayoutControls() {
    var def = LAYOUTS[state.layout] || LAYOUTS.quad;
    if (dom.layoutBtn) {
      dom.layoutBtn.textContent = (def.glyph || "▦") + " " + def.label + " ▾";
      dom.layoutBtn.title = "Layout: " + def.label + " — click to change";
    }
    if (dom.layoutMenu) {
      Array.prototype.forEach.call(dom.layoutMenu.querySelectorAll("[data-layout]"), function (b) {
        b.classList.toggle("on", b.dataset.layout === state.layout);
      });
    }
    if (!dom.planeSeg) return;
    var oneSeries = stackableSeries().length < 2;
    Array.prototype.forEach.call(dom.planeSeg.querySelectorAll(".seg-btn"), function (b) {
      var seq = b.dataset.fill === "seq";
      // A layout that defines its own panes cannot be filled with one plane;
      // and one sequence per pane needs more than one sequence. Offering
      // either as choosable when it cannot work would be a lie.
      b.disabled = !!def.fixed || (seq && oneSeries);
      b.classList.toggle("active", !def.fixed && b.dataset.fill === state.planeFill);
      b.title = def.fixed
        ? "The " + def.label + " layout defines its own planes"
        : seq
          ? (oneSeries
              ? "Only one series in this study — nothing to lay out"
              : "One sequence per pane, each in the plane it was acquired in")
          : b.dataset.fill === "mix"
            ? "Each layout's own arrangement of planes"
            : "Fill every pane with " + b.dataset.fill + " slices";
    });
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

    volume: null,                 // the current series' volume
    volumes: {},                  // seriesUid -> volume, for comparison panes
    seriesIndex: {},              // seriesUid -> { axial, coronal, sagittal }
    link: true,                   // link panes across series by patient position
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
    showAnnotations: true,        // hide every marker without deleting one
    textTarget: null,             // caption being typed, if any

    // Measurements are saved per series so they survive a reload. The flag
    // exists so a test, or a shared machine, can turn that off.
    measurePersist: true,
    measureStoredUids: [],        // series with a saved record, for clean-up
    measureLoaded: {},            // series already restored this session

    windowWidth: 400,
    windowCenter: 40,
    windowPreset: null,         // which named preset the current W/L matches
    invert: false,

    thicknessMm: 0,
    projectionMode: "average",

    boneCut: false,
    boneThreshold: 200,
    boneMaskVersion: 0,
    sculptRadius: 8,            // brush radius in millimetres
    sculptUndo: [],             // strokes, newest last

    cine: { playing: false, fps: 12, reverse: false, loop: true },

    vrMode: "vr",
    vrPreset: "bone",
    vrOpacity: 1,

    // One anatomical point every pane is asked to show. See the Focus
    // section: stored in patient millimetres when the series says where it
    // is, so comparison series can be brought to the same anatomy.
    focusPoint: null,
    focusPick: false,

    huProbe: true,              // live value readout under the cursor
    freeRotate: false,          // drag rotates the pane to any angle
    seriesFilter: "",
    layout: "quad",
    planeFill: "mix",           // "mix" | "axial" | "coronal" | "sagittal"

    // Slices between one pane and the next on the same plane. 0 makes every
    // pane show the same slice; 1 makes a grid a filmstrip.
    stackStep: 1,
    crosshair: true,

    drag: null,

    // The report is bound to one study; see swapReportToStudy().
    reportStudyUid: null,
    report: null,
  };

  var dom = {};
  var cellEls = [];             // DOM for each pane, parallel to state.cells
  var toastTimer = null;
  var renderer = null;          // CTVolumeRenderer.Renderer
  var vrDirty = true;           // texture needs re-upload
  var planeCache = {};          // request key -> extracted plane
  var planeCacheKeys = [];      // insertion order, for trimming
  var cineTimer = null;
  var volumeOrder = [];         // reconstruction order, for evicting
  var MAX_CACHED_VOLUMES = 3;   // current study plus a prior or two
  var seriesNodes = {};         // uid -> { wrapper, sliceCount }

  /* ---------------------------------------------------------------------
   * DOM
   * ------------------------------------------------------------------- */
  // The grid layout to return to when a pane is un-expanded.
  var lastGridLayout = "quad";

  function cacheDom() {
    dom.fileInput = byId("fileInput");
    dom.folderInput = byId("folderInput");
    dom.openBtn = byId("openBtn");
    dom.openMenu = byId("openMenu");
    dom.windowBtn = byId("windowBtn");
    dom.windowMenu = byId("windowMenu");
    dom.windowPresets = byId("windowPresets");
    dom.moreBtn = byId("moreBtn");
    dom.shotBtn = byId("shotBtn");
    dom.moreMenu = byId("moreMenu");
    dom.navBtn = byId("navBtn");
    dom.layoutBtn = byId("layoutBtn");
    dom.layoutMenu = byId("layoutMenu");
    dom.orientBtn = byId("orientBtn");
    dom.orientMenu = byId("orientMenu");
    dom.crosshairBtn = byId("crosshairBtn");
    dom.focusBtn = byId("focusBtn");
    dom.focusGoBtn = byId("focusGoBtn");
    dom.focusNote = byId("focusNote");
    dom.focusPickBtn = byId("focusPickBtn");
    dom.focusClearBtn = byId("focusClearBtn");
    dom.linkBtn = byId("linkBtn");
    dom.huReadout = byId("huReadout");
    dom.resetMenu = byId("resetMenu");
    dom.resetBtn = byId("resetBtn");
    dom.measureList = byId("measureList");
    dom.clearMeasureBtn = byId("clearMeasureBtn");
    dom.roiHistogram = byId("roiHistogram");
    dom.histogramNote = byId("histogramNote");
    dom.toolMenu = byId("toolMenu");
    dom.toolMoreBtn = byId("toolMoreBtn");
    dom.annotInput = byId("annotInput");
    dom.annotField = byId("annotField");
    dom.annotOk = byId("annotOk");
    dom.annotCancel = byId("annotCancel");
    dom.calibrationNote = byId("calibrationNote");
    dom.planeSeg = byId("planeSeg");
    dom.stackBtn = byId("stackBtn");
    dom.stackMenu = byId("stackMenu");
    dom.stackNote = byId("stackNote");
    dom.obliqueInfo = byId("obliqueInfo");
    dom.obliqueReset = byId("obliqueResetBtn");
    dom.geometryWarnings = byId("geometryWarnings");
    dom.tagSearch = byId("tagSearch");
    dom.seriesFilter = byId("seriesFilter");
    dom.seriesToggleBtn = byId("seriesToggleBtn");
    dom.panelToggleBtn = byId("panelToggleBtn");
    dom.reportToggleBtn = byId("reportToggleBtn");
    dom.reportPanel = byId("reportPanel");
    dom.reportHeader = byId("reportHeader");
    dom.reportStatus = byId("reportStatus");
    dom.reportTemplate = byId("reportTemplate");
    dom.templateCredit = byId("templateCredit");
    dom.placeholderWarn = byId("placeholderWarn");
    dom.reportKeyList = byId("reportKeyList");
    dom.reportFields = {};
    REPORT.SECTIONS.forEach(function (sec) {
      dom.reportFields[sec.key] = byId("report" + sec.key.charAt(0).toUpperCase() + sec.key.slice(1));
    });

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
    dom.sculptRadius = byId("sculptRadius");
    dom.sculptRadiusValue = byId("sculptRadiusValue");
    dom.cineBtn = byId("cineBtn");
    dom.cineSpeed = byId("cineSpeed");
    dom.cineDirBtn = byId("cineDirBtn");
    dom.cineLoopBtn = byId("cineLoopBtn");
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
      seriesUid: null,      // null = whatever series is current
      offset: 0,            // slices ahead of the shared cut for this plane
      index: 0,             // absolute slice, used only while pinned
      pinned: false,        // true = hold this slice, ignore scrolling
      view: { zoom: 1, panX: 0, panY: 0, rotation: 0, flipH: false, flipV: false },
      wl: null,             // own window/level; null while following the global one
    };
  }

  /** Which series a pane draws from. */
  function cellSeriesUid(cell) {
    return cell.seriesUid || state.currentSeriesUID || null;
  }

  /** The volume a pane draws from, which may not be the current one. */
  function cellVolume(cell) {
    if (!cell) return null;
    var uid = cellSeriesUid(cell);
    if (uid && state.volumes[uid]) return state.volumes[uid];
    return cell.seriesUid ? null : state.volume;
  }

  /**
   * Slice indices for one series.
   *
   * Comparison panes show a different series with its own slice count, so
   * one shared index would be meaningless. Each series keeps its own,
   * centred when first seen.
   */
  function indexRecord(uid) {
    if (!uid) return state.index;
    if (uid === state.currentSeriesUID) return state.index;
    if (!state.seriesIndex[uid]) {
      var vol = state.volumes[uid];
      var rec = { axial: 0, coronal: 0, sagittal: 0 };
      if (vol) {
        MPR_PLANES.forEach(function (p) {
          rec[p] = Math.floor(V.planeCount(vol, p) / 2);
        });
      }
      state.seriesIndex[uid] = rec;
    }
    return state.seriesIndex[uid];
  }

  /**
   * The slice a pane is showing.
   *
   * Panes track the shared cut at a fixed offset, so scrolling anywhere moves
   * the whole stack together and a grid reads as a run of consecutive images
   * rather than one image repeated. A pinned pane opts out and holds still.
   */
  function cellIndex(cell) {
    var vol = cellVolume(cell);
    if (!vol || cell.plane === "vr") return 0;
    var count = V.planeCount(vol, cell.plane);
    var rec = indexRecord(cellSeriesUid(cell));
    var i = cell.pinned ? cell.index : rec[cell.plane] + (cell.offset || 0);
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
      // Panes on different series are separate runs: a shared offset would
      // mean different distances in each.
      var key = cellSeriesUid(cell) + "|" + cell.plane;
      var k = seen[key] || 0;
      seen[key] = k + 1;
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
    syncOrientMenu();
    syncPlaneFill();
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

    // Which series this pane draws from. Only worth showing once there is
    // more than one to choose between.
    var seriesSel = null;
    if (cell.plane !== "vr" && state.seriesOrder.length > 1) {
      seriesSel = mk("select", "vp-series");
      seriesSel.title = "Which series this pane shows";
      bar.appendChild(seriesSel);
    }

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
      bar: bar, planeSel: planeSel, seriesSel: seriesSel,
      wlSel: wlSel, linkBtn: linkBtn, slider: slider,
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

  /**
   * Bind a pane to a specific series, for comparing a study with a prior.
   *
   * The volume is reconstructed on demand and cached. A pane on another
   * series keeps its own slice position; linked scrolling lines the two up
   * by patient position, which is not the same as registering them.
   */
  function setCellSeries(i, uid) {
    var cell = state.cells[i];
    if (!cell) return;
    cell.seriesUid = uid || null;
    cell.pinned = false;
    cell.offset = 0;
    if (!uid || state.volumes[uid]) {
      restack();
      rebuildCells();
      return;
    }
    var group = state.seriesMap[uid];
    if (!group || group.slices.length < 2) {
      showToast("That series has too few images to reconstruct.", true);
      cell.seriesUid = null;
      rebuildCells();
      return;
    }
    setBusy(true, "Reconstructing " + (group.description || "series") + "…");
    afterPaint(function () {
      try {
        rememberVolume(uid, V.build(group.slices, decodeForVolume));
      } catch (err) {
        showToast("Couldn't build that series: " + err.message, true);
        cell.seriesUid = null;
      }
      setBusy(false);
      // Start the comparison series at the position the current one is on.
      if (cell.seriesUid && state.link) {
        linkOthersTo(state.currentSeriesUID, state.index.axial);
      }
      restack();
      rebuildCells();
    });
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
      if (rec.seriesSel) {
        fillOptions(rec.seriesSel, [["", "Current series"]].concat(
          state.seriesOrder.map(function (uid) {
            var g = state.seriesMap[uid];
            var inst = g.slices.length ? g.slices[0].instance : null;
            return [uid, (inst && inst.modality ? inst.modality + " · " : "") +
              (g.description || "Series") + " (" + g.slices.length + ")"];
          })));
        rec.seriesSel.value = cell.seriesUid || "";
        rec.seriesSel.classList.toggle("other", !!cell.seriesUid);
      }
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

  /** True when anything is being removed from view: threshold or sculpting. */
  function cutActive(vol) {
    return !!(state.boneCut || V.hasSculpt(vol || state.volume));
  }

  /* ---------------------------------------------------------------------
   * Hand sculpting
   *
   * A Hounsfield threshold cannot tell the skull from the opacified vessel
   * lying against it. This lets the reader cut the rest away by hand, on
   * any plane, with the 3D view following.
   * ------------------------------------------------------------------- */

  /** Paint one brush stamp at a pane point, recording it for undo. */
  function sculptAt(i, clientX, clientY, stroke) {
    var cell = state.cells[i];
    var rec = cellEls[i], geom = rec && rec.geom;
    var vol = cellVolume(cell);
    if (!geom || !vol || cell.plane === "vr") return;
    var p = eventToCell(i, clientX, clientY);
    if (!p) return;
    var world = planeToWorld(geom.plane, geom.slab, p.x, p.y, geom.index, vol);
    var changed = V.sculptSphere(vol, world, state.sculptRadius, false);
    if (!changed.length) return;
    if (stroke) stroke.push.apply(stroke, changed);
    planeCache = {}; planeCacheKeys = [];
    vrDirty = true;
  }

  function undoSculpt() {
    var last = state.sculptUndo.pop();
    if (!last) return showToast("Nothing to undo.", true);
    V.undoSculpt(last.volume, last.indices, false);
    planeCache = {}; planeCacheKeys = [];
    vrDirty = true;
    renderAll();
    updateBoneStatus();
    showToast("Undid one sculpt stroke.");
  }

  function clearSculpt() {
    var any = false;
    Object.keys(state.volumes).forEach(function (uid) {
      if (V.hasSculpt(state.volumes[uid])) { V.clearSculpt(state.volumes[uid]); any = true; }
    });
    if (state.volume && V.hasSculpt(state.volume)) { V.clearSculpt(state.volume); any = true; }
    state.sculptUndo = [];
    if (!any) return;
    planeCache = {}; planeCacheKeys = [];
    vrDirty = true;
    renderAll();
    updateBoneStatus();
    showToast("Sculpting cleared.");
  }

  /* ---------------------------------------------------------------------
   * Cine
   * ------------------------------------------------------------------- */

  function setCine(playing) {
    state.cine.playing = playing;
    if (cineTimer) { clearInterval(cineTimer); cineTimer = null; }
    if (playing) {
      cineTimer = setInterval(cineStep, Math.max(20, 1000 / state.cine.fps));
    }
    dom.cineBtn.textContent = playing ? "⏸" : "▶";
    dom.cineBtn.classList.toggle("active", playing);
  }

  /** Advance the active pane's series by one slice. */
  function cineStep() {
    var i = state.activeCell;
    if (!state.cells[i] || state.cells[i].plane === "vr") {
      i = state.cells.findIndex(function (c) { return c.plane !== "vr"; });
    }
    var cell = state.cells[i];
    var vol = cellVolume(cell);
    if (!cell || !vol) return setCine(false);

    var count = V.planeCount(vol, cell.plane);
    var at = cellIndex(cell);
    var next = at + (state.cine.reverse ? -1 : 1);
    if (next < 0 || next >= count) {
      if (!state.cine.loop) return setCine(false);
      next = state.cine.reverse ? count - 1 : 0;
    }
    setCellIndex(i, next);
  }

  /** True when the loaded series really is on a Hounsfield scale. */
  function isHounsfield() {
    return intensityUnit() === "HU";
  }

  /**
   * The value range the 3D texture is packed over.
   *
   * CT is packed over the diagnostic HU range so the transfer functions can
   * be written in Hounsfield Units. MR numbers are arbitrary signal with no
   * fixed scale, so the volume's own range is used and its presets are
   * expressed as fractions of it.
   */
  function vrRange() {
    if (isHounsfield() || !state.volume) return [VR_WINDOW_LOW, VR_WINDOW_HIGH];
    var lo = state.volume.minHU, hi = state.volume.maxHU;
    if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return [VR_WINDOW_LOW, VR_WINDOW_HIGH];
    return [lo, hi];
  }

  /**
   * How to label an intensity read off a plane.
   *
   * Once a slab is thicker than one voxel the samples are a projection —
   * the maximum, minimum or mean along the slab — not the value of any one
   * voxel. Calling a 10 mm MIP reading "HU" overstates it by however much
   * the brightest voxel in the slab exceeds the one on the centre slice, so
   * the projection is named instead.
   */
  function intensitySuffix(slab) {
    var unit = intensityUnit();
    var parts = [];
    if (unit) parts.push(unit);
    if (slab && slab.samples > 1) parts.push("(" + modeLabel(state.projectionMode) + ")");
    if (state.boneCut) parts.push("(bone cut)");
    return parts.join(" ");
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
    var syntaxKind = UNCOMPRESSED_TRANSFER_SYNTAXES[transferSyntax] ||
      (CODECS.codecFor(transferSyntax) ? "encapsulated" : null);

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
    var imagePosition = null;
    if (dataSet.elements.x00200032) {
      // The full vector, not just Z: lining two series up in-plane needs the
      // patient origin, and Z alone can only match the slice level.
      var ipp = [];
      for (var pi = 0; pi < 3; pi++) ipp.push(dataSet.floatString("x00200032", pi));
      if (ipp.every(function (v) { return isFinite(v); })) imagePosition = ipp;
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
      // Acquisition dimensions: a spatial stack must not mix echoes or time
      // points, which occupy the same physical space.
      echoNumber: str(dataSet, "x00180086", ""),
      temporalPosition: str(dataSet, "x00200100", ""),
      acquisitionNumber: str(dataSet, "x00200012", ""),

      bitsAllocated: uint16(dataSet, "x00280100", 16),
      // Bits Stored decides how many of the decoded bits are real samples,
      // which matters once a codec hands back values modulo 2**16.
      bitsStored: uint16(dataSet, "x00280101", uint16(dataSet, "x00280100", 16)),
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
      imagePosition: imagePosition,

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

    if (!instance.syntaxKind) throw new Error(unsupportedSyntaxMessage(instance.transferSyntax));
    if (!instance.pixelDataElement) throw new Error("File has no Pixel Data element.");

    var rows = instance.rows, cols = instance.columns;
    var samplesPerPixel = instance.samplesPerPixel;
    var raw = instance.syntaxKind === "encapsulated"
      ? decodeCompressedFrame(instance, frameIndex)
      : readNativeFrame(instance, frameIndex);

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

  /** Pixel samples straight out of an uncompressed Pixel Data element. */
  function readNativeFrame(instance, frameIndex) {
    var samplesPerPixel = instance.samplesPerPixel;
    var bytesPerSample = instance.bitsAllocated <= 8 ? 1 : 2;
    var pixelsPerFrame = instance.rows * instance.columns * samplesPerPixel;
    var bytesPerFrame = pixelsPerFrame * bytesPerSample;

    var baseOffset = instance.pixelDataElement.dataOffset + frameIndex * bytesPerFrame;
    var buffer = instance.byteArray.buffer;
    var byteOffset = instance.byteArray.byteOffset + baseOffset;

    if (bytesPerSample === 1) return new Uint8Array(buffer, byteOffset, pixelsPerFrame);
    if (instance.syntaxKind === "explicit-big-endian") {
      // Rare (retired in modern DICOM) — byte-swap explicitly.
      var swapped = new Uint16Array(pixelsPerFrame);
      var dv = new DataView(buffer, byteOffset, pixelsPerFrame * 2);
      for (var i = 0; i < pixelsPerFrame; i++) swapped[i] = dv.getUint16(i * 2, false);
      return instance.pixelRepresentation === 1 ? new Int16Array(swapped.buffer) : swapped;
    }
    if (instance.pixelRepresentation === 1) return new Int16Array(buffer, byteOffset, pixelsPerFrame);
    return new Uint16Array(buffer, byteOffset, pixelsPerFrame);
  }

  /**
   * Pull one frame out of encapsulated (compressed) Pixel Data and decode it.
   *
   * Compressed frames are carried as fragments after a Basic Offset Table.
   * When that table is present it says where each frame starts; when it is
   * absent the common case is one fragment per frame, which is what the
   * fallback assumes.
   */
  function decodeCompressedFrame(instance, frameIndex) {
    var element = instance.pixelDataElement;
    var bytes;
    try {
      bytes = element.basicOffsetTable && element.basicOffsetTable.length
        ? dicomParser.readEncapsulatedImageFrame(instance.dataSet, element, frameIndex)
        : dicomParser.readEncapsulatedPixelDataFromFragments(instance.dataSet, element, frameIndex);
    } catch (err) {
      throw new Error("Could not read compressed frame " + (frameIndex + 1) + ": " + err.message);
    }
    return CODECS.decodeFrame(instance.transferSyntax, bytes, {
      rows: instance.rows,
      columns: instance.columns,
      samplesPerPixel: instance.samplesPerPixel,
      bitsAllocated: instance.bitsAllocated,
      bitsStored: instance.bitsStored,
      pixelRepresentation: instance.pixelRepresentation,
    });
  }

  /** Name the transfer syntax and say what to do about it. */
  function unsupportedSyntaxMessage(transferSyntax) {
    var name = CODECS.describeSyntax(transferSyntax);
    var what = name ? name + " (" + transferSyntax + ")" : "transfer syntax " + transferSyntax;
    return "This file uses " + what + ", which this viewer cannot decode. " +
      "It reads uncompressed DICOM, RLE Lossless and JPEG Lossless. " +
      "Re-export the study as uncompressed, or convert it first with " +
      "dcmdjpeg (DCMTK), gdcmconv --raw, or dcm2niix.";
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
  /**
   * Key a stack by series *and* acquisition dimension.
   *
   * A multi-echo or dynamic series carries several images at the same
   * physical location. Stacking them together produces a volume with
   * duplicate slice positions and reconstructions that interleave two
   * different contrasts, so each echo and time point is its own stack.
   */
  function stackKey(instance) {
    var extra = [instance.echoNumber, instance.temporalPosition].join("/");
    return extra === "/" ? instance.seriesUID : instance.seriesUID + "#" + extra;
  }

  function addInstance(instance) {
    var uid = stackKey(instance);
    var group = state.seriesMap[uid];
    if (!group) {
      group = {
        uid: uid,
        baseSeriesUID: instance.seriesUID,
        echoNumber: instance.echoNumber,
        temporalPosition: instance.temporalPosition,
        studyUID: instance.studyUID,
        studyDescription: instance.studyDescription,
        studyDate: instance.studyDate,
        seriesNumber: isNaN(instance.seriesNumber) ? null : instance.seriesNumber,
        description: instance.seriesDescription || "(no series description)",
        modality: instance.modality || "",
        instances: [],
        seenSopUids: {},
      };
      state.seriesMap[uid] = group;
      state.seriesOrder.push(uid);
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

  /**
   * Say which echo or time point a stack is, but only when the series
   * actually split — an unqualified single-echo series needs no label.
   */
  function labelSplitStacks() {
    var byBase = {};
    state.seriesOrder.forEach(function (uid) {
      var g = state.seriesMap[uid];
      var base = g.baseSeriesUID || uid;
      (byBase[base] = byBase[base] || []).push(g);
    });
    Object.keys(byBase).forEach(function (base) {
      var groups = byBase[base];
      if (groups.length < 2 || groups[0].splitLabelled) return;
      groups.forEach(function (g) {
        var bits = [];
        if (g.echoNumber) bits.push("Echo " + g.echoNumber);
        if (g.temporalPosition) bits.push("Time " + g.temporalPosition);
        if (bits.length) g.description += " · " + bits.join(", ");
        g.splitLabelled = true;
      });
    });
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
          // The stack key, not the raw Series UID: a multi-echo series splits
          // into several stacks and the raw UID matches none of them.
          if (firstNewSeriesUID === null) firstNewSeriesUID = stackKey(instance);
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

    labelSplitStacks();
    renderSeriesList();
    var parts = [loaded + " image" + (loaded === 1 ? "" : "s") + " loaded"];
    if (skipped) parts.push(skipped + " skipped (not readable DICOM)");
    if (state.duplicateCount) parts.push(state.duplicateCount + " duplicate(s) ignored");
    showToast(parts.join(", ") + ".");

    // Show what was just opened. Loading a study and seeing nothing change
    // reads as a failure; the previous series is one click away in the panel.
    if (firstNewSeriesUID && firstNewSeriesUID !== state.currentSeriesUID) {
      selectSeries(firstNewSeriesUID);
    } else if (!state.currentSeriesUID) {
      selectSeries(state.seriesOrder[0]);
    } else {
      renderSeriesList();
      syncLayoutControls();
    }
  }

  /* ---------------------------------------------------------------------
   * Series list UI
   * ------------------------------------------------------------------- */
  /**
   * Free-text worklist filter.
   *
   * Matches across patient name and ID, accession, study date and
   * description, modality and series description, so one box covers the
   * ways a reader actually looks for a study.
   */
  function seriesHaystack(group) {
    if (group._haystack) return group._haystack;
    var inst = group.slices && group.slices.length ? group.slices[0].instance
      : (group.instances && group.instances[0]);
    var ds = inst && inst.dataSet;
    var bits = [
      group.description, group.modality, group.studyDescription,
      formatDicomDate(group.studyDate), group.studyDate,
      inst && inst.modality,
      ds && formatPersonName(str(ds, "x00100010", "")),
      ds && str(ds, "x00100020", ""),
      ds && str(ds, "x00080050", ""),
      group.seriesNumber !== null && group.seriesNumber !== undefined
        ? "series " + group.seriesNumber : "",
    ];
    group._haystack = bits.filter(Boolean).join(" ").toLowerCase();
    return group._haystack;
  }

  function seriesMatchesFilter(group) {
    var q = (state.seriesFilter || "").trim().toLowerCase();
    if (!q) return true;
    var hay = seriesHaystack(group);
    // Every word must appear, so "ct chest" narrows rather than widens.
    return q.split(/\s+/).every(function (word) { return hay.indexOf(word) >= 0; });
  }

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
      var headerNode = null;
      if (showStudyHeaders) {
        var headerId = "study-" + study.uid;
        if (seriesNodes[headerId]) headerNode = seriesNodes[headerId].wrapper;
        if (!seriesNodes[headerId]) {
          var head = document.createElement("div");
          head.className = "study-header";
          head.innerHTML =
            "<span>" + escapeHtml(study.description || "Study") + "</span>" +
            '<span class="study-date">' + escapeHtml(formatDicomDate(study.date)) + "</span>";
          dom.seriesList.appendChild(head);
          seriesNodes[headerId] = { wrapper: head, sliceCount: -1 };
          headerNode = head;
        }
      }

      var visible = study.series.filter(seriesMatchesFilter);
      if (headerNode && showStudyHeaders) headerNode.style.display = visible.length ? "" : "none";
      study.series.forEach(function (group) {
        var uid = group.uid;
        var cached = seriesNodes[uid];
        if (!seriesMatchesFilter(group)) {
          if (cached && cached.wrapper.parentNode) {
            cached.wrapper.parentNode.removeChild(cached.wrapper);
            delete seriesNodes[uid];
          }
          return;
        }
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
    syncWindowControls();

    state.volume = null;
    planeCache = {}; planeCacheKeys = [];
    vrDirty = true;
    renderSeriesList();

    // Already reconstructed: reuse it rather than rebuilding.
    if (state.volumes[uid]) {
      state.volume = state.volumes[uid];
      afterPaint(function () { finishSeriesLoad(group); });
      return;
    }

    setBusy(true, "Reconstructing volume from " + group.slices.length + " slices…");
    afterPaint(function () {
      try {
        state.volume = group.slices.length >= 2 ? V.build(group.slices, decodeForVolume) : null;
      } catch (err) {
        state.volume = null;
        showToast("Couldn't build a volume: " + err.message, true);
      }
      if (state.volume) rememberVolume(uid, state.volume);

      finishSeriesLoad(group);
    });
  }

  /**
   * Keep a bounded number of reconstructed volumes, so a comparison pane can
   * hold a second study without rebuilding it on every switch.
   */
  function rememberVolume(uid, volume) {
    state.volumes[uid] = volume;
    volumeOrder = volumeOrder.filter(function (u) { return u !== uid; });
    volumeOrder.push(uid);
    while (volumeOrder.length > MAX_CACHED_VOLUMES) {
      var drop = volumeOrder.shift();
      // Never evict a volume a pane is showing.
      var inUse = state.cells.some(function (c) { return c.seriesUid === drop; });
      if (drop === state.currentSeriesUID || inUse) { volumeOrder.push(drop); break; }
      delete state.volumes[drop];
      delete state.seriesIndex[drop];
    }
  }

  function finishSeriesLoad(group) {
    if (state.volume) {
      var rec = indexRecord(state.currentSeriesUID);
      // Start at the middle of each axis, which is where anatomy usually is.
      MPR_PLANES.forEach(function (plane) {
        if (!rec[plane]) rec[plane] = Math.floor(V.planeCount(state.volume, plane) / 2);
      });
      if (state.boneCut) recomputeBoneMask();
    }

    resetView();
    // Only the half-drawn shape is abandoned. Measurements now carry the
    // series they were drawn on and are filtered by it, so changing series
    // no longer needs to throw the previous one's work away — and anything
    // saved for this series comes back.
    cancelPending();
    restoreMeasurements(state.currentSeriesUID);
    renderMeasurementList();
    setBusy(false);
    updateVolumeInfo();
    swapReportToStudy();
    syncModalityControls();
    // Whether one sequence per pane is even possible depends on how many
    // series are loaded, so the plane buttons have to be refreshed when
    // that changes — not only when the layout does.
    syncLayoutControls();
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

  /** Pointer angle about the pane's centre, on screen. */
  function screenAngleAt(i, clientX, clientY) {
    var rec = cellEls[i];
    if (!rec) return null;
    var r = rec.canvas.getBoundingClientRect();
    var dx = clientX - (r.x + r.width / 2);
    var dy = clientY - (r.y + r.height / 2);
    if (!dx && !dy) return null;
    return Math.atan2(dy, dx);
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

  function volumeCenterMm(vol) {
    var v = vol || state.volume;
    return [
      ((v.cols - 1) / 2) * v.spacingX,
      ((v.rows - 1) / 2) * v.spacingY,
      ((v.depth - 1) / 2) * v.spacingZ,
    ];
  }

  /** Signed distance of a plane's cut from the volume centre, in mm. */
  function planeOffsetMm(plane, vol, rec) {
    var v = vol || state.volume;
    var r = rec || state.index;
    var count = V.planeCount(v, plane);
    return (r[plane] - (count - 1) / 2) * V.normalSpacing(v, plane);
  }

  /** The crosshair point — where all three cuts meet — in millimetres. */
  function crosshairWorld(vol, rec) {
    var v = vol || state.volume;
    var r = rec || state.index;
    var c = volumeCenterMm(v);
    MPR_PLANES.forEach(function (plane) {
      var n = state.frames[plane].n;
      var off = planeOffsetMm(plane, v, r);
      c[0] += n[0] * off; c[1] += n[1] * off; c[2] += n[2] * off;
    });
    return c;
  }

  /** Inverse of crosshairWorld: nearest slice index on each plane. */
  function indicesFromWorld(w, vol) {
    var v = vol || state.volume;
    var vc = volumeCenterMm(v);
    var d = [w[0] - vc[0], w[1] - vc[1], w[2] - vc[2]];
    var out = {};
    MPR_PLANES.forEach(function (plane) {
      var count = V.planeCount(v, plane);
      var pitch = V.normalSpacing(v, plane);
      out[plane] = Math.round(dot3(d, state.frames[plane].n) / pitch + (count - 1) / 2);
    });
    return out;
  }

  /** World centre of a rendered plane. */
  function planeCenterWorld(plane, slab, index, vol) {
    if (slab && slab.oblique) return slab.center;
    var v = vol || state.volume;
    if (index === undefined || index === null) index = state.index[plane];
    var c = volumeCenterMm(v);
    var n = state.frames[plane].n;
    var count = V.planeCount(v, plane);
    var off = (index - (count - 1) / 2) * V.normalSpacing(v, plane);
    return [c[0] + n[0] * off, c[1] + n[1] * off, c[2] + n[2] * off];
  }

  function planeAxesOf(plane, slab) {
    if (slab && slab.oblique) return { u: slab.axisU, v: slab.axisV };
    return state.frames[plane];
  }

  /** Plane column/row -> millimetres. Valid for orthogonal and oblique alike. */
  function planeToWorld(plane, slab, px, py, index, vol) {
    var f = planeAxesOf(plane, slab);
    var c = planeCenterWorld(plane, slab, index, vol);
    var a = (px - slab.width / 2) * slab.spacingX;
    var b = (py - slab.height / 2) * slab.spacingY;
    return [
      c[0] + f.u[0] * a + f.v[0] * b,
      c[1] + f.u[1] * a + f.v[1] * b,
      c[2] + f.u[2] * a + f.v[2] * b,
    ];
  }

  /** Millimetres -> plane column/row (the in-plane part; exact inverse). */
  function worldToPlane(plane, slab, w, index, vol) {
    var f = planeAxesOf(plane, slab);
    var c = planeCenterWorld(plane, slab, index, vol);
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
  function getPlaneData(plane, index, vol, uid) {
    var volume = vol || state.volume;
    var seriesKey = uid || state.currentSeriesUID || "cur";
    if (index === undefined || index === null) index = state.index[plane];
    // Decided per plane: rotating in the axial view tilts coronal and
    // sagittal but leaves axial square, so axial keeps the fast path and its
    // full in-plane resolution.
    var oblique = planeOblique(plane);
    var frame = state.frames[plane];
    var key = [
      seriesKey, plane, index, state.thicknessMm, state.projectionMode,
      cutActive(volume) ? "cut" + state.boneMaskVersion + "." + (volume.sculptVersion || 0) : "raw",
      oblique ? frameKey(frame) + "|" + state.index.axial + "," +
        state.index.coronal + "," + state.index.sagittal : "ortho",
    ].join("|");

    if (planeCache[key]) return planeCache[key];

    var opts = {
      thicknessMm: state.thicknessMm,
      mode: state.projectionMode,
      boneCut: cutActive(volume),
    };
    // The axis-aligned path is a plain blit, so keep using it while the frames
    // are at rest; only a genuine tilt pays for trilinear resampling.
    var result = oblique
      ? V.extractOblique(volume, obliqueCenterFor(plane, index, volume), frame.u, frame.v, opts)
      : V.extractPlane(volume, plane, index, opts);

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
  function obliqueCenterFor(plane, index, vol) {
    var v = vol || state.volume;
    var c = crosshairWorld(v);
    var delta = (index - state.index[plane]) * V.normalSpacing(v, plane);
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
    var vol = cellVolume(cell);
    var ctx = rec.ctx;
    resizeCanvas(rec.canvas);
    resizeCanvas(rec.cross);

    var cw = rec.canvas.width, ch = rec.canvas.height;
    // A small pane leaves little room, so the patient banner and the letters
    // step aside rather than covering the image.
    rec.root.classList.toggle("compact", rec.root.clientWidth < 320 || rec.root.clientHeight < 250);

    ctx.save();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cw, ch);

    if (!vol) {
      ctx.restore();
      clearOverlays(i);
      rec.geom = null;
      drawAnnotations(i, null);
      return;
    }

    var index = cellIndex(cell);
    var slab = getPlaneData(cell.plane, index, vol, cellSeriesUid(cell));
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

    rec.geom = {
      t: t, cw: cw, ch: ch, slab: slab, index: index, plane: cell.plane,
      vol: vol, uid: cellSeriesUid(cell),
    };
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
    if (!geom || !geom.vol) return;

    var dpr = window.devicePixelRatio || 1;
    if (state.crosshair) drawCrosshair(ctx, geom, dpr);
    drawFocus(ctx, geom, dpr);
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
    var vol = geom.vol || state.volume;
    var rec = indexRecord(geom.uid);
    var f = planeAxesOf(plane, slab);
    var cp = planeCenterWorld(plane, slab, geom.index, vol);
    var cq = planeCenterWorld(other, null, rec[other], vol);
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

    // The grip at the intersection. Drawn at the size it is hit-tested at,
    // so what can be grabbed is exactly what is shown — an invisible
    // draggable region is a feature nobody finds.
    var grip = crosshairCanvasPoint(geom);
    if (grip) {
      ctx.setLineDash([]);
      ctx.lineWidth = Math.max(1.4, 1.4 * dpr);
      ctx.strokeStyle = tilted ? "rgba(110, 242, 160, 0.95)" : "rgba(255, 210, 74, 0.95)";
      ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
      ctx.beginPath();
      ctx.arc(grip.x, grip.y, CROSSHAIR_GRIP_PX * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
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
  /**
   * Where this pane draws the crosshair intersection, in canvas pixels.
   * Null when there is nothing to draw.
   */
  function crosshairCanvasPoint(geom) {
    if (!geom || !geom.vol || geom.plane === "vr") return null;
    var world = crosshairWorld(geom.vol, indexRecord(geom.uid));
    var pp = worldToPlane(geom.plane, geom.slab, world, geom.index, geom.vol);
    if (!pp || !isFinite(pp.x) || !isFinite(pp.y)) return null;
    return planeToCanvas(geom.t, pp.x, pp.y);
  }

  /**
   * Is the cursor on this pane's crosshair grip?
   *
   * Only the intersection counts, and only within a small radius. The arms
   * were tried and are wrong: they run the full width and height of the
   * pane, so accepting them turns a cross-shaped band through the middle of
   * the image into a region where a window/level drag silently moves the
   * crosshair instead, and where a measurement handle sitting under an arm
   * cannot be picked up at all.
   *
   * The radius is in screen pixels, so the grip stays the same size to the
   * hand at any zoom.
   */
  var CROSSHAIR_GRIP_PX = 11;

  function hitTestCrosshair(i, clientX, clientY) {
    if (!state.crosshair) return null;
    var rec = cellEls[i], geom = rec && rec.geom;
    if (!geom) return null;
    var centre = crosshairCanvasPoint(geom);
    if (!centre) return null;
    var rect = rec.canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var cx = (clientX - rect.left) * dpr, cy = (clientY - rect.top) * dpr;
    return Math.hypot(centre.x - cx, centre.y - cy) <= CROSSHAIR_GRIP_PX * dpr
      ? { centre: true } : null;
  }

  function crosshairFromPoint(i, clientX, clientY) {
    if (!state.volume) return;
    var rec = cellEls[i], geom = rec && rec.geom;
    if (!geom) return;
    var p = eventToCell(i, clientX, clientY);
    if (!p) return;
    var t = geom.t;
    if (p.x < 0 || p.x > t.width || p.y < 0 || p.y > t.height) return;

    // Go through millimetres so the click lands correctly on a tilted plane.
    var world = planeToWorld(geom.plane, geom.slab, p.x, p.y, geom.index, geom.vol);
    var want = indicesFromWorld(world, geom.vol);
    var idx = indexRecord(geom.uid);
    MPR_PLANES.forEach(function (q) {
      if (q === geom.plane) return;    // clicking in-plane must not move this cut
      var count = V.planeCount(geom.vol, q);
      idx[q] = Math.max(0, Math.min(want[q], count - 1));
    });
    // Every other loaded sequence follows to the same place in the patient,
    // which is the point of moving the crosshair at all: one gesture, and
    // every section on screen is showing the same anatomy.
    if (state.link) linkSeriesToLocal(geom.uid, geom.vol, world);
    renderAll();
    syncSliders();
  }

  /**
   * Bring every other loaded series to a point given in one series' own
   * millimetres.
   *
   * Shared by the crosshair and the focus point.
   *
   * The mapping goes through patient coordinates, which makes it exact for
   * *any* pair of orientations: a point picked on an axial T2 expressed in
   * a sagittal T1's own axes is still the same place in the patient. An
   * earlier version required the two series to have been acquired the same
   * way round, which was simply wrong — and the wrong way: it quietly
   * demoted a sagittal sequence to slice-level matching by a Z that, for a
   * sagittal stack, is the same on every slice and so locates nothing.
   *
   * The genuine fallback is narrower: a series with no Image Position /
   * Orientation (Patient) at all. There, matching the axial level by Z is
   * the most that can honestly be done.
   */
  function linkSeriesToLocal(fromUid, fromVol, local) {
    var patient = V.toPatient(fromVol, local);
    if (!patient) return;
    Object.keys(state.volumes).forEach(function (uid) {
      if (uid === fromUid) return;
      var vol = state.volumes[uid];
      if (!vol || vol === fromVol) return;
      if (V.hasPatientFrame(vol)) {
        applyLocalTo(uid, vol, V.fromPatient(vol, patient));
      } else {
        var hit = V.sliceNearestZ(vol, patient[2]);
        if (hit) indexRecord(uid).axial = hit.index;
      }
    });
  }


  /* ---------------------------------------------------------------------
   * Focus point
   *
   * One anatomical point that every pane is made to show. Clicking it in
   * any pane moves all three planes to the cut that contains it, pulls the
   * other loaded series to the same place in the patient, and pans each
   * pane so the point sits in the middle — so scrolling, stacking and the
   * comparison panes all end up pointing at the same finding rather than
   * at the same slice number.
   *
   * The point is stored in *patient* millimetres when the series says where
   * it is, because that is the only frame two series share. Without Image
   * Position / Orientation (Patient) it falls back to the clicked series'
   * own voxel frame and says so, rather than inventing an alignment.
   * ------------------------------------------------------------------- */

  /** Turn a click into a focus point and move everything to it. */
  function focusFromPoint(i, clientX, clientY) {
    var rec = cellEls[i], geom = rec && rec.geom;
    if (!geom || !geom.vol) return false;
    var p = eventToCell(i, clientX, clientY);
    if (!p) return false;
    var t = geom.t;
    if (p.x < 0 || p.x > t.width || p.y < 0 || p.y > t.height) return false;

    var local = planeToWorld(geom.plane, geom.slab, p.x, p.y, geom.index, geom.vol);
    var patient = V.toPatient(geom.vol, local);
    state.focusPoint = {
      uid: geom.uid,
      local: local,
      patient: patient,
      label: geom.plane + " " + (geom.index + 1),
    };
    goToFocus(true);
    return true;
  }

  /**
   * Move every pane to the focus point.
   *
   * @param {boolean} centre  also pan each pane so the point is in the middle
   */
  function goToFocus(centre) {
    var f = state.focusPoint;
    if (!f) return false;

    // 1. The series the point was picked in: all three planes, exactly.
    var home = volumeFor(f.uid);
    if (home) applyLocalTo(f.uid, home, f.local);

    // 2. Every other loaded series, if linking is on.
    if (state.link && home) linkSeriesToLocal(f.uid, home, f.local);

    // 3. Pinned panes hold their own slice, so they have to be told directly.
    state.cells.forEach(function (cell) {
      if (!cell.pinned || cell.plane === "vr") return;
      var uid = cellSeriesUid(cell);
      var r = indexRecord(uid);
      if (r && typeof r[cell.plane] === "number") cell.index = r[cell.plane];
    });

    renderAll();
    syncSliders();
    if (centre) centrePanesOnFocus();
    updateFocusStatus();
    return true;
  }

  /** Set one series' three plane indices from a point in its own frame. */
  function applyLocalTo(uid, vol, local) {
    var want = indicesFromWorld(local, vol);
    var r = indexRecord(uid);
    MPR_PLANES.forEach(function (q) {
      var count = V.planeCount(vol, q);
      r[q] = Math.max(0, Math.min(want[q], count - 1));
    });
  }

  /** The volume behind a series UID, current or comparison. */
  function volumeFor(uid) {
    if (!uid) return state.volume;
    if (uid === state.currentSeriesUID) return state.volume;
    return state.volumes[uid] || null;
  }

  /**
   * Pan each pane so the focus point lands in the middle of it.
   *
   * Done after a render, because it needs each pane's live transform: the
   * correction is the vector from where the point currently draws to the
   * pane's centre, which survives zoom, rotation and flipping without any
   * special cases.
   */
  function centrePanesOnFocus() {
    var f = state.focusPoint;
    if (!f) return;
    var moved = false;
    state.cells.forEach(function (cell, i) {
      if (cell.plane === "vr") return;
      var rec = cellEls[i], geom = rec && rec.geom;
      if (!geom || !geom.vol) return;
      var local = localForCell(f, geom);
      if (!local) return;
      var pp = worldToPlane(geom.plane, geom.slab, local, geom.index, geom.vol);
      if (!pp) return;
      var here = planeToCanvas(geom.t, pp.x, pp.y);
      cell.view.panX += geom.cw / 2 - here.x;
      cell.view.panY += geom.ch / 2 - here.y;
      moved = true;
    });
    if (moved) renderAll();
  }

  /** The focus point in one pane's own volume frame, or null. */
  function localForCell(f, geom) {
    if (geom.uid === f.uid) return f.local;
    if (!f.patient || !V.hasPatientFrame(geom.vol)) return null;
    return V.fromPatient(geom.vol, f.patient);
  }

  function clearFocus() {
    state.focusPoint = null;
    setFocusPick(false);
    updateFocusStatus();
    renderAll();
  }

  function setFocusPick(on) {
    state.focusPick = !!on;
    if (dom.focusBtn) dom.focusBtn.classList.toggle("active", state.focusPick);
    if (state.focusPick) {
      setStatus("Focus: click the point you want every pane to show.");
    }
    updateFocusStatus();
  }

  /** Keep the Go button and the status line telling the truth. */
  function updateFocusStatus() {
    if (dom.focusGoBtn) dom.focusGoBtn.disabled = !state.focusPoint;
    syncMoreMenu();
    if (!dom.focusNote) return;
    var f = state.focusPoint;
    if (!f) {
      dom.focusNote.textContent = "No focus point. Turn on 🎯 and click the finding you " +
        "want every pane, every plane and every comparison series to show.";
      return;
    }
    var where = f.patient
      ? "patient " + f.patient.map(function (v) { return v.toFixed(1); }).join(", ") + " mm"
      : "this series only — no Image Position (Patient), so other series cannot be lined up";
    var others = [];
    var home = volumeFor(f.uid);
    Object.keys(state.volumes).forEach(function (uid) {
      var vol = state.volumes[uid];
      if (uid === f.uid || !vol || !home || vol === home) return;
      var how = !f.patient ? "not linked"
        : V.hasPatientFrame(vol)
          ? (V.sameFrame(home, vol) ? "in-plane match"
             : "matched in patient coordinates (" +
               (V.acquisitionPlane(vol) || {}).plane + " acquisition)")
          : "slice level only (no Image Position/Orientation)";
      // Snapping to the nearest slice always succeeds, even when the other
      // series does not reach this level at all. Saying only "match" there
      // would be the most misleading thing on the screen.
      var gap = focusGapFor(uid, vol);
      if (gap !== null && gap > 1.0) {
        how = "nearest slice is " + gap.toFixed(1) + " mm away — outside this series";
      }
      others.push(seriesShortName(uid) + ": " + how);
    });
    dom.focusNote.textContent = "Focused on " + where +
      (others.length ? " · " + others.join(" · ") : "");
  }

  /**
   * How far a series' current cut actually is from the focus point, in
   * millimetres, or null when it cannot be told.
   *
   * Measured from where the series ended up rather than from where it was
   * asked to go, so clamping at the end of a short stack shows up.
   */
  function focusGapFor(uid, vol) {
    var f = state.focusPoint;
    if (!f || !f.patient || !vol || !V.hasPatientFrame(vol)) return null;
    var at = V.toPatient(vol, crosshairWorld(vol, indexRecord(uid)));
    if (!at) return null;
    return Math.hypot(at[0] - f.patient[0], at[1] - f.patient[1], at[2] - f.patient[2]);
  }

  /**
   * Draw the focus point on a pane.
   *
   * A solid ring means the point is on this cut. A dashed ring with an
   * arrow means it is off to one side, and which way to scroll to reach
   * it — an unmarked pane that simply is not showing the finding is the
   * thing worth avoiding.
   */
  function drawFocus(ctx, geom, dpr) {
    var f = state.focusPoint;
    if (!f) return;
    var local = localForCell(f, geom);
    if (!local) return;
    var pp = worldToPlane(geom.plane, geom.slab, local, geom.index, geom.vol);
    if (!pp) return;

    // How far off this cut the point is, along the plane's normal.
    var centre = planeCenterWorld(geom.plane, geom.slab, geom.index, geom.vol);
    var n = state.frames[geom.plane].n;
    var away = dot3([local[0] - centre[0], local[1] - centre[1], local[2] - centre[2]], n);
    var half = Math.max(V.normalSpacing(geom.vol, geom.plane), state.thicknessMm) / 2;
    var onCut = Math.abs(away) <= half + 1e-6;

    var c = planeToCanvas(geom.t, pp.x, pp.y);
    var r = 9 * dpr;
    ctx.save();
    ctx.strokeStyle = onCut ? "#ff7ad9" : "rgba(255,122,217,0.55)";
    ctx.lineWidth = Math.max(1.5, 1.6 * dpr);
    if (!onCut) ctx.setLineDash([3 * dpr, 3 * dpr]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c.x - r - 4 * dpr, c.y); ctx.lineTo(c.x - r + 2 * dpr, c.y);
    ctx.moveTo(c.x + r - 2 * dpr, c.y); ctx.lineTo(c.x + r + 4 * dpr, c.y);
    ctx.moveTo(c.x, c.y - r - 4 * dpr); ctx.lineTo(c.x, c.y - r + 2 * dpr);
    ctx.moveTo(c.x, c.y + r - 2 * dpr); ctx.lineTo(c.x, c.y + r + 4 * dpr);
    ctx.stroke();
    if (!onCut) {
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,122,217,0.9)";
      ctx.font = Math.round(11 * dpr) + "px 'Segoe UI', Roboto, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText((away > 0 ? "▲ " : "▼ ") + Math.abs(away).toFixed(1) + " mm off cut",
        c.x + r + 5 * dpr, c.y - r);
    }
    ctx.restore();
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

  /**
   * Measurements that belong to the cut currently shown.
   *
   * The series has to match as well as the plane and the slice. Two studies
   * open side by side both have an "axial slice 40"; an ROI drawn on one of
   * them must not appear over the other patient's anatomy.
   */
  function measurementsFor(plane, index, uid) {
    var key = sliceKeyFor(plane, index);
    return state.measurements.filter(function (m) {
      return m.plane === plane && m.sliceIndex === key &&
        (uid === undefined || m.seriesUid === uid) && !m.hidden;
    });
  }

  /* ---------------------------------------------------------------------
   * Persistence
   * ------------------------------------------------------------------- */

  /**
   * Write every touched series' measurements to local storage.
   *
   * Series that *used* to have measurements are saved too, so deleting the
   * last ROI on a series clears its stored record instead of leaving a
   * stale one to reappear on the next reload.
   */
  function persistMeasurements() {
    if (!state.measurePersist) return;
    var uids = {};
    state.measureStoredUids.forEach(function (u) { uids[u] = true; });
    state.measurements.forEach(function (m) { if (m.seriesUid) uids[m.seriesUid] = true; });

    var kept = [];
    Object.keys(uids).forEach(function (u) {
      MEAS.saveFor(u, state.measurements);
      if (state.measurements.some(function (m) { return m.seriesUid === u; })) kept.push(u);
    });
    state.measureStoredUids = kept;
  }

  /** Pull a series' saved measurements back in, once, when it is opened. */
  function restoreMeasurements(uid) {
    if (!uid || !state.measurePersist || state.measureLoaded[uid]) return;
    state.measureLoaded[uid] = true;
    var saved = MEAS.loadFor(uid);
    if (!saved.length) return;
    // Guard against a double restore if the same series is opened twice.
    var have = {};
    state.measurements.forEach(function (m) { if (m.seriesUid === uid) have[m.id] = true; });
    var added = saved.filter(function (m) { return !have[m.id]; });
    if (!added.length) return;
    state.measurements = state.measurements.concat(added);
    if (state.measureStoredUids.indexOf(uid) < 0) state.measureStoredUids.push(uid);
    renderMeasurementList();
    renderAllOverlays();
  }

  /* ---------------------------------------------------------------------
   * Drawing
   * ------------------------------------------------------------------- */

  var MEASURE_COLOUR = "#4ad6ff";
  var MEASURE_SELECTED = "#6ef2a0";
  var MEASURE_PENDING = "#ffd24a";
  var ANNOT_COLOUR = "#ffb14a";

  function drawMeasurements(ctx, geom, dpr) {
    if (!state.showAnnotations) return;
    var plane = geom.plane;
    var list = measurementsFor(plane, geom.index, geom.uid);
    var pending = state.pendingMeasure &&
      state.pendingMeasure.plane === plane &&
      state.pendingMeasure.seriesUid === geom.uid &&
      state.pendingMeasure.sliceIndex === sliceKeyFor(plane, geom.index)
      ? state.pendingMeasure : null;
    if (!list.length && !pending) return;

    var t = geom.t;
    var cal = calibrationFor(plane, geom.slab);

    ctx.save();
    ctx.lineWidth = Math.max(1.5, 1.5 * dpr);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.font = Math.round(12 * dpr) + "px 'Segoe UI', Roboto, sans-serif";
    ctx.textBaseline = "bottom";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 3 * dpr;

    list.forEach(function (m) {
      var colour = m.id === state.selectedMeasurement ? MEASURE_SELECTED
        : MEAS.isAnnotation(m.tool) ? ANNOT_COLOUR : MEASURE_COLOUR;
      drawOne(m, colour, false);
    });
    if (pending) drawOne(pending, MEASURE_PENDING, true);
    ctx.restore();

    function drawOne(m, colour, isPending) {
      var pts = m.points.map(function (p) { return planeToCanvas(t, p.x, p.y); });
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
      var tool = m.tool, T = MEAS.TOOLS;

      if (tool === T.point) {
        // A crosshair tick rather than a blob, so the pixel stays visible.
        var c0 = pts[0], arm = 7 * dpr;
        ctx.beginPath();
        ctx.moveTo(c0.x - arm, c0.y); ctx.lineTo(c0.x - 2 * dpr, c0.y);
        ctx.moveTo(c0.x + 2 * dpr, c0.y); ctx.lineTo(c0.x + arm, c0.y);
        ctx.moveTo(c0.x, c0.y - arm); ctx.lineTo(c0.x, c0.y - 2 * dpr);
        ctx.moveTo(c0.x, c0.y + 2 * dpr); ctx.lineTo(c0.x, c0.y + arm);
        ctx.stroke();
      } else if (tool === T.text) {
        drawCaption(pts[0], m.text || "…", colour, dpr);
      } else if (tool === T.rect && pts.length >= 2) {
        // Drawn through the transform so it rotates with the image.
        var rc = planeToCanvas(t, (m.points[0].x + m.points[1].x) / 2,
          (m.points[0].y + m.points[1].y) / 2);
        var rw = Math.abs(m.points[1].x - m.points[0].x) * t.spacingX * t.scale;
        var rh = Math.abs(m.points[1].y - m.points[0].y) * t.spacingY * t.scale;
        ctx.save();
        ctx.translate(rc.x, rc.y);
        ctx.rotate(t.rot);
        ctx.strokeRect(-rw / 2, -rh / 2, rw, rh);
        ctx.restore();
      } else if ((tool === T.ellipse || tool === T.circle) && pts.length >= 2) {
        // Both are drawn from the same radii the statistics use, so what is
        // outlined is exactly what was measured.
        var e = MEAS.ellipseRadii(m, cal);
        if (e) {
          var c = planeToCanvas(t, e.cx, e.cy);
          ctx.save();
          ctx.translate(c.x, c.y);
          ctx.rotate(t.rot);
          ctx.beginPath();
          ctx.ellipse(0, 0, e.rx * t.spacingX * t.scale, e.ry * t.spacingY * t.scale,
            0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      } else if (tool === T.cobb && pts.length >= 2) {
        // Two independent lines, plus a dashed hint of where they would meet.
        // Below two points there is no line yet, and nothing to draw.
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y);
        if (pts.length >= 4) { ctx.moveTo(pts[2].x, pts[2].y); ctx.lineTo(pts[3].x, pts[3].y); }
        ctx.stroke();
        if (pts.length >= 4) {
          var meet = lineIntersection(pts[0], pts[1], pts[2], pts[3]);
          if (meet) {
            ctx.save();
            ctx.setLineDash([4 * dpr, 4 * dpr]);
            ctx.globalAlpha = 0.55;
            ctx.beginPath();
            ctx.moveTo(pts[1].x, pts[1].y); ctx.lineTo(meet.x, meet.y);
            ctx.moveTo(pts[3].x, pts[3].y); ctx.lineTo(meet.x, meet.y);
            ctx.stroke();
            ctx.restore();
          }
        }
      } else if (tool === T.arrow && pts.length >= 2) {
        drawArrow(ctx, pts[0], pts[1], dpr);
      } else if (pts.length >= 2) {
        // Distance, polyline, angle, polygon and the freehand shapes.
        var closed = tool === T.polygon || tool === T.freehandRoi;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        if (closed && !isPending) ctx.closePath();
        ctx.stroke();
      }

      // Handles. A traced shape has hundreds of points, so it shows only its
      // ends — a dot on every point would bury the anatomy underneath.
      if (tool !== T.point && tool !== T.text) {
        var handles = MEAS.isTrace(tool) ? [pts[0], pts[pts.length - 1]] : pts;
        handles.forEach(function (pp) {
          ctx.beginPath();
          ctx.arc(pp.x, pp.y, 3.5 * dpr, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // The move grip: drag it to shift the whole object without reshaping it.
      if (!isPending && m.id === state.selectedMeasurement && pts.length > 1) {
        var g = moveGripCanvas(m, t);
        ctx.save();
        ctx.setLineDash([]);
        ctx.strokeStyle = colour;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.beginPath();
        ctx.rect(g.x - 4.5 * dpr, g.y - 4.5 * dpr, 9 * dpr, 9 * dpr);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      if (isPending) return;
      if (tool === T.text) return;                 // its caption is the label

      var res = MEAS.evaluate(m, geom.slab, cal);
      if (res.annotation && !m.text) return;       // an arrow with nothing to say
      var unit = MEAS.reportsIntensity(tool) ? (" " + intensitySuffix(geom.slab)).trimEnd() : "";
      var label = res.primary + unit;
      var anchor = labelAnchor(pts, tool);
      ctx.fillText(label, anchor.x + 8 * dpr, anchor.y - 6 * dpr);
    }

    /** Where a shape's readout sits: clear of the shape, but attached to it. */
    function labelAnchor(pts, tool) {
      if (!MEAS.isRoi(tool)) return pts[pts.length - 1];
      var top = pts[0];
      pts.forEach(function (p) { if (p.y < top.y || (p.y === top.y && p.x > top.x)) top = p; });
      return top;
    }

    function drawCaption(at, text, colour, d) {
      var pad = 4 * d;
      var w = ctx.measureText(text).width;
      var h = 14 * d;
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(at.x, at.y - h - pad, w + pad * 2, h + pad * 1.4);
      ctx.strokeStyle = colour;
      ctx.lineWidth = Math.max(1, d);
      ctx.strokeRect(at.x, at.y - h - pad, w + pad * 2, h + pad * 1.4);
      ctx.fillStyle = colour;
      ctx.fillText(text, at.x + pad, at.y);
      ctx.restore();
    }
  }

  function drawArrow(ctx, from, to, dpr) {
    var ang = Math.atan2(to.y - from.y, to.x - from.x);
    var head = 11 * dpr;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - head * Math.cos(ang - 0.4), to.y - head * Math.sin(ang - 0.4));
    ctx.lineTo(to.x - head * Math.cos(ang + 0.4), to.y - head * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
  }

  /** Where two infinite lines cross, or null when they are parallel. */
  function lineIntersection(a0, a1, b0, b1) {
    var d1x = a1.x - a0.x, d1y = a1.y - a0.y;
    var d2x = b1.x - b0.x, d2y = b1.y - b0.y;
    var den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-9) return null;
    var t = ((b0.x - a0.x) * d2y - (b0.y - a0.y) * d2x) / den;
    return { x: a0.x + d1x * t, y: a0.y + d1y * t };
  }

  /** The move grip, in plane coordinates. */
  function moveGrip(m) {
    if (m.tool === MEAS.TOOLS.circle) return { x: m.points[0].x, y: m.points[0].y };
    return MEAS.centroid(m.points);
  }

  function moveGripCanvas(m, t) {
    var g = moveGrip(m);
    return planeToCanvas(t, g.x, g.y);
  }

  /* ---------------------------------------------------------------------
   * Placing measurements
   * ------------------------------------------------------------------- */

  /** Stamp a new measurement with where it belongs and keep it. */
  function commitMeasurement(m) {
    state.measurements.push(m);
    state.selectedMeasurement = m.id;
    state.pendingMeasure = null;
    persistMeasurements();
    renderMeasurementList();
  }

  /** Handle a click while a measurement tool is active. */
  function measureClick(i, clientX, clientY) {
    var rec = cellEls[i], geom = rec && rec.geom;
    if (!geom) return;
    var p = eventToCell(i, clientX, clientY);
    if (!p) return;
    var tool = state.tool;
    if (tool === MEAS.TOOLS.none || tool === "sculpt") return;

    var key = sliceKeyFor(geom.plane, geom.index);
    var pending = state.pendingMeasure;
    var sameCut = pending && pending.plane === geom.plane &&
      pending.seriesUid === geom.uid && pending.sliceIndex === key;

    // Starting somewhere else abandons the half-finished shape rather than
    // stretching it across two different cuts.
    if (!sameCut) {
      pending = state.pendingMeasure =
        MEAS.createMeasurement(tool, geom.plane, key, [p], { seriesUid: geom.uid });
      state.measureCell = i;
      if (MEAS.isVariable(tool)) { renderAllOverlays(); return; }
      if (pending.points.length >= MEAS.pointsNeeded(tool)) finishFixed(pending);
      renderAllOverlays();
      return;
    }

    if (MEAS.isVariable(tool)) {
      // Clicking the first vertex again closes the shape.
      var first = pending.points[0];
      if (pending.points.length >= MEAS.minPoints(tool) &&
          Math.hypot(p.x - first.x, p.y - first.y) * geom.slab.spacingX < 3) {
        finishPending();
        return;
      }
      pending.points.push({ x: p.x, y: p.y });
      renderAllOverlays();
      return;
    }

    pending.points.push({ x: p.x, y: p.y });
    if (pending.points.length >= MEAS.pointsNeeded(tool)) finishFixed(pending);
    renderAllOverlays();

    function finishFixed(m) {
      if (MEAS.wantsText(m.tool)) { commitMeasurement(m); promptForText(m); return; }
      commitMeasurement(m);
    }
  }

  /** Close a variable-point or traced shape, if it has enough points. */
  function finishPending() {
    var pending = state.pendingMeasure;
    if (!pending) return false;
    if (pending.points.length < MEAS.minPoints(pending.tool)) {
      state.pendingMeasure = null;
      renderAllOverlays();
      return false;
    }
    commitMeasurement(pending);
    renderAllOverlays();
    return true;
  }

  function cancelPending() {
    if (!state.pendingMeasure) return false;
    state.pendingMeasure = null;
    renderAllOverlays();
    return true;
  }

  /** Live preview of the in-progress measurement as the mouse moves. */
  function measureHover(i, clientX, clientY) {
    var pending = state.pendingMeasure;
    var geom = cellEls[i] && cellEls[i].geom;
    if (!pending || !geom || pending.plane !== geom.plane) return;
    if (MEAS.isTrace(pending.tool)) return;      // traced shapes follow the drag
    var p = eventToCell(i, clientX, clientY);
    if (!p) return;
    var saved = pending.points;
    var preview;
    if (MEAS.isVariable(pending.tool)) {
      preview = saved.concat([p]);               // rubber-band to the cursor
    } else {
      preview = saved.slice(0, MEAS.pointsNeeded(pending.tool) - 1).concat([p]);
    }
    pending.points = preview;
    renderCellOverlay(i);
    pending.points = saved;
  }

  /* ---------------------------------------------------------------------
   * Editing an existing measurement
   * ------------------------------------------------------------------- */

  /**
   * What lies under the cursor: a vertex to reshape, or the move grip.
   *
   * The tolerance is in screen pixels, so a handle stays equally easy to
   * grab whether the pane is zoomed in or out.
   */
  function hitTestMeasurement(i, clientX, clientY) {
    if (!state.showAnnotations) return null;
    if (state.pendingMeasure) return null;      // finish the shape first
    // Handles are live only while Navigate is the active tool. The rule
    // lives here rather than in the caller so there is one place that
    // decides it, and one place to test.
    if (state.tool !== MEAS.TOOLS.none) return null;
    var rec = cellEls[i], geom = rec && rec.geom;
    if (!geom) return null;
    var rect = rec.canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var cx = (clientX - rect.left) * dpr, cy = (clientY - rect.top) * dpr;
    var tol = 9 * dpr;
    var list = measurementsFor(geom.plane, geom.index, geom.uid);

    // Newest first, so a shape drawn on top of another is the one grabbed.
    for (var k = list.length - 1; k >= 0; k--) {
      var m = list[k];
      if (m.id === state.selectedMeasurement && m.points.length > 1) {
        var g = moveGripCanvas(m, geom.t);
        if (Math.hypot(g.x - cx, g.y - cy) <= tol) return { m: m, move: true };
      }
      // A traced shape has too many vertices to reshape one at a time.
      if (MEAS.isTrace(m.tool)) {
        var ends = [0, m.points.length - 1];
        for (var e = 0; e < ends.length; e++) {
          var pe = planeToCanvas(geom.t, m.points[ends[e]].x, m.points[ends[e]].y);
          if (Math.hypot(pe.x - cx, pe.y - cy) <= tol) return { m: m, move: true };
        }
        continue;
      }
      for (var v = 0; v < m.points.length; v++) {
        var pc = planeToCanvas(geom.t, m.points[v].x, m.points[v].y);
        if (Math.hypot(pc.x - cx, pc.y - cy) <= tol) return { m: m, vertex: v };
      }
    }
    return null;
  }

  /** Apply a drag to the measurement it grabbed. */
  function dragMeasurement(drag, clientX, clientY) {
    var p = eventToCell(drag.cell, clientX, clientY);
    if (!p) return;
    if (drag.move) {
      MEAS.translate(drag.m, p.x - drag.last.x, p.y - drag.last.y);
      drag.last = { x: p.x, y: p.y };
    } else {
      drag.m.points[drag.vertex].x = p.x;
      drag.m.points[drag.vertex].y = p.y;
    }
    renderAllOverlays();
    renderMeasurementList();
  }

  /** Redraw just the annotation layer for one pane. */
  function renderCellOverlay(i) {
    var rec = cellEls[i];
    if (rec && rec.geom) drawAnnotations(i, rec.geom);
  }

  function renderAllOverlays() {
    cellEls.forEach(function (rec, i) { if (rec.geom) drawAnnotations(i, rec.geom); });
  }

  /* ---------------------------------------------------------------------
   * Typed captions
   * ------------------------------------------------------------------- */

  /**
   * Open the inline caption editor over a measurement.
   *
   * A text annotation with no text is nothing at all, so cancelling a brand
   * new one deletes it rather than leaving an invisible marker behind.
   */
  function promptForText(m) {
    var box = dom.annotInput;
    if (!box) return;
    var rec = cellEls[state.measureCell];
    var geom = rec && rec.geom;
    var wasNew = !m.text;
    box.hidden = false;
    dom.annotField.value = m.text || "";

    if (geom) {
      var rect = rec.canvas.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      var at = planeToCanvas(geom.t, m.points[0].x, m.points[0].y);
      box.style.left = Math.round(rect.left + at.x / dpr) + "px";
      box.style.top = Math.round(rect.top + at.y / dpr + 6) + "px";
    }
    dom.annotField.focus();
    dom.annotField.select();

    state.textTarget = { m: m, wasNew: wasNew };
  }

  function commitText(keep) {
    var target = state.textTarget;
    dom.annotInput.hidden = true;
    state.textTarget = null;
    if (!target) return;
    var text = dom.annotField.value.trim();
    if (!keep || (!text && target.wasNew)) {
      if (target.wasNew) deleteMeasurement(target.m.id);
      renderAllOverlays();
      return;
    }
    target.m.text = text;
    persistMeasurements();
    renderMeasurementList();
    renderAllOverlays();
  }

  /* ---------------------------------------------------------------------
   * The measurement list
   * ------------------------------------------------------------------- */

  /** The slab of a visible pane showing this measurement's cut, if any. */
  function visibleSlabFor(m) {
    for (var i = 0; i < state.cells.length; i++) {
      var rec = cellEls[i], geom = rec && rec.geom;
      if (!geom || geom.plane !== m.plane || geom.uid !== m.seriesUid) continue;
      if (sliceKeyFor(geom.plane, geom.index) === m.sliceIndex) return geom.slab;
    }
    return null;
  }

  /** Short name of the series a measurement belongs to. */
  function seriesShortName(uid) {
    var group = state.seriesMap[uid];
    if (!group) return "—";
    return group.description || ("Series " + (group.number || "?"));
  }

  function renderMeasurementList() {
    var list = state.measurements;
    if (!list.length) {
      dom.measureList.innerHTML = '<p class="muted small">No measurements yet.</p>';
      renderHistogram();
      return;
    }
    var html = "";
    list.forEach(function (m) {
      var slab = visibleSlabFor(m);
      var res = slab ? MEAS.evaluate(m, slab, calibrationFor(m.plane, slab)) : null;
      var value;
      if (MEAS.isAnnotation(m.tool)) {
        value = m.text || MEAS.label(m.tool);
      } else if (res) {
        var unit = MEAS.reportsIntensity(m.tool) ? intensitySuffix(slab) : "";
        value = res.primary + (unit ? " " + unit : "");
      } else {
        value = "—";
      }
      var detail = res && res.detail && !MEAS.isAnnotation(m.tool) ? res.detail
        : seriesShortName(m.seriesUid);
      html +=
        '<div class="measure-row' + (m.id === state.selectedMeasurement ? " selected" : "") +
        (m.hidden ? " hidden-row" : "") + '" data-id="' + m.id + '">' +
        '<span class="measure-kind" title="' + escapeHtml(MEAS.label(m.tool)) + '">' +
        MEAS.glyph(m.tool) + "</span>" +
        '<span class="measure-main">' + escapeHtml(value) +
        '<span class="measure-detail">' + escapeHtml(detail || "") + "</span>" +
        "</span>" +
        '<span class="measure-loc">' + m.plane.slice(0, 3) + " " + sliceLabel(m) + "</span>" +
        '<button class="measure-eye" data-eye="' + m.id + '" title="' +
        (m.hidden ? "Show" : "Hide") + '">' + (m.hidden ? "◌" : "◉") + "</button>" +
        '<button class="measure-del" data-del="' + m.id + '" title="Delete">×</button>' +
        "</div>";
    });
    dom.measureList.innerHTML = html;
    renderHistogram();
  }

  /** The selected measurement, or null. */
  function selectedMeasurement() {
    var id = state.selectedMeasurement;
    if (!id) return null;
    for (var i = 0; i < state.measurements.length; i++) {
      if (state.measurements[i].id === id) return state.measurements[i];
    }
    return null;
  }

  /**
   * Distribution of the values inside the selected ROI.
   *
   * Drawn from the same pixels the ROI's mean came from, so the two can
   * never disagree — and labelled with the same units qualifier, so a slab
   * projection is not passed off as a thin-slice measurement.
   */
  function renderHistogram() {
    var canvas = dom.roiHistogram;
    if (!canvas) return;
    var m = selectedMeasurement();
    var slab = m && MEAS.isRoi(m.tool) ? visibleSlabFor(m) : null;
    var hist = slab ? MEAS.histogramOf(m, slab, calibrationFor(m.plane, slab), 48) : null;

    if (!hist) {
      canvas.hidden = true;
      dom.histogramNote.textContent = m && MEAS.isRoi(m.tool)
        ? "Bring the ROI's slice back on screen to see its histogram."
        : "Select a circle, ellipse, rectangle, polygon or freehand ROI to see its histogram.";
      return;
    }
    canvas.hidden = false;
    resizeCanvas(canvas);
    var ctx = canvas.getContext("2d");
    var w = canvas.width, h = canvas.height;
    var dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0b0d10";
    ctx.fillRect(0, 0, w, h);

    var n = hist.counts.length;
    var bw = w / n;
    ctx.fillStyle = "#4ad6ff";
    for (var i = 0; i < n; i++) {
      var bh = hist.peak ? (hist.counts[i] / hist.peak) * (h - 14 * dpr) : 0;
      ctx.fillRect(i * bw, h - bh, Math.max(1, bw - 0.5), bh);
    }
    // Mean marker, so the bar chart and the reported number line up visibly.
    var mx = ((hist.stats.mean - hist.min) / (hist.max - hist.min)) * w;
    ctx.strokeStyle = "#ffd24a";
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    ctx.moveTo(mx, 0); ctx.lineTo(mx, h);
    ctx.stroke();

    var unit = intensitySuffix(slab) || "";
    dom.histogramNote.textContent =
      Math.round(hist.min) + " to " + Math.round(hist.max) + " " + unit +
      " · n=" + hist.total + " · mean " + hist.stats.mean.toFixed(1) +
      " (yellow line)";
  }

  function toolGlyph(tool) { return MEAS.glyph(tool); }

  function setTool(tool) {
    // Switching tools abandons anything half-drawn rather than finishing it
    // with the wrong shape's rules.
    cancelPending();
    state.tool = tool;
    if (tool === MEAS.TOOLS.none) {
      setStatus("Navigate: drag a measurement's handle to reshape it, or its centre grip to move it.");
    } else if (tool === "crosshair") {
      // A crosshair you cannot see is one you cannot aim.
      if (!state.crosshair) { state.crosshair = true; renderAll(); }
      setStatus("Crosshair: drag anywhere to move the + — every plane, pane and " +
        "linked sequence follows it.");
    } else if (tool === "sculpt") setStatus("Sculpt: drag on any plane to cut tissue away.");
    else if (MEAS.isVariable(tool)) {
      setStatus(MEAS.label(tool) + ": click each point, then double-click, press Enter, " +
        "or click the first point again to close it.");
    } else if (MEAS.isTrace(tool)) {
      setStatus(MEAS.label(tool) + ": hold the left button and trace.");
    } else if (tool !== MEAS.TOOLS.none) {
      setStatus(MEAS.label(tool) + ": " + MEAS.pointsNeeded(tool) + " click" +
        (MEAS.pointsNeeded(tool) === 1 ? "" : "s") + ".");
    }
    syncToolControls();
    cellEls.forEach(function (rec, i) {
      if (state.cells[i] && state.cells[i].plane !== "vr") {
        rec.root.style.cursor = tool === MEAS.TOOLS.none ? "crosshair" : "cell";
      }
    });
    renderAllOverlays();
  }

  /** Keep the toolbar buttons and the overflow menu showing the live tool. */
  function syncToolControls() {
    var navigating = state.tool === MEAS.TOOLS.none;
    // The crosshair has its own button, so the Measure button must not
    // borrow its state — nor fall back to "Navigate", which is what an
    // unknown tool name used to make it say while the crosshair was armed.
    var measuring = !navigating && state.tool !== "crosshair";
    if (dom.navBtn) dom.navBtn.classList.toggle("active", navigating);
    if (dom.crosshairBtn) {
      dom.crosshairBtn.classList.toggle("active", state.tool === "crosshair");
    }
    if (dom.toolMenu) {
      Array.prototype.forEach.call(dom.toolMenu.querySelectorAll("[data-tool]"), function (btn) {
        btn.classList.toggle("on", btn.dataset.tool === state.tool);
      });
    }
    // The button names the tool it is holding. A menu that hides which tool
    // is armed is how a reader ends up drawing an ROI they meant to probe.
    if (dom.toolMoreBtn) {
      dom.toolMoreBtn.classList.toggle("active", measuring);
      dom.toolMoreBtn.textContent = measuring
        ? MEAS.glyph(state.tool) + " " + MEAS.label(state.tool) + " ▾" : "📏 Measure ▾";
      dom.toolMoreBtn.title = measuring
        ? "Active tool: " + MEAS.label(state.tool) : "Measure and annotate";
    }
  }

  function deleteMeasurement(id) {
    state.measurements = state.measurements.filter(function (m) { return m.id !== id; });
    if (state.selectedMeasurement === id) state.selectedMeasurement = null;
    persistMeasurements();
    renderMeasurementList();
    renderAllOverlays();
  }

  function toggleMeasurementHidden(id) {
    state.measurements.forEach(function (m) { if (m.id === id) m.hidden = !m.hidden; });
    persistMeasurements();
    renderMeasurementList();
    renderAllOverlays();
  }

  function clearMeasurements() {
    state.measurements = [];
    state.pendingMeasure = null;
    state.selectedMeasurement = null;
    persistMeasurements();
    renderMeasurementList();
    renderAllOverlays();
  }

  /** Measurements as report-ready lines, newest last. */
  function measurementLines() {
    return state.measurements.filter(function (m) { return !MEAS.isAnnotation(m.tool); })
      .map(function (m) {
        var slab = visibleSlabFor(m);
        var res = slab ? MEAS.evaluate(m, slab, calibrationFor(m.plane, slab)) : null;
        if (!res) return null;
        var unit = MEAS.reportsIntensity(m.tool) ? intensitySuffix(slab) : "";
        return MEAS.label(m.tool) + " — " + res.primary + (unit ? " " + unit : "") +
          " (" + m.plane + " " + sliceLabel(m) + ", " + seriesShortName(m.seriesUid) + ")";
      }).filter(Boolean);
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
    var uid = cellSeriesUid(cell);
    var group = state.seriesMap[uid] || getCurrentGroup();
    var first = group && group.slices.length ? group.slices[0].instance : null;
    var vol = cellVolume(cell);
    if (!vol) return;

    if (first) {
      var name = formatPersonName(str(first.dataSet, "x00100010", ""));
      var id = str(first.dataSet, "x00100020", "");
      rec.tl.textContent = (name ? name + "\n" : "") + (id ? "ID: " + id : "");
      rec.tr.textContent = (first.modality || "") + "\n" + (group.description || "") +
        (cell.seriesUid ? "\n[comparison]" : "");
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
    var offBy = linkGapFor(cell);
    // Say when a pane is showing a reconstruction rather than the slices as
    // acquired. On a thick MR stack that is the difference between a
    // diagnostic image and a smear, and the pixels alone do not admit it.
    var native = V.acquisitionPlane(vol);
    var reformatted = native && native.plane !== plane;
    rec.br.textContent =
      (cellIndex(cell) + 1) + " / " + count +
      (cell.pinned ? "  pinned" : cell.offset ? "  " + (cell.offset > 0 ? "+" : "") + cell.offset : "") +
      (offBy ? "\n⚠ " + offBy : "") +
      "\n" + thicknessLabel +
      (reformatted ? "\nreformatted from " + native.plane : "") +
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
      var rr0 = vrRange();
      renderer.setTransferFunction(state.vrPreset, rr0[0], rr0[1]);
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
      var range = vrRange();
      var packed = V.packTexture(state.volume, range[0], range[1], 256, cutActive(state.volume));
      r.setVolume(packed);
      r.setTransferFunction(state.vrPreset, range[0], range[1]);
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

  /**
   * The reset menu.
   *
   * One button that throws everything away is too blunt: losing a set of
   * measurements because the zoom needed straightening is a real cost. Each
   * kind of state resets on its own, and "everything" is spelled out.
   */
  /** Place a menu under its button, kept inside the viewport. */
  function openMenuUnder(menu, button) {
    closeMenus();
    menu.hidden = false;
    // Measure unclamped, so a menu that would fit is not scrolled for nothing.
    menu.style.maxHeight = "";
    var btn = button.getBoundingClientRect();
    var box = menu.getBoundingClientRect();
    var margin = 8;
    var left = Math.max(margin,
      Math.min(btn.right - box.width, window.innerWidth - box.width - margin));
    var top = Math.max(margin,
      Math.min(btn.bottom + 6, window.innerHeight - box.height - margin));
    // A menu taller than the window gets a scrollbar rather than items that
    // sit below the bottom edge: an item that has to be scrolled to is at
    // least reachable, one drawn off-screen is not.
    var room = window.innerHeight - top - margin;
    if (box.height > room) menu.style.maxHeight = Math.max(120, room) + "px";
    menu.style.left = Math.round(left) + "px";
    menu.style.top = Math.round(top) + "px";
  }

  /**
   * Wire a button to the menu it opens.
   *
   * Every toolbar group that holds more than a couple of related controls
   * collapses into one of these, which is what keeps the bar to a single
   * row with room to spare. `onPick` receives the dataset key of whichever
   * item was chosen.
   */
  function wireMenu(btn, menu, key, onPick, keepOpen) {
    if (!btn || !menu) return;
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var wasHidden = menu.hidden;
      closeMenus();
      if (wasHidden) openMenuUnder(menu, btn);
    });
    menu.addEventListener("click", function (e) {
      var item = e.target.closest("[data-" + key + "]");
      if (!item || item.disabled) return;
      onPick(item.dataset[key], item);
      if (!keepOpen) menu.hidden = true;
    });
  }

  /** True when any pop-up menu is showing. */
  function anyMenuOpen() {
    return MENUS.some(function (name) {
      var el = dom[name];
      return el && !el.hidden;
    });
  }

  function closeMenus() {
    MENUS.forEach(function (name) { if (dom[name]) dom[name].hidden = true; });
  }

  function applyReset(what) {
    var did = [];
    if (what === "view" || what === "all") {
      state.cells.forEach(function (cell) {
        cell.view = { zoom: 1, panX: 0, panY: 0, rotation: 0, flipH: false, flipV: false };
      });
      if (renderer) { renderer.rotX = -1.35; renderer.rotY = 0; renderer.distance = 2.6; }
      did.push("view");
    }
    if (what === "window" || what === "all") {
      resetWindowToStudy();
      did.push("window/level");
    }
    if (what === "oblique" || what === "all") {
      resetFrames();
      planeCache = {}; planeCacheKeys = [];
      did.push("planes");
    }
    if (what === "panes" || what === "all") {
      // Rebuild the panes this layout starts with, dropping per-pane
      // windows, pins and offsets.
      applyLayout(state.layout);
      did.push("panes");
    }
    if (what === "focus" || what === "all") {
      if (state.focusPoint || state.focusPick) did.push("focus point");
      clearFocus();
    }
    if (what === "measurements" || what === "all") {
      clearMeasurements();
      did.push("measurements");
    }
    syncCellControls();
    syncSliders();
    renderAll();
    showToast("Reset " + did.join(", ") + ".");
  }

  /** Window/level back to what the study itself asks for. */
  function resetWindowToStudy() {
    var group = getCurrentGroup();
    var inst = group && group.slices.length ? group.slices[0].instance : null;
    state.windowWidth = inst ? wwOf(inst) : 400;
    state.windowCenter = inst ? wcOf(inst) : 40;
    state.invert = false;
    state.cells.forEach(function (cell) { cell.wl = null; });
    syncWindowControls();
    updateWLInputs();
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
    setSeriesIndex(state.currentSeriesUID, plane, index, skipRender);
  }

  /**
   * Move one series' cut, then carry the others with it when linked.
   *
   * Linking is by patient position from Image Position (Patient), not by
   * slice number: two series of the same region routinely differ in slice
   * count, thickness and starting point, so matching indices would line up
   * the wrong anatomy. Only the axial axis is linked, because that is the
   * only axis a single-valued slice position defines.
   *
   * This is alignment by stated position, not registration. Nothing here
   * corrects for the patient having moved between the two acquisitions.
   */
  function setSeriesIndex(uid, plane, index, skipRender) {
    var vol = uid === state.currentSeriesUID ? state.volume : state.volumes[uid];
    if (!vol) return;
    var rec = indexRecord(uid);
    var count = V.planeCount(vol, plane);
    var clamped = Math.max(0, Math.min(index, count - 1));
    if (clamped === rec[plane]) return;
    rec[plane] = clamped;

    if (state.link && plane === "axial") linkOthersTo(uid, clamped);
    if (uid === state.currentSeriesUID && plane === "axial") highlightActiveThumb();
    if (!skipRender) {
      renderAll();
      syncSliders();
    }
  }

  /**
   * How far a comparison pane actually is from the linked position.
   *
   * Snapping to the nearest slice always succeeds, even when the other
   * study does not cover this level at all — it just returns its last
   * slice. Left unsaid, that reads as a match. Returns a phrase when the
   * gap is bigger than the pane's own slice spacing, else null.
   */
  function linkGapFor(cell) {
    if (!state.link || !cell.seriesUid) return null;
    var vol = cellVolume(cell);
    if (!vol || !state.volume || vol === state.volume) return null;

    // Measure the gap between where the two series' cuts actually meet, in
    // patient millimetres.
    //
    // Comparing slice Z alone was wrong for anything but an axial
    // acquisition: a sagittal stack's slices all share one Z, so the
    // "current level" it compared against was a constant, and a correctly
    // linked axial pane was labelled 57 mm outside the series.
    if (!V.hasPatientFrame(vol) || !V.hasPatientFrame(state.volume)) {
      // Without patient frames, Z is all there is — and only an axial pane
      // can be judged by it.
      if (cell.plane !== "axial") return null;
      var here = V.sliceZ(vol, cellIndex(cell));
      var there = V.sliceZ(state.volume, state.index.axial);
      if (here === null || there === null) return null;
      var zGap = Math.abs(here - there);
      return zGap <= Math.max(vol.spacingZ, 0.5)
        ? null : "off by " + zGap.toFixed(1) + " mm — outside this series";
    }

    var mine = V.toPatient(vol, crosshairWorld(vol, indexRecord(cellSeriesUid(cell))));
    var cur = V.toPatient(state.volume, crosshairWorld(state.volume, state.index));
    if (!mine || !cur) return null;
    var gap = Math.hypot(mine[0] - cur[0], mine[1] - cur[1], mine[2] - cur[2]);
    // One slice of tolerance: the two stacks rarely sample the same levels.
    if (gap <= Math.max(vol.spacingZ, 1.0)) return null;
    return "off by " + gap.toFixed(1) + " mm — outside this series";
  }

  /** Drive every other loaded series to the slice nearest this patient Z. */
  function linkOthersTo(uid, index) {
    var from = uid === state.currentSeriesUID ? state.volume : state.volumes[uid];
    var z = V.sliceZ(from, index);
    if (z === null) return;                    // no positions: nothing to link by
    Object.keys(state.volumes).forEach(function (other) {
      if (other === uid) return;
      var vol = state.volumes[other];
      var hit = V.sliceNearestZ(vol, z);
      if (!hit) return;
      indexRecord(other).axial = hit.index;
    });
  }

  function syncSliders() {
    state.cells.forEach(function (cell, i) {
      var rec = cellEls[i];
      if (!rec || !rec.slider) return;
      var vol = cellVolume(cell);
      if (!vol) {
        rec.slider.disabled = true;
        rec.slider.max = 0;
        rec.slider.value = 0;
        return;
      }
      rec.slider.disabled = false;
      rec.slider.max = Math.max(0, V.planeCount(vol, cell.plane) - 1);
      rec.slider.value = cellIndex(cell);
    });
  }

  function applyPreset(key) {
    var preset = PRESETS[key] || computedPreset(key);
    if (!preset) return;
    state.windowWidth = preset.ww;
    state.windowCenter = preset.wc;
    updateWLInputs();
    renderAll();
  }

  /**
   * Window presets for data with no Hounsfield scale.
   *
   * The CT presets are fixed numbers because HU is an absolute scale. MR
   * signal is not comparable between sequences, let alone between scanners,
   * so the only honest presets are ones derived from the image itself or
   * from what the scanner wrote in the header.
   */
  function computedPreset(key) {
    var vol = state.volume;
    if (!vol) return null;
    if (key === "header") {
      var group = getCurrentGroup();
      var inst = group && group.slices.length ? group.slices[0].instance : null;
      return inst ? { ww: wwOf(inst), wc: wcOf(inst) } : null;
    }
    if (key === "full") {
      return { ww: Math.max(1, vol.maxHU - vol.minHU), wc: (vol.maxHU + vol.minHU) / 2 };
    }
    if (key === "auto") {
      var p = percentiles(vol, 0.02, 0.98);
      return p ? { ww: Math.max(1, p[1] - p[0]), wc: (p[0] + p[1]) / 2 } : null;
    }
    return null;
  }

  /** Low/high percentile of the volume, via a coarse histogram. */
  function percentiles(vol, loFrac, hiFrac) {
    var lo = vol.minHU, hi = vol.maxHU;
    if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return null;
    var bins = 1024;
    var counts = new Uint32Array(bins);
    var scale = (bins - 1) / (hi - lo);
    var data = vol.data;
    // Every eighth voxel is plenty for a percentile and keeps this instant.
    var step = data.length > 4e6 ? 8 : 1;
    var total = 0;
    for (var i = 0; i < data.length; i += step) {
      counts[Math.round((data[i] - lo) * scale)]++;
      total++;
    }
    var want = [loFrac * total, hiFrac * total];
    var out = [lo, hi];
    var seen = 0, k = 0;
    for (var b = 0; b < bins && k < 2; b++) {
      seen += counts[b];
      while (k < 2 && seen >= want[k]) {
        out[k] = lo + b / scale;
        k++;
      }
    }
    return out[1] > out[0] ? out : null;
  }

  /** Offer the window and 3D presets that make sense for this modality. */
  function syncModalityControls() {
    var hu = isHounsfield();
    var group = getCurrentGroup();
    var modality = group && group.slices.length ? (group.slices[0].instance.modality || "") : "";

    // CT presets are fixed numbers because HU is an absolute scale; without
    // one, the only honest presets are derived from this image or its header.
    buildWindowMenu(hu
      ? Object.keys(PRESETS).map(function (k) {
          return [k, PRESETS[k].label, PRESETS[k].ww + " / " + PRESETS[k].wc + " HU"];
        })
      : [["header", "From the header", "Window Width / Center as sent"],
         ["auto", "Auto contrast", "from this volume's own distribution"],
         ["full", "Full range", "darkest to brightest voxel"]]);

    fillOptions(dom.vrPreset, hu
      ? [["bone", "Bone VRT"], ["angio", "Angiographic VRT"], ["muscle", "Muscle VRT"],
         ["soft", "Soft Tissue"], ["lung", "Lung"], ["skin", "Skin"]]
      : [["mrIntensity", "MR Intensity"], ["mrSurface", "MR Surface"],
         ["mrVessel", "MR Bright Signal"]]);

    var tf = VR.TRANSFER_FUNCTIONS[state.vrPreset];
    if (!tf || !!tf.normalised === hu) {
      state.vrPreset = hu ? "bone" : "mrIntensity";
      vrDirty = true;
    }
    dom.vrPreset.value = state.vrPreset;

    // Bone cut is an HU threshold; it means nothing on MR signal.
    var noBone = !hu && !!state.volume;
    dom.boneCutToggle.disabled = noBone;
    dom.boneThreshold.disabled = noBone;
    if (noBone && state.boneCut) {
      state.boneCut = false;
      dom.boneCutToggle.checked = false;
      vrDirty = true;
    }
    if (noBone) {
      dom.boneCutStatus.textContent =
        "Bone cut is a Hounsfield threshold, so it applies to CT only." +
        (modality ? " This series is " + modality + "." : "");
    } else {
      updateBoneStatus();
    }
  }

  /** Tick the More menu's toggles, so their state is readable at a glance. */
  function syncMoreMenu() {
    if (!dom.moreMenu) return;
    var set = function (k, on) {
      var b = dom.moreMenu.querySelector('[data-more="' + k + '"]');
      if (b) b.classList.toggle("on", !!on);
    };
    set("crosshairShow", state.crosshair);
    set("hu", state.huProbe);
    set("markers", state.showAnnotations);
    // Offering "go to the focus point" when there is none is worse than not
    // offering it: it reads as though one had been set.
    ["focusGo", "focusClear"].forEach(function (k) {
      var b = dom.moreMenu.querySelector('[data-more="' + k + '"]');
      if (b) b.disabled = !state.focusPoint;
    });
  }

  /** Rebuild the window menu's preset list for the current modality. */
  function buildWindowMenu(entries) {
    if (!dom.windowPresets) return;
    dom.windowPresets.innerHTML = entries.map(function (e) {
      return '<button data-window="' + e[0] + '">' + escapeHtml(e[1]) +
        (e[2] ? "<span>" + escapeHtml(e[2]) + "</span>" : "") + "</button>";
    }).join("");
    syncWindowControls();
  }

  /** Show which preset is in force, on the button and in the menu. */
  function syncWindowControls() {
    if (!dom.windowMenu) return;
    var active = null;
    Object.keys(PRESETS).forEach(function (k) {
      if (PRESETS[k].ww === state.windowWidth && PRESETS[k].wc === state.windowCenter) active = k;
    });
    state.windowPreset = active;
    Array.prototype.forEach.call(dom.windowMenu.querySelectorAll("[data-window]"), function (b) {
      if (b.dataset.window === "invert") b.classList.toggle("on", state.invert);
      else if (b.dataset.window === "reset") b.classList.remove("on");
      else b.classList.toggle("on", b.dataset.window === active);
    });
    if (dom.windowBtn) {
      var name = active ? PRESETS[active].label : "Custom";
      dom.windowBtn.textContent = "◐ " + name + (state.invert ? " ⁻" : "") + " ▾";
      dom.windowBtn.title = "Window " + Math.round(state.windowWidth) + " / " +
        Math.round(state.windowCenter) + (state.invert ? ", inverted" : "") + " — click to change";
    }
  }

  function fillOptions(select, pairs) {
    if (!select) return;
    var current = select.value;
    select.innerHTML = "";
    pairs.forEach(function (pair) {
      var o = document.createElement("option");
      o.value = pair[0];
      o.textContent = pair[1];
      select.appendChild(o);
    });
    if (pairs.some(function (pair) { return pair[0] === current; })) select.value = current;
  }

  function updateWLInputs() {
    dom.windowWidthInput.value = Math.round(state.windowWidth);
    dom.windowCenterInput.value = Math.round(state.windowCenter);
  }

  function setLayout(layout) {
    if (!LAYOUTS[layout]) return;
    applyLayout(layout);
    syncLayoutControls();
  }

  /* ---------------------------------------------------------------------
   * Reporting
   * ------------------------------------------------------------------- */

  /** Study Instance UID of what is on screen, or null. */
  function currentStudyUid() {
    var group = getCurrentGroup();
    if (!group || !group.slices.length) return null;
    return group.slices[0].instance.studyUID || null;
  }

  /**
   * Point the report at the study on screen.
   *
   * The base plan is explicit that changing patient must not leave an
   * unrelated report attached, so the in-progress draft is flushed to its
   * own study and the new study's draft is loaded in its place. Nothing is
   * carried across.
   */
  function swapReportToStudy() {
    var uid = currentStudyUid();
    if (uid === state.reportStudyUid) return;
    flushReport();
    state.reportStudyUid = uid;
    state.report = REPORT.load(uid);
    renderReport();
  }

  /** Write the current draft back to its own study, never another. */
  function flushReport() {
    if (!state.reportStudyUid || !state.report) return;
    readReportFields();
    if (REPORT.isEmpty(state.report)) {
      REPORT.remove(state.reportStudyUid);
      return;
    }
    var stamp = REPORT.save(state.reportStudyUid, state.report);
    if (stamp) state.report.updated = stamp;
  }

  function readReportFields() {
    if (!state.report) return;
    REPORT.SECTIONS.forEach(function (sec) {
      var el = dom.reportFields[sec.key];
      if (el) state.report[sec.key] = el.value;
    });
  }

  /** Study identity shown above the report, and used in the exported text. */
  function reportHeaderRows() {
    var group = getCurrentGroup();
    var inst = group && group.slices.length ? group.slices[0].instance : null;
    if (!inst) return [];
    var ds = inst.dataSet;
    return [
      ["Patient", formatPersonName(str(ds, "x00100010", ""))],
      ["Patient ID", str(ds, "x00100020", "")],
      ["Accession", str(ds, "x00080050", "")],
      ["Study date", formatDicomDate(str(ds, "x00080020", ""))],
      ["Modality", inst.modality || ""],
      ["Study", str(ds, "x00081030", "") || group.description || ""],
    ];
  }

  function renderReport() {
    if (!dom.reportPanel) return;
    var data = state.report || REPORT.empty();
    REPORT.SECTIONS.forEach(function (sec) {
      var el = dom.reportFields[sec.key];
      if (el && el.value !== data[sec.key]) el.value = data[sec.key] || "";
    });

    var rows = reportHeaderRows();
    dom.reportHeader.innerHTML = rows.length
      ? rows.filter(function (r) { return r[1]; }).map(function (r) {
          return "<div>" + escapeHtml(r[0]) + ": <strong>" + escapeHtml(r[1]) + "</strong></div>";
        }).join("")
      : '<p class="muted small">No study loaded.</p>';

    dom.reportStatus.textContent = !state.reportStudyUid ? ""
      : data.status === "final" ? "Final"
      : data.updated ? "Draft · saved " + new Date(data.updated).toLocaleTimeString()
      : "Draft";
    dom.reportStatus.classList.toggle("final", data.status === "final");

    var editable = !!state.reportStudyUid && data.status !== "final";
    REPORT.SECTIONS.forEach(function (sec) {
      var el = dom.reportFields[sec.key];
      if (el) el.readOnly = !editable;
    });
    dom.reportFinalBtn.textContent = data.status === "final" ? "Reopen draft" : "Mark final";
    renderKeyImages();
    renderPlaceholderWarning();
  }

  /** Refresh only the saved-at line, so typing does not fight the textarea. */
  function renderReportStatusOnly() {
    var data = state.report || REPORT.empty();
    dom.reportStatus.textContent = !state.reportStudyUid ? ""
      : data.status === "final" ? "Final"
      : data.updated ? "Draft · saved " + new Date(data.updated).toLocaleTimeString()
      : "Draft";
  }

  function renderKeyImages() {
    var data = state.report || REPORT.empty();
    if (!data.keyImages.length) {
      dom.reportKeyList.innerHTML = '<p class="muted small">None attached.</p>';
      return;
    }
    dom.reportKeyList.innerHTML = data.keyImages.map(function (img, i) {
      return '<div class="key-thumb"><img src="' + img.thumb + '" alt="" />' +
        '<button data-key="' + i + '" title="Remove">×</button>' +
        "<span>" + escapeHtml(img.caption) + "</span></div>";
    }).join("");
  }

  /** Attach the active pane as a key image, with what it is showing. */
  function captureKeyImage() {
    if (!state.reportStudyUid) return showToast("Open a study first.", true);
    if (state.report.status === "final") return showToast("This report is marked final.", true);
    var i = state.activeCell;
    var cell = state.cells[i], rec = cellEls[i];
    if (!cell || !rec || !rec.canvas) return;

    var out = document.createElement("canvas");
    var scale = Math.min(1, 220 / rec.canvas.width);
    out.width = Math.max(1, Math.round(rec.canvas.width * scale));
    out.height = Math.max(1, Math.round(rec.canvas.height * scale));
    var ctx = out.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(rec.canvas, 0, 0, out.width, out.height);
    if (cell.plane !== "vr") ctx.drawImage(rec.cross, 0, 0, out.width, out.height);

    var caption = cell.plane === "vr"
      ? "3D " + (VR.TRANSFER_FUNCTIONS[state.vrPreset] || {}).label
      : cell.plane.charAt(0).toUpperCase() + cell.plane.slice(1) +
        " slice " + (cellIndex(cell) + 1) + " / " + V.planeCount(state.volume, cell.plane);

    state.report.keyImages.push({ thumb: out.toDataURL("image/jpeg", 0.72), caption: caption });
    flushReport();
    renderReport();
    showToast("Key image attached: " + caption);
  }

  /**
   * Fill the template list, grouped so a long collection stays navigable.
   *
   * Imported templates keep their own author's label; the group makes clear
   * which modality they were written for without renaming them.
   */
  function buildTemplatePicker() {
    if (!dom.reportTemplate) return;
    var groups = {};
    TPL.ORDER.forEach(function (k) {
      var t = TPL.TEMPLATES[k];
      if (!t) return;
      (groups[t.modality] = groups[t.modality] || []).push([k, t.label]);
    });
    var html = '<option value="">Insert…</option>';
    ["Any", "CT", "MRI"].forEach(function (mod) {
      if (!groups[mod]) return;
      html += '<optgroup label="' + escapeHtml(mod) + '">';
      groups[mod].forEach(function (pair) {
        html += '<option value="' + escapeHtml(pair[0]) + '">' +
          escapeHtml(pair[1]) + "</option>";
      });
      html += "</optgroup>";
    });
    dom.reportTemplate.innerHTML = html;
  }

  /**
   * Insert a template into the draft.
   *
   * Inserting never finalises and never silently overwrites: anything
   * already written is confirmed first, and the template's attribution is
   * recorded so the exported report carries it.
   */
  function insertTemplate(keyName) {
    var tpl = TPL.get(keyName);
    if (!tpl || !state.reportStudyUid) return false;
    if (state.report.status === "final") {
      showToast("This report is marked final. Reopen it first.", true);
      return false;
    }
    readReportFields();

    var targets = ["technique", "comparison", "findings", "impression"];
    var filled = targets.filter(function (k) { return (state.report[k] || "").trim(); });
    if (filled.length &&
        !confirm("Replace the current technique, comparison, findings and impression?")) {
      return false;
    }
    targets.forEach(function (k) { state.report[k] = tpl[k] || ""; });

    var credit = TPL.credit(tpl);
    if (credit && state.report.credits.indexOf(credit) < 0) state.report.credits.push(credit);

    // Push state into the textareas before saving: flushReport() reads the
    // fields back, so saving first would write the stale values over the
    // template that was just inserted.
    renderReport();
    flushReport();
    renderReportStatusOnly();
    var open = TPL.placeholders(state.report, REPORT.SECTIONS).length;
    showToast(open
      ? tpl.label + " inserted — " + open + " placeholder" + (open === 1 ? "" : "s") + " to fill."
      : tpl.label + " inserted.");
    return true;
  }

  /**
   * Show what is still unfilled, and who wrote the wording.
   *
   * A template's value is that it is fast; its risk is that it reads as a
   * finished report while still holding the author's brackets. Counting them
   * where the reader is typing is the cheapest place to catch that.
   */
  function renderPlaceholderWarning() {
    if (!dom.placeholderWarn) return;
    var data = state.report || REPORT.empty();
    var open = TPL.placeholders(data, REPORT.SECTIONS);
    if (!open.length || !state.reportStudyUid) {
      dom.placeholderWarn.hidden = true;
    } else {
      var shown = open.slice(0, 8);
      dom.placeholderWarn.hidden = false;
      dom.placeholderWarn.innerHTML =
        "<strong>" + open.length + " placeholder" + (open.length === 1 ? "" : "s") +
        " still to fill.</strong><ul>" +
        shown.map(function (h) {
          return "<li>" + escapeHtml(h.section) + ": <code>" + escapeHtml(h.text) + "</code></li>";
        }).join("") +
        (open.length > shown.length ? "<li>… and " + (open.length - shown.length) + " more</li>" : "") +
        "</ul>";
    }
    if (dom.templateCredit) {
      dom.templateCredit.textContent = (data.credits || []).join("  ·  ");
    }
  }

  /** How many placeholders remain; used by the finalise guard. */
  function openPlaceholders() {
    return TPL.placeholders(state.report || REPORT.empty(), REPORT.SECTIONS);
  }

  function reportText() {
    readReportFields();
    return REPORT.format(reportHeaderRows(), state.report || REPORT.empty());
  }

  function setReportPanel(open) {
    dom.reportPanel.classList.toggle("collapsed", !open);
    dom.reportToggleBtn.classList.toggle("active", open);
    requestAnimationFrame(renderAll);
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

    wireMenu(dom.openBtn, dom.openMenu, "open", function (what) {
      if (what === "files") dom.fileInput.click();
      else if (what === "folder") dom.folderInput.click();
      else if (what === "clear") clearLoadedSeries();
    });

    function clearLoadedSeries() {
      if (!state.seriesOrder.length) return showToast("Nothing is loaded.", true);
      if (!confirm("Clear all loaded series?")) return;
      state.seriesOrder = [];
      state.seriesMap = {};
      state.currentSeriesUID = null;
      state.volume = null;
      state.index = { axial: 0, coronal: 0, sagittal: 0 };
      state.measurements = [];
      state.pendingMeasure = null;
      state.selectedMeasurement = null;
      // Saved measurements are not deleted here — clearing the viewer is not
      // the same as discarding a reader's work — but they must be allowed to
      // load again when the series is reopened.
      state.measureLoaded = {};
      state.measureStoredUids = [];
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
    }

    dom.layoutBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (dom.layoutMenu.hidden) openMenuUnder(dom.layoutMenu, dom.layoutBtn);
      else dom.layoutMenu.hidden = true;
    });
    dom.layoutMenu.addEventListener("click", function (e) {
      var pick = e.target.closest("[data-layout]");
      if (pick) { setLayout(pick.dataset.layout); dom.layoutMenu.hidden = true; return; }
      var fill = e.target.closest("[data-fill]");
      if (fill && !fill.disabled) { setPlaneFill(fill.dataset.fill); dom.layoutMenu.hidden = true; }
    });

    wireMenu(dom.windowBtn, dom.windowMenu, "window", function (what) {
      if (what === "invert") {
        state.invert = !state.invert;
        renderAll();
      } else if (what === "reset") {
        resetWindowToStudy();
      } else {
        applyPreset(what);
      }
      syncWindowControls();
    });



    wireMenu(dom.stackBtn, dom.stackMenu, "step", function (step) {
      setStackStep(parseInt(step, 10) || 0);
    });

    // Axial / coronal / sagittal as their own buttons: choosing which plane
    // fills the grid is a thing you do while reading, not a setting you go
    // looking for in a menu.
    dom.planeSeg.addEventListener("click", function (e) {
      var btn = e.target.closest(".seg-btn");
      if (btn && !btn.disabled) setPlaneFill(btn.dataset.fill);
    });

    if (dom.obliqueReset) {
      dom.obliqueReset.addEventListener("click", resetOblique);
    }

    dom.sculptRadius.addEventListener("input", function (e) {
      state.sculptRadius = parseFloat(e.target.value) || 8;
      dom.sculptRadiusValue.textContent = state.sculptRadius + " mm";
    });
    byId("sculptUndoBtn").addEventListener("click", undoSculpt);
    byId("sculptClearBtn").addEventListener("click", clearSculpt);

    dom.cineBtn.addEventListener("click", function () { setCine(!state.cine.playing); });
    dom.cineSpeed.addEventListener("change", function (e) {
      state.cine.fps = parseInt(e.target.value, 10) || 12;
      if (state.cine.playing) setCine(true);          // restart at the new rate
    });
    dom.cineDirBtn.addEventListener("click", function () {
      state.cine.reverse = !state.cine.reverse;
      dom.cineDirBtn.classList.toggle("active", state.cine.reverse);
    });
    dom.cineLoopBtn.addEventListener("click", function () {
      state.cine.loop = !state.cine.loop;
      dom.cineLoopBtn.classList.toggle("active", state.cine.loop);
    });

    dom.linkBtn.addEventListener("click", function () {
      state.link = !state.link;
      dom.linkBtn.classList.toggle("active", state.link);
      if (state.link) linkOthersTo(state.currentSeriesUID, state.index.axial);
      renderAll();
      syncSliders();
      showToast(state.link
        ? "Linked: panes on other series follow by patient position."
        : "Unlinked: each series scrolls on its own.");
    });

    // The + is a tool, not a visibility switch: pressing it arms dragging
    // the crosshair. Whether the lines are drawn at all is a display
    // preference, and lives with the other display toggles under More.
    dom.crosshairBtn.addEventListener("click", function () {
      setTool(state.tool === "crosshair" ? MEAS.TOOLS.none : "crosshair");
    });

    // Rotate / flip act on the active pane, keeping each pane's display
    // state independent as the plan calls for.
    dom.orientBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (dom.orientMenu.hidden) openMenuUnder(dom.orientMenu, dom.orientBtn);
      else dom.orientMenu.hidden = true;
    });
    dom.orientMenu.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-orient]");
      if (!btn) return;
      applyOrient(btn.dataset.orient);
      if (btn.dataset.orient !== "free") dom.orientMenu.hidden = true;
    });

    dom.focusBtn.addEventListener("click", function () { setFocusPick(!state.focusPick); });
    dom.focusPickBtn.addEventListener("click", function () { setFocusPick(!state.focusPick); });
    dom.focusGoBtn.addEventListener("click", function () {
      if (!goToFocus(true)) showToast("No focus point yet — turn on 🎯 and click one.", true);
    });
    dom.focusClearBtn.addEventListener("click", clearFocus);

    dom.navBtn.addEventListener("click", function () { setTool(MEAS.TOOLS.none); });
    wireMenu(dom.toolMoreBtn, dom.toolMenu, "tool", setTool);

    dom.clearMeasureBtn.addEventListener("click", clearMeasurements);

    // Hiding is deliberately not deleting: the checklist asks for the two to
    // be separate actions, and a reader who hides an ROI to look underneath
    // should not lose it.
    // One press saves the active pane — the common case when something on
    // screen is worth keeping. The variants live under More, so the
    // screenshot stays a single button on the bar.
    dom.shotBtn.addEventListener("click", function () { saveScreenshot("pane"); });

    wireMenu(dom.moreBtn, dom.moreMenu, "more", function (what) {
      if (what === "shotPane") {
        saveScreenshot("pane");
      } else if (what === "shotGrid") {
        saveScreenshot("grid");
      } else if (what === "copyPane") {
        copyScreenshot("pane");
      } else if (what === "shotReport") {
        captureKeyImage();
      } else if (what === "crosshairShow") {
        state.crosshair = !state.crosshair;
        if (!state.crosshair && state.tool === "crosshair") setTool(MEAS.TOOLS.none);
        renderAll();
      } else if (what === "hu") {
        state.huProbe = !state.huProbe;
        if (!state.huProbe) dom.huReadout.textContent = "";
      } else if (what === "markers") {
        state.showAnnotations = !state.showAnnotations;
        renderAllOverlays();
      } else if (what === "focusGo") {
        if (!goToFocus(true)) showToast("No focus point yet — press 🎯, then click one.", true);
      } else if (what === "focusClear") {
        clearFocus();
      }
      syncMoreMenu();
    });

    dom.annotOk.addEventListener("click", function () { commitText(true); });
    dom.annotCancel.addEventListener("click", function () { commitText(false); });
    dom.annotField.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); commitText(true); }
      else if (e.key === "Escape") { e.preventDefault(); commitText(false); }
      e.stopPropagation();
    });

    dom.measureList.addEventListener("click", function (e) {
      var del = e.target.closest("[data-del]");
      if (del) { deleteMeasurement(parseInt(del.dataset.del, 10)); return; }
      var eye = e.target.closest("[data-eye]");
      if (eye) { toggleMeasurementHidden(parseInt(eye.dataset.eye, 10)); return; }
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
      if (e.detail > 1 && MEAS.isAnnotation(m.tool)) { state.measureCell = state.activeCell; promptForText(m); }
    });

    dom.reportToggleBtn.addEventListener("click", function () {
      setReportPanel(dom.reportPanel.classList.contains("collapsed"));
    });

    var saveSoon = debounce(function () {
      flushReport();
      renderReportStatusOnly();
    }, 600);
    REPORT.SECTIONS.forEach(function (sec) {
      var el = dom.reportFields[sec.key];
      if (!el) return;
      el.addEventListener("input", saveSoon);
      el.addEventListener("input", function () {
        readReportFields();
        renderPlaceholderWarning();
      });
    });

    buildTemplatePicker();
    dom.reportTemplate.addEventListener("change", function (e) {
      insertTemplate(e.target.value);
      e.target.value = "";
    });

    byId("reportGrabBtn").addEventListener("click", captureKeyImage);

    dom.reportKeyList.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-key]");
      if (!btn || !state.report) return;
      state.report.keyImages.splice(parseInt(btn.dataset.key, 10), 1);
      flushReport();
      renderReport();
    });

    byId("reportCopyBtn").addEventListener("click", function () {
      var text = reportText();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { showToast("Report copied."); },
          function () { showToast("Could not reach the clipboard.", true); }
        );
      } else {
        showToast("Clipboard unavailable in this browser.", true);
      }
    });

    byId("reportDownloadBtn").addEventListener("click", function () {
      if (!state.reportStudyUid) return showToast("Open a study first.", true);
      var rows = reportHeaderRows();
      var who = (rows[1] && rows[1][1]) || "study";
      var name = "report-" + String(who).replace(/[^\w-]+/g, "_").slice(0, 40) + "-" +
        new Date().toISOString().slice(0, 10) + ".txt";
      var blob = new Blob([reportText()], { type: "text/plain;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      showToast("Saved " + name);
    });

    dom.reportFinalBtn = byId("reportFinalBtn");
    dom.reportFinalBtn.addEventListener("click", function () {
      if (!state.reportStudyUid) return showToast("Open a study first.", true);
      readReportFields();
      if (state.report.status === "final") {
        state.report.status = "draft";
      } else {
        if (REPORT.isEmpty(state.report)) return showToast("Nothing to finalise.", true);
        // A template's brackets are the author's "fill this in". Signing a
        // report that still holds them is the specific mistake templates
        // make easy, so it takes a deliberate override.
        var open = openPlaceholders();
        if (open.length && !confirm(
              open.length + " placeholder" + (open.length === 1 ? " is" : "s are") +
              " still unfilled:\n\n" +
              open.slice(0, 8).map(function (h) { return "  " + h.section + ": " + h.text; })
                .join("\n") +
              (open.length > 8 ? "\n  … and " + (open.length - 8) + " more" : "") +
              "\n\nMark this report final anyway?")) {
          return;
        }
        state.report.status = "final";
      }
      flushReport();
      renderReport();
      showToast(state.report.status === "final"
        ? "Marked final. Reopen it to edit again."
        : "Reopened for editing.");
    });

    byId("reportClearBtn").addEventListener("click", function () {
      if (!state.reportStudyUid) return;
      if (!confirm("Delete this study's report draft from this browser?")) return;
      REPORT.remove(state.reportStudyUid);
      state.report = REPORT.empty();
      renderReport();
      showToast("Draft deleted.");
    });

    // A reload mid-dictation must not lose the last few words.
    window.addEventListener("beforeunload", flushReport);

    // debounce() does not forward arguments, so read the input directly.
    dom.seriesFilter.addEventListener("input", debounce(function () {
      state.seriesFilter = dom.seriesFilter.value;
      // Rebuild from scratch: nodes are cached by series, and filtering
      // changes which ones belong in the list at all.
      seriesNodes = {};
      dom.seriesList.innerHTML = "";
      renderSeriesList();
    }, 150));

    dom.tagSearch.addEventListener("input", debounce(updateMetadata, 120));



    dom.resetBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (dom.resetMenu.hidden) openMenuUnder(dom.resetMenu, dom.resetBtn);
      else dom.resetMenu.hidden = true;
    });
    window.addEventListener("resize", closeMenus);
    dom.resetMenu.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-reset]");
      if (!btn) return;
      dom.resetMenu.hidden = true;
      applyReset(btn.dataset.reset);
    });
    document.addEventListener("click", function (e) {
      if (dom.resetMenu.hidden && dom.orientMenu.hidden) return;
      if (!e.target.closest(".menu-wrap") && !e.target.closest(".menu")) closeMenus();
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
      if (isFinite(v) && v > 0) { state.windowWidth = v; syncWindowControls(); renderAll(); }
    });
    dom.windowCenterInput.addEventListener("change", function (e) {
      var v = parseFloat(e.target.value);
      if (isFinite(v)) { state.windowCenter = v; syncWindowControls(); renderAll(); }
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
      if (renderer) {
        var rr = vrRange();
        renderer.setTransferFunction(state.vrPreset, rr[0], rr[1]);
      }
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

    if (rec.seriesSel) {
      rec.seriesSel.addEventListener("change", function (e) {
        setCellSeries(i, e.target.value);
      });
      rec.seriesSel.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    }

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
      if (e.button === 0 && state.freeRotate) {
        var r0 = screenAngleAt(i, e.clientX, e.clientY);
        if (r0 !== null) {
          state.drag = { cell: i, mode: "spin", angle: r0, rotation: cell.view.rotation || 0 };
        }
        return;
      }
      // Shift starts a crosshair drag from wherever it is pressed; without
      // it, the crosshair still has to be grabbed, so a plain click keeps
      // meaning window/level.
      if (e.button === 0 && e.shiftKey) {
        state.drag = { cell: i, mode: "crosshair" };
        crosshairFromPoint(i, e.clientX, e.clientY);
        return;
      }
      // With the crosshair tool armed, dragging anywhere in the pane moves
      // it — which is the whole point: put the + on the finding and every
      // section on screen is showing that finding.
      if (e.button === 0 && state.tool === "crosshair") {
        state.drag = { cell: i, mode: "crosshair" };
        crosshairFromPoint(i, e.clientX, e.clientY);
        return;
      }
      if (e.button === 0 && state.tool === MEAS.TOOLS.none && !state.focusPick &&
          !hitTestMeasurement(i, e.clientX, e.clientY) &&
          hitTestCrosshair(i, e.clientX, e.clientY)) {
        state.drag = { cell: i, mode: "crosshair" };
        crosshairFromPoint(i, e.clientX, e.clientY);
        return;
      }
      // Focus is an explicit mode, so while it is on a plain click means
      // "show me this point everywhere" and nothing else.
      if (e.button === 0 && state.focusPick) {
        focusFromPoint(i, e.clientX, e.clientY);
        return;
      }
      if (e.button === 0 && state.tool === "sculpt") {
        var stroke = [];
        state.drag = { cell: i, mode: "sculpt", stroke: stroke, volume: cellVolume(cell) };
        sculptAt(i, e.clientX, e.clientY, stroke);
        renderAll();
        return;
      }
      // hitTestMeasurement() returns nothing unless Navigate is active, so a
      // drawing tool always draws: the alternative — grabbing handles
      // whatever tool is selected — makes it impossible to place a new ROI
      // whose corner lands near an existing one's handle, and turns the
      // click that was meant to place a point into a silent drag of someone
      // else's measurement.
      if (e.button === 0) {
        var hit = hitTestMeasurement(i, e.clientX, e.clientY);
        if (hit) {
          state.selectedMeasurement = hit.m.id;
          renderMeasurementList();
          var at0 = eventToCell(i, e.clientX, e.clientY);
          state.drag = {
            cell: i, mode: "measure", m: hit.m,
            vertex: hit.vertex, move: !!hit.move,
            last: at0 ? { x: at0.x, y: at0.y } : { x: 0, y: 0 },
          };
          renderAllOverlays();
          return;
        }
      }
      if (e.button === 0 && MEAS.isTrace(state.tool)) {
        var p0 = eventToCell(i, e.clientX, e.clientY);
        if (!p0) return;
        state.measureCell = i;
        state.pendingMeasure = MEAS.createMeasurement(
          state.tool, rec.geom.plane, sliceKeyFor(rec.geom.plane, rec.geom.index),
          [p0], { seriesUid: rec.geom.uid });
        state.drag = { cell: i, mode: "trace" };
        renderAllOverlays();
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
      // A double-click closes a polygon or polyline; it must not also blow
      // the pane up to full screen underneath it.
      if (state.pendingMeasure && MEAS.isVariable(state.pendingMeasure.tool)) {
        finishPending();
        return;
      }
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
    syncLayoutControls();
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
    var vol = cellVolume(cell);
    if (!cell || !vol || cell.plane === "vr") return;
    var count = V.planeCount(vol, cell.plane);
    if (!cell.pinned) {
      // Move the shared cut so every unpinned pane on this plane follows,
      // keeping its offset, and this pane lands where it was asked to.
      setSeriesIndex(cellSeriesUid(cell), cell.plane, index - (cell.offset || 0));
      return;
    }
    var clamped = Math.max(0, Math.min(index, count - 1));
    if (clamped === cell.index) return;
    cell.index = clamped;
    renderCell(i);
    if (cellEls[i] && cellEls[i].slider) cellEls[i].slider.value = clamped;
  }

  function onMouseMove(e) {
    updateHuReadout(e);
    updateGrabCursor(e);
    if (state.pendingMeasure && state.measureCell !== undefined) {
      measureHover(state.measureCell, e.clientX, e.clientY);
    }
    var drag = state.drag;
    if (!drag) return;
    var dx = e.clientX - drag.x;
    var dy = e.clientY - drag.y;

    if (drag.mode === "sculpt") {
      sculptAt(drag.cell, e.clientX, e.clientY, drag.stroke);
      renderAll();
      return;
    }

    if (drag.mode === "crosshair") {
      crosshairFromPoint(drag.cell, e.clientX, e.clientY);
      return;
    }

    if (drag.mode === "measure") {
      dragMeasurement(drag, e.clientX, e.clientY);
      return;
    }

    if (drag.mode === "trace") {
      // Sample the path rather than every mouse event: a traced ROI needs
      // to follow the cursor, not record a point per pixel of jitter.
      var pending = state.pendingMeasure;
      if (!pending) return;
      var pt = eventToCell(drag.cell, e.clientX, e.clientY);
      if (!pt) return;
      var last = pending.points[pending.points.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) >= 0.8) {
        pending.points.push({ x: pt.x, y: pt.y });
        renderCellOverlay(drag.cell);
      }
      return;
    }

    if (drag.mode === "spin") {
      var now = screenAngleAt(drag.cell, e.clientX, e.clientY);
      if (now === null) return;
      var turned = ((now - drag.angle) * 180) / Math.PI;
      var cellS = state.cells[drag.cell];
      cellS.view.rotation = ((drag.rotation + turned) % 360 + 360) % 360;
      renderCell(drag.cell);
      return;
    }

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
        syncWindowControls();
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

  /**
   * Value of the pixel under the cursor, shown live in the status bar.
   *
   * Read from the plane's own samples, so it is the scanner's number and not
   * whatever grey the current window happens to be painting.
   */
  /**
   * Show a move cursor over anything that can be dragged.
   *
   * Without it the crosshair and the measurement handles are invisible
   * affordances: draggable, but with nothing on screen to say so.
   */
  function updateGrabCursor(e) {
    if (state.drag) return;
    var i = cellIndexAt(e.clientX, e.clientY);
    if (i < 0) return;
    var cell = state.cells[i], rec = cellEls[i];
    if (!cell || !rec || cell.plane === "vr") return;
    var grabbable = state.tool === MEAS.TOOLS.none && !state.focusPick &&
      (!!hitTestMeasurement(i, e.clientX, e.clientY) ||
       !!hitTestCrosshair(i, e.clientX, e.clientY));
    var want = state.tool === "crosshair" ? "move"
      : grabbable ? "move"
      : state.focusPick ? "cell"
      : state.tool === MEAS.TOOLS.none ? "crosshair" : "cell";
    if (rec.root.style.cursor !== want) rec.root.style.cursor = want;
  }

  /** Which pane the cursor is over, or -1. */
  function cellIndexAt(clientX, clientY) {
    for (var i = 0; i < cellEls.length; i++) {
      var rec = cellEls[i];
      if (!rec || !rec.canvas) continue;
      var r = rec.canvas.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        return i;
      }
    }
    return -1;
  }

  function updateHuReadout(e) {
    if (!dom.huReadout) return;
    if (!state.huProbe || !state.volume) { dom.huReadout.textContent = ""; return; }

    var target = e.target && e.target.closest ? e.target.closest(".vp") : null;
    var i = target ? parseInt(target.dataset.cell, 10) : -1;
    var cell = state.cells[i];
    var geom = cellEls[i] && cellEls[i].geom;
    if (!cell || cell.plane === "vr" || !geom) { dom.huReadout.textContent = ""; return; }

    var p = eventToCell(i, e.clientX, e.clientY);
    if (!p) { dom.huReadout.textContent = ""; return; }
    var pv = MEAS.pointValue(geom.slab, p);
    if (!pv) { dom.huReadout.textContent = ""; return; }

    var suffix = intensitySuffix(geom.slab);
    dom.huReadout.textContent =
      Math.round(pv.value) + " " + (suffix || "(stored value)") +
      "   ·   " + cell.plane + " " + (geom.index + 1) +
      "   ·   px " + pv.x + ", " + pv.y;
  }

  function onKeyDown(e) {
    // The caption editor owns the keyboard while it is open.
    if (state.textTarget) {
      if (e.key === "Enter") { commitText(true); e.preventDefault(); }
      else if (e.key === "Escape") { commitText(false); e.preventDefault(); }
      return;
    }
    if (e.key === "Escape" && anyMenuOpen()) { closeMenus(); return; }
    if (e.target && /input|select|textarea/i.test(e.target.tagName) ||
        (e.target && e.target.isContentEditable)) return;

    // Finishing or abandoning a shape comes before the navigation keys, so
    // Enter never pages the stack while a polygon is half-drawn.
    if (state.pendingMeasure) {
      if (e.key === "Enter") { finishPending(); e.preventDefault(); return; }
      if (e.key === "Escape") { cancelPending(); e.preventDefault(); return; }
    }
    if ((e.key === "Delete" || e.key === "Backspace") && state.selectedMeasurement) {
      deleteMeasurement(state.selectedMeasurement);
      e.preventDefault();
      return;
    }
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
      case "f": case "F":
        setFocusPick(!state.focusPick); break;
      case "g": case "G":
        if (!goToFocus(true)) showToast("No focus point yet — press F, then click one.", true);
        break;
      case "i": case "I":
        state.invert = !state.invert;
        syncWindowControls();
        renderAll();
        break;
      case "n": case "N":
        setTool(MEAS.TOOLS.none); break;
      case "x": case "X":
        setTool(state.tool === "crosshair" ? MEAS.TOOLS.none : "crosshair"); break;
      case "r": case "R":
        applyReset("view"); break;
      case "1": setLayout("quad"); break;
      case "2": setLayout("axial"); break;
      case "3": setLayout("mpr"); break;
      case "4": setLayout("vr"); break;
      case "5": setLayout("1x2"); break;
      case "6": setLayout("2x3"); break;

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
    if (dom.sculptUndoBtn === undefined) {
      dom.sculptUndoBtn = byId("sculptUndoBtn");
      dom.sculptClearBtn = byId("sculptClearBtn");
    }
    if (dom.sculptUndoBtn) dom.sculptUndoBtn.disabled = !state.sculptUndo.length;
    if (dom.sculptClearBtn) dom.sculptClearBtn.disabled = !V.hasSculpt(state.volume);
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

  /** Rotation and flipping, applied to the pane you last worked in. */
  function applyOrient(what) {
    if (what === "free") {
      state.freeRotate = !state.freeRotate;
      dom.orientBtn.classList.toggle("active", state.freeRotate);
      syncOrientMenu();
      setStatus(state.freeRotate
        ? "Free rotate armed — drag on a pane to turn it to any angle."
        : "Ready");
      return;
    }
    withActiveMprCell(function (cell, i) {
      if (what === "rotl") cell.view.rotation = (((cell.view.rotation || 0) - 90) % 360 + 360) % 360;
      else if (what === "rotr") cell.view.rotation = ((cell.view.rotation || 0) + 90) % 360;
      else if (what === "fliph") cell.view.flipH = !cell.view.flipH;
      else if (what === "flipv") cell.view.flipV = !cell.view.flipV;
      else if (what === "upright") {
        cell.view.rotation = 0; cell.view.flipH = false; cell.view.flipV = false;
      }
      renderCell(i);
      syncOrientMenu();
    });
  }

  /** Show which orientation options are currently on. */
  function syncOrientMenu() {
    if (!dom.orientMenu) return;
    var cell = null;
    withActiveMprCell(function (c) { cell = c; });
    var on = {
      free: state.freeRotate,
      fliph: !!(cell && cell.view.flipH),
      flipv: !!(cell && cell.view.flipV),
    };
    Array.prototype.forEach.call(dom.orientMenu.querySelectorAll("[data-orient]"), function (b) {
      b.classList.toggle("on", !!on[b.dataset.orient]);
    });
    dom.orientBtn.classList.toggle("active",
      state.freeRotate || !!(cell && (cell.view.rotation || cell.view.flipH || cell.view.flipV)));
  }

  /** Step the active pane's rotation, snapped to whole degrees. */
  function nudgeRotation(delta) {
    withActiveMprCell(function (cell, i) {
      cell.view.rotation = (((cell.view.rotation || 0) + delta) % 360 + 360) % 360;
      renderCell(i);
    });
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
  /* ---------------------------------------------------------------------
   * Screenshots
   *
   * What is captured is the pixels as rendered, with the overlays drawn on
   * the annotation canvas — crosshair, orientation letters, measurements.
   * The patient banner is DOM text sitting above the canvas, so it is not
   * in the image; a screenshot is still the patient's imaging, and nothing
   * here de-identifies anything.
   * ------------------------------------------------------------------- */

  /** Draw one pane into a context at (x, y, w, h). Returns false if empty. */
  function paintPane(ctx, i, x, y, w, h) {
    var cell = state.cells[i], rec = cellEls[i];
    if (!cell || !rec || !rec.canvas) return false;
    if (cell.plane === "vr") {
      if (!renderer) return false;
      renderer.render();                       // make sure the buffer is current
      ctx.drawImage(rec.canvas, x, y, w, h);
      return true;
    }
    if (!rec.geom) return false;
    ctx.drawImage(rec.canvas, x, y, w, h);
    ctx.drawImage(rec.cross, x, y, w, h);
    return true;
  }

  /**
   * Compose a screenshot.
   *
   * `scope` is "pane" for the active pane, or "grid" for every pane laid out
   * exactly as it is on screen — which is the one worth keeping when the
   * point being made is the relationship between the sections.
   */
  function buildScreenshot(scope) {
    if (scope === "grid") {
      var gridRect = dom.viewGrid.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      var out = document.createElement("canvas");
      out.width = Math.max(1, Math.round(gridRect.width * dpr));
      out.height = Math.max(1, Math.round(gridRect.height * dpr));
      var ctx = out.getContext("2d");
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, out.width, out.height);

      var drew = 0;
      state.cells.forEach(function (cell, i) {
        var rec = cellEls[i];
        if (!rec || !rec.canvas) return;
        var r = rec.canvas.getBoundingClientRect();
        if (paintPane(ctx, i,
              (r.left - gridRect.left) * dpr, (r.top - gridRect.top) * dpr,
              r.width * dpr, r.height * dpr)) {
          drew++;
          // A hairline between panes, so a grid of similar slices does not
          // read as one image once it is out of the viewer.
          ctx.strokeStyle = "rgba(255,255,255,0.18)";
          ctx.lineWidth = Math.max(1, dpr);
          ctx.strokeRect((r.left - gridRect.left) * dpr, (r.top - gridRect.top) * dpr,
            r.width * dpr, r.height * dpr);
        }
      });
      return drew ? out : null;
    }

    var rec = cellEls[state.activeCell];
    if (!rec || !rec.canvas) return null;
    var one = document.createElement("canvas");
    one.width = rec.canvas.width;
    one.height = rec.canvas.height;
    var c = one.getContext("2d");
    c.fillStyle = "#000";
    c.fillRect(0, 0, one.width, one.height);
    return paintPane(c, state.activeCell, 0, 0, one.width, one.height) ? one : null;
  }

  /**
   * Name a screenshot after what is actually in it.
   *
   * Both halves come from the *active pane's* own series. Taking the plane
   * from the pane and the description from whichever series happens to be
   * current names a shot of the axial T2 after the sagittal T1 — which is
   * worse than no name at all, because it reads as if it were true.
   */
  function screenshotName(scope) {
    var cell = state.cells[state.activeCell];
    var uid = cell ? cellSeriesUid(cell) : null;
    var group = state.seriesMap[uid] || getCurrentGroup();
    var what = scope === "grid" ? "grid" : (cell ? cell.plane : "view");
    var who = scope === "grid"
      ? (getCurrentGroup() ? String(getCurrentGroup().studyDescription ||
          getCurrentGroup().description || "study") : "study")
      : (group ? String(group.description || "series") : "view");
    var stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return "ct-console-" + what + "-" +
      who.replace(/[^\w-]+/g, "_").slice(0, 40) + "-" + stamp + ".png";
  }

  /** Save a screenshot to a file. */
  function saveScreenshot(scope) {
    var out = buildScreenshot(scope);
    if (!out) return showToast("Nothing to capture yet — open a study first.", true);
    var name = screenshotName(scope);
    out.toBlob(function (blob) {
      if (!blob) return showToast("Screenshot failed.", true);
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      showToast("Saved " + name);
    }, "image/png");
  }

  /**
   * Put a screenshot on the clipboard.
   *
   * Clipboard image writing is not available everywhere — it needs a secure
   * context and a permitted gesture — so a failure says so and points at the
   * save, rather than appearing to succeed.
   */
  function copyScreenshot(scope) {
    var out = buildScreenshot(scope);
    if (!out) return showToast("Nothing to capture yet — open a study first.", true);
    if (!navigator.clipboard || !window.ClipboardItem) {
      return showToast("This browser will not put images on the clipboard — use Save instead.", true);
    }
    out.toBlob(function (blob) {
      if (!blob) return showToast("Screenshot failed.", true);
      navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]).then(
        function () { showToast("Copied to the clipboard."); },
        function () { showToast("The clipboard refused the image — use Save instead.", true); }
      );
    }, "image/png");
  }

  /** Kept as the old name, so the More menu and its test still work. */
  function exportActiveViewport() { saveScreenshot("pane"); }

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
        "Try the 2\u00d73 grid, or fill any grid with one plane using Ax / Cor / Sag.";
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

  /** How many slices apart repeated panes sit. */
  function setStackStep(step) {
    state.stackStep = step;
    restack();
    syncStackSeg();
    syncCellControls();
    syncSliders();
    renderAll();
    updateStackNote();
  }

  function syncStackSeg() {
    if (dom.stackBtn) {
      dom.stackBtn.textContent = "⇕ Stack " + (state.stackStep ? state.stackStep : "same") + " ▾";
      dom.stackBtn.title = state.stackStep
        ? "Repeated panes sit " + state.stackStep + " slice" +
          (state.stackStep > 1 ? "s" : "") + " apart — click to change"
        : "Repeated panes all show the same slice — click to change";
    }
    if (!dom.stackMenu) return;
    Array.prototype.forEach.call(dom.stackMenu.querySelectorAll("[data-step]"), function (btn) {
      btn.classList.toggle("on", parseInt(btn.dataset.step, 10) === state.stackStep);
    });
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
    window.addEventListener("mouseup", function () {
      var drag = state.drag;
      if (drag && drag.mode === "sculpt" && drag.stroke.length) {
        state.sculptUndo.push({ volume: drag.volume, indices: drag.stroke });
        if (state.sculptUndo.length > 40) state.sculptUndo.shift();
        updateBoneStatus();
      }
      if (drag && drag.mode === "trace") finishPending();
      // An edited measurement is only worth saving once the drag has ended.
      if (drag && drag.mode === "measure") persistMeasurements();
      state.drag = null;
    });

    dom.linkBtn.classList.toggle("active", state.link);
    syncOrientMenu();
    syncLayoutControls();
    syncWindowControls();
    syncMoreMenu();
    syncToolControls();
    updateFocusStatus();
    updateWLInputs();
    updateBoneStatus();
    syncStackSeg();
    updateStackNote();
    updateObliqueInfo();
    renderMeasurementList();
    syncSliders();
    setTool("none");
    setCine(false);
    state.report = REPORT.empty();
    renderReport();
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
    selectSeries: selectSeries,
    setPlaneFill: setPlaneFill,
    nativePlaneOf: nativePlaneOf,
    stackableSeries: stackableSeries,
    syncLayoutControls: syncLayoutControls,
    setCellIndex: setCellIndex,
    setActiveCell: setActiveCell,
    cellIndex: cellIndex,
    cellVolume: cellVolume,
    cellSeriesUid: cellSeriesUid,
    linkGapFor: linkGapFor,
    setCellSeries: setCellSeries,
    indexRecord: indexRecord,
    cellWindow: cellWindow,
    restack: restack,
    setCine: setCine,
    undoSculpt: undoSculpt,
    clearSculpt: clearSculpt,
    cutActive: cutActive,
    setTool: setTool,
    focusFromPoint: focusFromPoint,
    goToFocus: goToFocus,
    clearFocus: clearFocus,
    setFocusPick: setFocusPick,
    volumeFor: volumeFor,
    focusGapFor: focusGapFor,
    measurementsFor: measurementsFor,
    persistMeasurements: persistMeasurements,
    restoreMeasurements: restoreMeasurements,
    clearMeasurements: clearMeasurements,
    deleteMeasurement: deleteMeasurement,
    toggleMeasurementHidden: toggleMeasurementHidden,
    finishPending: finishPending,
    calibrationFor: calibrationFor,
    measurementLines: measurementLines,
    moveGrip: moveGrip,
    hitTestMeasurement: hitTestMeasurement,
    hitTestCrosshair: hitTestCrosshair,
    setStackStep: setStackStep,
    saveScreenshot: saveScreenshot,
    copyScreenshot: copyScreenshot,
    buildScreenshot: buildScreenshot,
    screenshotName: screenshotName,
    insertTemplate: insertTemplate,
    openPlaceholders: openPlaceholders,
    reportText: reportText,
    cellGeom: function (i) { return cellEls[i] ? cellEls[i].geom : null; },
    cellEl: function (i) { return cellEls[i] ? cellEls[i].root : null; },
    cellCount: function () { return cellEls.length; },
  };
})();
