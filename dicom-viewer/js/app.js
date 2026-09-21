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
    duplicateCount: 0,

    volume: null,
    geometryWarnings: [],
    index: { axial: 0, coronal: 0, sagittal: 0 },
    view: {
      axial: { zoom: 1, panX: 0, panY: 0, rotation: 0, flipH: false, flipV: false },
      coronal: { zoom: 1, panX: 0, panY: 0, rotation: 0, flipH: false, flipV: false },
      sagittal: { zoom: 1, panX: 0, panY: 0, rotation: 0, flipH: false, flipV: false },
    },

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
      clearMeasurements();
      setBusy(false);
      updateVolumeInfo();
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
      vp.geom = null;
      drawAnnotations(plane, null);
      return;
    }

    var slab = getPlaneData(plane);
    var img = windowToCanvas(
      slab.data, slab.width, slab.height,
      state.windowWidth, state.windowCenter, state.invert, false
    );

    var t = planeTransform(plane, slab, cw, ch);

    // Canvas composes right-to-left, so this applies flip, then rotation,
    // then the translate — matching planeToCanvas() exactly.
    ctx.imageSmoothingEnabled = true;
    ctx.translate(t.tx, t.ty);
    ctx.rotate(t.rot);
    ctx.scale(t.flipH ? -1 : 1, t.flipV ? -1 : 1);
    var drawW = t.physW * t.scale, drawH = t.physH * t.scale;
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    vp.geom = { t: t, cw: cw, ch: ch, slab: slab };
    updateOverlays(plane, slab);
    drawAnnotations(plane, vp.geom);
  }

  /* ---------------------------------------------------------------------
   * Plane <-> canvas transform
   *
   * Measurements are stored in plane (column/row) coordinates, so the view
   * transform has to be invertible: zooming, panning, rotating or flipping
   * moves the drawing but must not move a measurement off the anatomy.
   * ------------------------------------------------------------------- */
  function planeTransform(plane, slab, cw, ch) {
    var view = state.view[plane];
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

  /** Mouse event -> plane coordinates for a given viewport. */
  function eventToPlane(plane, clientX, clientY) {
    var vp = dom.vp[plane];
    if (!vp.geom) return null;
    var rect = vp.canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    return canvasToPlane(vp.geom.t, (clientX - rect.left) * dpr, (clientY - rect.top) * dpr);
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

  /**
   * Overlay layer: crosshair, orientation markers and measurements.
   * Drawn on a separate canvas so it can be refreshed without re-windowing
   * the image underneath.
   */
  function drawAnnotations(plane, geom) {
    var vp = dom.vp[plane];
    var ctx = vp.cross.getContext("2d");
    ctx.clearRect(0, 0, vp.cross.width, vp.cross.height);
    if (!geom || !state.volume) return;

    var dpr = window.devicePixelRatio || 1;
    if (state.crosshair) drawCrosshair(ctx, plane, geom, dpr);
    drawOrientationMarkers(ctx, plane, geom, dpr);
    drawMeasurements(ctx, plane, geom, dpr);
  }

  function drawCrosshair(ctx, plane, geom, dpr) {
    var axes = planeAxes(plane);
    var t = geom.t;

    // Position of the two companion planes expressed in *this* plane's
    // column/row space, then pushed through the same transform as the image.
    var px = ((state.index[axes.h] + 0.5) / V.planeCount(state.volume, axes.h)) * t.width;
    var py = ((state.index[axes.v] + 0.5) / V.planeCount(state.volume, axes.v)) * t.height;

    var vTop = planeToCanvas(t, px, 0), vBot = planeToCanvas(t, px, t.height);
    var hLeft = planeToCanvas(t, 0, py), hRight = planeToCanvas(t, t.width, py);

    ctx.save();
    ctx.strokeStyle = "rgba(255, 210, 74, 0.75)";
    ctx.lineWidth = Math.max(1, dpr);
    ctx.setLineDash([6 * dpr, 5 * dpr]);
    ctx.beginPath();
    ctx.moveTo(vTop.x, vTop.y); ctx.lineTo(vBot.x, vBot.y);
    ctx.moveTo(hLeft.x, hLeft.y); ctx.lineTo(hRight.x, hRight.y);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Anatomical direction letters on each edge. They are derived from the
   * plane's patient axes and pushed through the *same* transform as the
   * image, so they stay correct after rotation and flipping.
   */
  function drawOrientationMarkers(ctx, plane, geom, dpr) {
    var labels = orientationLabels(plane);
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

    if (plane === "axial") {
      return { left: rowNeg, right: rowPos, top: colNeg, bottom: colPos };
    }
    if (plane === "coronal") {
      // Horizontal is patient X, vertical is patient Z (slice order).
      return { left: rowNeg, right: rowPos, top: "H", bottom: "F" };
    }
    // Sagittal: horizontal is patient Y, vertical is patient Z.
    return { left: colNeg, right: colPos, top: "H", bottom: "F" };
  }

  /** Map a viewport click to indices on the two companion planes. */
  function crosshairFromPoint(plane, clientX, clientY) {
    if (!state.volume) return;
    var p = eventToPlane(plane, clientX, clientY);
    if (!p) return;
    var t = dom.vp[plane].geom.t;
    var fx = p.x / t.width, fy = p.y / t.height;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;

    var axes = planeAxes(plane);
    setPlaneIndex(axes.h, Math.floor(fx * V.planeCount(state.volume, axes.h)), true);
    setPlaneIndex(axes.v, Math.floor(fy * V.planeCount(state.volume, axes.v)), true);
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
    // Coronal/sagittal also depend on slice spacing being trustworthy.
    if (source && plane !== "axial" && !state.volume.spacingZReliable) source = null;
    return MEAS.calibrationOf(slab, source);
  }

  /** Measurements that belong to the plane/slice currently shown. */
  function measurementsFor(plane) {
    return state.measurements.filter(function (m) {
      return m.plane === plane && m.sliceIndex === state.index[plane];
    });
  }

  function drawMeasurements(ctx, plane, geom, dpr) {
    var list = measurementsFor(plane);
    var pending = state.pendingMeasure && state.pendingMeasure.plane === plane &&
      state.pendingMeasure.sliceIndex === state.index[plane] ? state.pendingMeasure : null;
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
  function measureClick(plane, clientX, clientY) {
    var p = eventToPlane(plane, clientX, clientY);
    if (!p) return;
    var need = MEAS.pointsNeeded(state.tool);
    if (!need) return;

    var pending = state.pendingMeasure;
    if (!pending || pending.plane !== plane || pending.sliceIndex !== state.index[plane]) {
      pending = state.pendingMeasure = MEAS.createMeasurement(state.tool, plane, state.index[plane], [p]);
      renderPlaneOverlay(plane);
      return;
    }

    pending.points.push({ x: p.x, y: p.y });
    if (pending.points.length >= need) {
      state.measurements.push(pending);
      state.selectedMeasurement = pending.id;
      state.pendingMeasure = null;
      renderMeasurementList();
    }
    renderPlaneOverlay(plane);
  }

  /** Live preview of the in-progress measurement as the mouse moves. */
  function measureHover(plane, clientX, clientY) {
    var pending = state.pendingMeasure;
    if (!pending || pending.plane !== plane) return;
    var p = eventToPlane(plane, clientX, clientY);
    if (!p) return;
    var need = MEAS.pointsNeeded(state.tool);
    var preview = pending.points.slice(0, need - 1);
    preview.push(p);
    var saved = pending.points;
    pending.points = preview;
    renderPlaneOverlay(plane);
    pending.points = saved;
  }

  /** Redraw just the annotation layer for one plane. */
  function renderPlaneOverlay(plane) {
    var vp = dom.vp[plane];
    if (vp.geom) drawAnnotations(plane, vp.geom);
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
      var slab = planeCache[m.plane] && planeCache[m.plane].result;
      var res = slab && m.sliceIndex === state.index[m.plane]
        ? MEAS.evaluate(m, slab, calibrationFor(m.plane, slab))
        : null;
      var value = res ? res.primary + (m.tool === MEAS.TOOLS.ellipse && unit ? " " + unit : "") : "—";
      html +=
        '<div class="measure-row' + (m.id === state.selectedMeasurement ? " selected" : "") +
        '" data-id="' + m.id + '">' +
        '<span class="measure-kind">' + toolGlyph(m.tool) + "</span>" +
        '<span class="measure-main">' + escapeHtml(value) +
        (res && res.detail ? '<span class="measure-detail">' + escapeHtml(res.detail) + "</span>" : "") +
        "</span>" +
        '<span class="measure-loc">' + m.plane.slice(0, 3) + " " + (m.sliceIndex + 1) + "</span>" +
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
    MPR_PLANES.forEach(function (p) {
      dom.vp[p].root.style.cursor = tool === MEAS.TOOLS.none ? "crosshair" : "cell";
    });
    MPR_PLANES.forEach(renderPlaneOverlay);
  }

  function clearMeasurements() {
    state.measurements = [];
    state.pendingMeasure = null;
    state.selectedMeasurement = null;
    renderMeasurementList();
    MPR_PLANES.forEach(renderPlaneOverlay);
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
      var haystack = (tag + " " + label + " " + value).toLowerCase();
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
      state.view[plane] = { zoom: 1, panX: 0, panY: 0, rotation: 0, flipH: false, flipV: false };
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

    // Rotate / flip act on the active plane, keeping each viewport's display
    // state independent as the plan calls for.
    dom.rotateBtn.addEventListener("click", function () {
      var plane = activeMprPlane();
      var view = state.view[plane];
      view.rotation = ((view.rotation || 0) + 90) % 360;
      renderPlane(plane);
    });
    dom.flipHBtn.addEventListener("click", function () {
      var plane = activeMprPlane();
      state.view[plane].flipH = !state.view[plane].flipH;
      dom.flipHBtn.classList.toggle("active", state.view[plane].flipH);
      renderPlane(plane);
    });
    dom.flipVBtn.addEventListener("click", function () {
      var plane = activeMprPlane();
      state.view[plane].flipV = !state.view[plane].flipV;
      dom.flipVBtn.classList.toggle("active", state.view[plane].flipV);
      renderPlane(plane);
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
        MPR_PLANES.forEach(renderPlaneOverlay);
        return;
      }
      var row = e.target.closest(".measure-row");
      if (!row) return;
      var rid = parseInt(row.dataset.id, 10);
      var m = state.measurements.filter(function (x) { return x.id === rid; })[0];
      if (!m) return;
      state.selectedMeasurement = rid;
      // Jump to the slice the measurement was made on.
      setPlaneIndex(m.plane, m.sliceIndex);
      renderMeasurementList();
      MPR_PLANES.forEach(renderPlaneOverlay);
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
      if (e.button === 0 && state.tool !== MEAS.TOOLS.none) {
        measureClick(plane, e.clientX, e.clientY);
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
    if (state.pendingMeasure) {
      measureHover(state.pendingMeasure.plane, e.clientX, e.clientY);
    }
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

  /** The active plane, falling back to axial when 3D is focused. */
  function activeMprPlane() {
    return MPR_PLANES.indexOf(state.activePlane) >= 0 ? state.activePlane : "axial";
  }

  /**
   * Export the active viewport as a PNG, compositing the annotation layer
   * (crosshair, orientation markers, measurements) over the image so what is
   * saved matches what is on screen.
   */
  function exportActiveViewport() {
    var plane = state.activePlane;
    var vp = dom.vp[plane];
    if (!vp || !vp.canvas) return;

    var out = document.createElement("canvas");
    var src = vp.canvas;
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
      if (!vp.geom) return showToast("Nothing to export yet.", true);
      ctx.drawImage(src, 0, 0);
      ctx.drawImage(vp.cross, 0, 0);
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
    wireEvents();

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", function () { state.drag = null; });

    dom.crosshairBtn.classList.toggle("active", state.crosshair);
    updateWLInputs();
    updateBoneStatus();
    renderMeasurementList();
    syncSliders();
    setTool("none");
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
    orientationLabels: orientationLabels,
    planeToCanvas: planeToCanvas,
    canvasToPlane: canvasToPlane,
    planeTransform: planeTransform,
  };
})();
