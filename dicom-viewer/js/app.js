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

  /* ---------------------------------------------------------------------
   * Constants
   * ------------------------------------------------------------------- */
  var UNCOMPRESSED_TRANSFER_SYNTAXES = {
    "1.2.840.10008.1.2": "implicit-little-endian",
    "1.2.840.10008.1.2.1": "explicit-little-endian",
    "1.2.840.10008.1.2.2": "explicit-big-endian",
  };

  var PRESETS = {
    lung: { ww: 1500, wc: -600 },
    bone: { ww: 2000, wc: 480 },
    brain: { ww: 80, wc: 40 },
    soft: { ww: 400, wc: 40 },
    abdomen: { ww: 400, wc: 50 },
    mediastinum: { ww: 350, wc: 50 },
    angio: { ww: 600, wc: 150 },
  };

  var MAX_SERIES_FOR_THUMBNAILS = 60;
  var MPR_PLANES = ["axial", "coronal", "sagittal"];

  // The 3D texture is packed once over the full diagnostic HU range so the
  // transfer-function presets can be expressed in real Hounsfield Units.
  var VR_WINDOW_LOW = -1024;
  var VR_WINDOW_HIGH = 3071;

  /* ---------------------------------------------------------------------
   * State
   * ------------------------------------------------------------------- */
  var state = {
    seriesOrder: [],
    seriesMap: {},
    currentSeriesUID: null,

    volume: null,
    index: { axial: 0, coronal: 0, sagittal: 0 },
    view: {
      axial: { zoom: 1, panX: 0, panY: 0 },
      coronal: { zoom: 1, panX: 0, panY: 0 },
      sagittal: { zoom: 1, panX: 0, panY: 0 },
    },

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
    crosshair: true,
    activePlane: "axial",

    drag: null,
  };

  var dom = {};
  var toastTimer = null;
  var renderer = null;          // CTVolumeRenderer.Renderer
  var vrDirty = true;           // texture needs re-upload
  var planeCache = {};          // plane -> { key, result }
  var seriesNodes = {};         // uid -> { wrapper, sliceCount }

  /* ---------------------------------------------------------------------
   * DOM
   * ------------------------------------------------------------------- */
  function cacheDom() {
    dom.fileInput = byId("fileInput");
    dom.folderInput = byId("folderInput");
    dom.clearBtn = byId("clearBtn");
    dom.layoutSeg = byId("layoutSeg");
    dom.presetSelect = byId("presetSelect");
    dom.invertBtn = byId("invertBtn");
    dom.crosshairBtn = byId("crosshairBtn");
    dom.resetBtn = byId("resetBtn");
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
    dom.vrCanvas = byId("vrCanvas");
    dom.vrEmpty = byId("vrEmpty");
    dom.volumeInfo = byId("volumeInfo");
    dom.metaTable = byId("metaTable");
    dom.statusText = byId("statusText");
    dom.toast = byId("toast");
    dom.busy = byId("busy");
    dom.busyText = byId("busyText");

    dom.vp = {};
    MPR_PLANES.concat(["vr"]).forEach(function (plane) {
      var el = byId("vp-" + plane);
      dom.vp[plane] = {
        root: el,
        canvas: el.querySelector(".vp-canvas"),
        cross: el.querySelector(".vp-cross"),
        slider: el.querySelector(".vp-slider"),
        tl: el.querySelector(".vp-tl"),
        tr: el.querySelector(".vp-tr"),
        bl: el.querySelector(".vp-bl"),
        br: el.querySelector(".vp-br"),
      };
      if (dom.vp[plane].canvas && plane !== "vr") {
        dom.vp[plane].ctx = dom.vp[plane].canvas.getContext("2d");
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

    var pixelSpacingRow = 1, pixelSpacingCol = 1;
    if (dataSet.elements.x00280030) {
      pixelSpacingRow = num(dataSet, "x00280030", 1);
      pixelSpacingCol = dataSet.floatString("x00280030", 1);
      if (isNaN(pixelSpacingCol)) pixelSpacingCol = pixelSpacingRow;
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
      fileWW: num(dataSet, "x00281051", null),
      fileWC: num(dataSet, "x00281050", null),
      pixelSpacingRow: pixelSpacingRow,
      pixelSpacingCol: pixelSpacingCol,
      sliceThickness: num(dataSet, "x00180050", null),

      instanceNumber: isNaN(instanceNumber) ? null : instanceNumber,
      sliceLocation: isNaN(sliceLocation) ? null : sliceLocation,
      imagePositionZ: isNaN(imagePositionZ) ? null : imagePositionZ,

      seriesUID: str(dataSet, "x0020000e", file.name),
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
        description: instance.seriesDescription || "(no series description)",
        modality: instance.modality || "",
        instances: [],
      };
      state.seriesMap[instance.seriesUID] = group;
      state.seriesOrder.push(instance.seriesUID);
    }
    group.instances.push(instance);
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
    showToast(
      loaded + " image" + (loaded === 1 ? "" : "s") + " loaded" +
      (skipped ? ", " + skipped + " skipped (not readable DICOM)" : ".")
    );

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

    state.seriesOrder.forEach(function (uid) {
      var group = state.seriesMap[uid];
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
    planeCache = {};
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
      setBusy(false);
      updateVolumeInfo();
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
    planeCache = {};
    vrDirty = true;
  }

  /* ---------------------------------------------------------------------
   * MPR rendering
   * ------------------------------------------------------------------- */

  /** Extract a plane, memoised so W/L drags don't re-slice the volume. */
  function getPlaneData(plane) {
    var key = [
      plane, state.index[plane], state.thicknessMm, state.projectionMode,
      state.boneCut ? "cut" + state.boneMaskVersion : "raw",
    ].join("|");

    var cached = planeCache[plane];
    if (cached && cached.key === key) return cached.result;

    var result = V.extractPlane(state.volume, plane, state.index[plane], {
      thicknessMm: state.thicknessMm,
      mode: state.projectionMode,
      boneCut: state.boneCut,
    });
    planeCache[plane] = { key: key, result: result };
    return result;
  }

  function planeVisible(plane) {
    if (state.layout === "quad") return true;
    if (state.layout === "axial") return plane === "axial";
    if (state.layout === "mpr") return plane !== "vr";
    if (state.layout === "vr") return plane === "vr";
    return true;
  }

  function renderAll() {
    var hasVolume = !!state.volume;
    dom.viewportEmpty.style.display = hasVolume || getCurrentGroup() ? "none" : "flex";

    MPR_PLANES.forEach(function (plane) {
      if (planeVisible(plane)) renderPlane(plane);
    });
    if (planeVisible("vr")) renderVR();
    updateMetadata();
  }

  function renderPlane(plane) {
    var vp = dom.vp[plane];
    var ctx = vp.ctx;
    resizeCanvas(vp.canvas);
    resizeCanvas(vp.cross);

    var cw = vp.canvas.width, ch = vp.canvas.height;
    ctx.save();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cw, ch);

    if (!state.volume) {
      ctx.restore();
      clearOverlays(plane);
      drawCrosshair(plane, null);
      return;
    }

    var slab = getPlaneData(plane);
    var img = windowToCanvas(
      slab.data, slab.width, slab.height,
      state.windowWidth, state.windowCenter, state.invert, false
    );

    // Fit the plane's *physical* size into the viewport, so anisotropic
    // voxels (thick slices) don't render squashed.
    var physW = slab.width * slab.spacingX;
    var physH = slab.height * slab.spacingY;
    var view = state.view[plane];
    var scale = Math.min(cw / physW, ch / physH) * view.zoom;
    var drawW = physW * scale, drawH = physH * scale;

    ctx.imageSmoothingEnabled = true;
    ctx.translate(cw / 2 + view.panX, ch / 2 + view.panY);
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    vp.geom = { scale: scale, drawW: drawW, drawH: drawH, cw: cw, ch: ch, slab: slab };
    updateOverlays(plane, slab);
    drawCrosshair(plane, vp.geom);
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

  /** Which volume axes map to this plane's horizontal / vertical axes. */
  function planeAxes(plane) {
    if (plane === "axial") return { h: "sagittal", v: "coronal" };
    if (plane === "coronal") return { h: "sagittal", v: "axial" };
    return { h: "coronal", v: "axial" };   // sagittal
  }

  function drawCrosshair(plane, geom) {
    var vp = dom.vp[plane];
    var ctx = vp.cross.getContext("2d");
    ctx.clearRect(0, 0, vp.cross.width, vp.cross.height);
    if (!geom || !state.crosshair || !state.volume) return;

    var axes = planeAxes(plane);
    var slab = geom.slab;
    var view = state.view[plane];

    // Fractional position of each companion plane along this plane's axes.
    var fx = (state.index[axes.h] + 0.5) / V.planeCount(state.volume, axes.h);
    var fy = (state.index[axes.v] + 0.5) / V.planeCount(state.volume, axes.v);

    var left = geom.cw / 2 + view.panX - geom.drawW / 2;
    var top = geom.ch / 2 + view.panY - geom.drawH / 2;
    var x = left + fx * geom.drawW;
    var y = top + fy * geom.drawH;

    var dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 210, 74, 0.75)";
    ctx.lineWidth = Math.max(1, dpr);
    ctx.setLineDash([6 * dpr, 5 * dpr]);
    ctx.beginPath();
    ctx.moveTo(x, top); ctx.lineTo(x, top + geom.drawH);
    ctx.moveTo(left, y); ctx.lineTo(left + geom.drawW, y);
    ctx.stroke();
    ctx.restore();
    void slab;
  }

  /** Map a viewport click to indices on the two companion planes. */
  function crosshairFromPoint(plane, clientX, clientY) {
    var vp = dom.vp[plane];
    if (!vp.geom || !state.volume) return;
    var rect = vp.canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var px = (clientX - rect.left) * dpr;
    var py = (clientY - rect.top) * dpr;

    var geom = vp.geom;
    var view = state.view[plane];
    var left = geom.cw / 2 + view.panX - geom.drawW / 2;
    var top = geom.ch / 2 + view.panY - geom.drawH / 2;

    var fx = (px - left) / geom.drawW;
    var fy = (py - top) / geom.drawH;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;

    var axes = planeAxes(plane);
    setPlaneIndex(axes.h, Math.floor(fx * V.planeCount(state.volume, axes.h)), true);
    setPlaneIndex(axes.v, Math.floor(fy * V.planeCount(state.volume, axes.v)), true);
    renderAll();
    syncSliders();
  }

  /* ---------------------------------------------------------------------
   * Overlays
   * ------------------------------------------------------------------- */
  function clearOverlays(plane) {
    var vp = dom.vp[plane];
    vp.tl.textContent = vp.tr.textContent = vp.bl.textContent = vp.br.textContent = "";
  }

  function updateOverlays(plane, slab) {
    var vp = dom.vp[plane];
    var group = getCurrentGroup();
    var first = group && group.slices.length ? group.slices[0].instance : null;
    var vol = state.volume;

    if (first) {
      var name = formatPersonName(str(first.dataSet, "x00100010", ""));
      var id = str(first.dataSet, "x00100020", "");
      vp.tl.textContent = (name ? name + "\n" : "") + (id ? "ID: " + id : "");
      vp.tr.textContent = (first.modality || "") + "\n" + (group.description || "");
    }

    vp.bl.textContent =
      "WW: " + Math.round(state.windowWidth) + "  WL: " + Math.round(state.windowCenter) +
      (state.invert ? "  [Inv]" : "") +
      (state.boneCut ? "\nBone cut ≥ " + state.boneThreshold + " HU" : "");

    var count = V.planeCount(vol, plane);
    var pitch = V.normalSpacing(vol, plane);
    var thicknessLabel = slab.samples > 1
      ? fmt(slab.samples * pitch) + "mm " + modeLabel(state.projectionMode)
      : fmt(pitch) + "mm";
    vp.br.textContent =
      (state.index[plane] + 1) + " / " + count + "\n" + thicknessLabel +
      "\n" + Math.round(state.view[plane].zoom * 100) + "%";
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

  function updateMetadata() {
    var group = getCurrentGroup();
    if (!group || !group.slices.length) {
      dom.metaTable.innerHTML = '<p class="muted small">No image loaded.</p>';
      return;
    }
    var inst = group.slices[Math.min(state.index.axial, group.slices.length - 1)].instance;
    var ds = inst.dataSet;
    var html = "";
    html += metaSection("Patient");
    html += metaRow("Name", formatPersonName(str(ds, "x00100010", "—")));
    html += metaRow("ID", str(ds, "x00100020", "—"));
    html += metaRow("Sex / Age", str(ds, "x00100040", "—") + " / " + str(ds, "x00101010", "—"));
    html += metaSection("Study");
    html += metaRow("Date", formatDicomDate(str(ds, "x00080020", "")) || "—");
    html += metaRow("Description", str(ds, "x00081030", "—"));
    html += metaSection("Series / Image");
    html += metaRow("Modality", inst.modality || "—");
    html += metaRow("Series", group.description);
    html += metaRow("Matrix", inst.columns + " × " + inst.rows);
    html += metaRow("Slice thickness", inst.sliceThickness != null ? fmt(inst.sliceThickness) + " mm" : "—");
    html += metaRow("Rescale", fmt(inst.rescaleSlope) + " / " + fmt(inst.rescaleIntercept));
    html += metaRow("Transfer syntax", inst.transferSyntax);
    html += metaRow("File", inst.fileName);
    dom.metaTable.innerHTML = html;
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
  function ensureRenderer() {
    if (renderer) return renderer;
    try {
      renderer = new VR.Renderer(dom.vrCanvas);
      renderer.setTransferFunction(state.vrPreset, VR_WINDOW_LOW, VR_WINDOW_HIGH);
    } catch (err) {
      renderer = null;
      dom.vrEmpty.innerHTML = "3D unavailable<br /><span class='muted small'>" + escapeHtml(err.message) + "</span>";
      dom.vrEmpty.style.display = "flex";
    }
    return renderer;
  }

  function renderVR() {
    if (!state.volume) {
      dom.vrEmpty.style.display = "flex";
      if (renderer) renderer.render();
      return;
    }
    var r = ensureRenderer();
    if (!r) return;
    dom.vrEmpty.style.display = "none";

    if (vrDirty) {
      var packed = V.packTexture(state.volume, VR_WINDOW_LOW, VR_WINDOW_HIGH, 256, state.boneCut);
      r.setVolume(packed);
      r.setTransferFunction(state.vrPreset, VR_WINDOW_LOW, VR_WINDOW_HIGH);
      vrDirty = false;
    }

    r.mode = state.vrMode;
    r.opacity = state.vrOpacity;
    r.render();

    var vp = dom.vp.vr;
    vp.tl.textContent = state.vrMode === "mip" ? "3D MIP" : "Volume Rendering";
    vp.br.textContent = (VR.TRANSFER_FUNCTIONS[state.vrPreset] || {}).label || state.vrPreset;
  }

  /* ---------------------------------------------------------------------
   * View state
   * ------------------------------------------------------------------- */
  function resetView() {
    MPR_PLANES.forEach(function (plane) {
      state.view[plane] = { zoom: 1, panX: 0, panY: 0 };
    });
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
    MPR_PLANES.forEach(function (plane) {
      var slider = dom.vp[plane].slider;
      if (!state.volume) {
        slider.disabled = true;
        slider.max = 0;
        slider.value = 0;
        return;
      }
      slider.disabled = false;
      slider.max = Math.max(0, V.planeCount(state.volume, plane) - 1);
      slider.value = state.index[plane];
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
    state.layout = layout;
    dom.viewGrid.className = "viewgrid layout-" + layout;
    Array.prototype.forEach.call(dom.layoutSeg.querySelectorAll(".seg-btn"), function (btn) {
      btn.classList.toggle("active", btn.dataset.layout === layout);
    });
    // Canvases were display:none, so they need a re-measure before drawing.
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

    dom.clearBtn.addEventListener("click", function () {
      if (!state.seriesOrder.length) return;
      if (!confirm("Clear all loaded series?")) return;
      state.seriesOrder = [];
      state.seriesMap = {};
      state.currentSeriesUID = null;
      state.volume = null;
      state.index = { axial: 0, coronal: 0, sagittal: 0 };
      planeCache = {};
      vrDirty = true;
      if (renderer) renderer.dispose();
      resetView();
      renderSeriesList();
      syncSliders();
      updateVolumeInfo();
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

    dom.crosshairBtn.addEventListener("click", function () {
      state.crosshair = !state.crosshair;
      dom.crosshairBtn.classList.toggle("active", state.crosshair);
      renderAll();
    });

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
      planeCache = {};
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

    MPR_PLANES.forEach(wirePlane);
    wireVRViewport();

    window.addEventListener("resize", debounce(function () { renderAll(); }, 120));
    document.addEventListener("keydown", onKeyDown);
    wireDragAndDrop();
  }

  function wirePlane(plane) {
    var vp = dom.vp[plane];

    vp.slider.addEventListener("input", function (e) {
      setPlaneIndex(plane, parseInt(e.target.value, 10));
    });

    vp.root.addEventListener("mousedown", function (e) {
      if (e.target === vp.slider) return;
      setActivePlane(plane);
      e.preventDefault();
      if (e.button === 0 && e.shiftKey) {
        crosshairFromPoint(plane, e.clientX, e.clientY);
        return;
      }
      state.drag = {
        plane: plane,
        mode: e.button === 0 ? "wl" : "pan",
        x: e.clientX, y: e.clientY,
        ww: state.windowWidth, wc: state.windowCenter,
        panX: state.view[plane].panX, panY: state.view[plane].panY,
      };
    });

    vp.root.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    vp.root.addEventListener("wheel", function (e) {
      if (!state.volume) return;
      e.preventDefault();
      setActivePlane(plane);
      if (e.shiftKey) {
        var view = state.view[plane];
        view.zoom = Math.max(0.2, Math.min(12, view.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
        renderPlane(plane);
      } else {
        setPlaneIndex(plane, state.index[plane] + (e.deltaY > 0 ? 1 : -1));
      }
    }, { passive: false });

    vp.root.addEventListener("dblclick", function () {
      setLayout(state.layout === "quad" ? plane : "quad");
    });
  }

  function wireVRViewport() {
    var vp = dom.vp.vr;
    vp.root.addEventListener("mousedown", function (e) {
      setActivePlane("vr");
      e.preventDefault();
      state.drag = { plane: "vr", mode: "orbit", x: e.clientX, y: e.clientY };
    });
    vp.root.addEventListener("wheel", function (e) {
      e.preventDefault();
      if (!renderer) return;
      renderer.zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1);
      renderVR();
    }, { passive: false });
    vp.root.addEventListener("dblclick", function () {
      setLayout(state.layout === "quad" ? "vr" : "quad");
    });
  }

  function setActivePlane(plane) {
    state.activePlane = plane;
    MPR_PLANES.concat(["vr"]).forEach(function (p) {
      dom.vp[p].root.classList.toggle("active", p === plane);
    });
  }

  function onMouseMove(e) {
    var drag = state.drag;
    if (!drag) return;
    var dx = e.clientX - drag.x;
    var dy = e.clientY - drag.y;

    if (drag.mode === "orbit") {
      if (renderer) { renderer.orbit(dx, dy); renderVR(); }
      drag.x = e.clientX;
      drag.y = e.clientY;
      return;
    }

    if (drag.mode === "wl") {
      state.windowWidth = Math.max(1, drag.ww + dx * 2);
      state.windowCenter = drag.wc - dy * 2;
      dom.presetSelect.value = "";
      updateWLInputs();
      renderAll();
      return;
    }

    // Pan: panX/panY live in device pixels, mouse deltas are CSS pixels.
    var dpr = window.devicePixelRatio || 1;
    var view = state.view[drag.plane];
    view.panX = drag.panX + dx * dpr;
    view.panY = drag.panY + dy * dpr;
    renderPlane(drag.plane);
  }

  function onKeyDown(e) {
    if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
    var plane = MPR_PLANES.indexOf(state.activePlane) >= 0 ? state.activePlane : "axial";
    switch (e.key) {
      case "ArrowDown": case "ArrowRight":
        setPlaneIndex(plane, state.index[plane] + 1); e.preventDefault(); break;
      case "ArrowUp": case "ArrowLeft":
        setPlaneIndex(plane, state.index[plane] - 1); e.preventDefault(); break;
      case "PageDown":
        setPlaneIndex(plane, state.index[plane] + 10); e.preventDefault(); break;
      case "PageUp":
        setPlaneIndex(plane, state.index[plane] - 10); e.preventDefault(); break;
      case "i": case "I":
        dom.invertBtn.click(); break;
      case "r": case "R":
        resetView(); renderAll(); break;
      case "1": setLayout("quad"); break;
      case "2": setLayout("axial"); break;
      case "3": setLayout("mpr"); break;
      case "4": setLayout("vr"); break;
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
    wireEvents();

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", function () { state.drag = null; });

    dom.crosshairBtn.classList.toggle("active", state.crosshair);
    updateWLInputs();
    updateBoneStatus();
    syncSliders();
    setActivePlane("axial");
    setLayout(state.layout);

    if (!VR.isSupported()) {
      dom.vrEmpty.innerHTML = "3D unavailable<br /><span class='muted small'>WebGL2 not supported here</span>";
    }
    setStatus("Ready — open a DICOM folder to begin");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Exposed for headless testing.
  window.__ctConsole = {
    state: state,
    getPlaneData: getPlaneData,
    renderAll: renderAll,
  };
})();
