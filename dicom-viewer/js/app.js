/* ==========================================================================
   CT Console — a client-side DICOM viewer for personal CT image review.
   Everything runs in the browser: files are parsed and rendered locally,
   nothing is ever uploaded anywhere. Built on top of the open-source
   `dicom-parser` library (vendored in js/vendor/).
   ========================================================================== */
(function () {
  "use strict";

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

  var MAX_SERIES_FOR_THUMBNAILS = 60; // avoid freezing the UI on huge series
  var CINE_INTERVAL_MS = 100; // ~10 fps

  /* ---------------------------------------------------------------------
   * State
   * ------------------------------------------------------------------- */
  var state = {
    seriesOrder: [], // array of seriesUID in load order
    seriesMap: {}, // seriesUID -> { uid, description, modality, instances: [] }
    currentSeriesUID: null,
    currentIndex: 0,

    windowWidth: 400,
    windowCenter: 40,
    invert: false,
    flipH: false,
    flipV: false,
    rotation: 0, // degrees, multiple of 90
    zoom: 1,
    panX: 0,
    panY: 0,

    dragMode: null, // 'wl' | 'pan' | null
    dragStart: null,

    cinePlaying: false,
    cineTimer: null,

    metaVisible: true,
    thumbsVisible: true,
  };

  /* ---------------------------------------------------------------------
   * DOM references
   * ------------------------------------------------------------------- */
  var dom = {};
  function cacheDom() {
    dom.fileInput = document.getElementById("fileInput");
    dom.folderInput = document.getElementById("folderInput");
    dom.clearBtn = document.getElementById("clearBtn");
    dom.presetSelect = document.getElementById("presetSelect");
    dom.invertBtn = document.getElementById("invertBtn");
    dom.flipHBtn = document.getElementById("flipHBtn");
    dom.flipVBtn = document.getElementById("flipVBtn");
    dom.rotateBtn = document.getElementById("rotateBtn");
    dom.resetBtn = document.getElementById("resetBtn");
    dom.metaToggleBtn = document.getElementById("metaToggleBtn");
    dom.thumbToggleBtn = document.getElementById("thumbToggleBtn");

    dom.thumbPanel = document.getElementById("thumbPanel");
    dom.dropHint = document.getElementById("dropHint");
    dom.seriesList = document.getElementById("seriesList");

    dom.viewport = document.getElementById("viewport");
    dom.canvas = document.getElementById("dicomCanvas");
    dom.ctx = dom.canvas.getContext("2d");
    dom.viewportEmpty = document.getElementById("viewportEmpty");
    dom.overlayTL = document.getElementById("overlayTL");
    dom.overlayTR = document.getElementById("overlayTR");
    dom.overlayBL = document.getElementById("overlayBL");
    dom.overlayBR = document.getElementById("overlayBR");

    dom.metaPanel = document.getElementById("metaPanel");
    dom.metaTable = document.getElementById("metaTable");

    dom.cinePlayBtn = document.getElementById("cinePlayBtn");
    dom.sliceSlider = document.getElementById("sliceSlider");
    dom.sliceCounter = document.getElementById("sliceCounter");
    dom.windowWidthInput = document.getElementById("windowWidth");
    dom.windowCenterInput = document.getElementById("windowCenter");
    dom.zoomLabel = document.getElementById("zoomLabel");

    dom.toast = document.getElementById("toast");
  }

  /* ---------------------------------------------------------------------
   * Toast helper
   * ------------------------------------------------------------------- */
  var toastTimer = null;
  function showToast(message, isError) {
    dom.toast.textContent = message;
    dom.toast.classList.toggle("error", !!isError);
    dom.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      dom.toast.hidden = true;
    }, 3200);
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
    return pn
      .split("^")
      .filter(function (s) { return s.length > 0; })
      .join(" ")
      .trim() || pn;
  }
  function formatDicomDate(d) {
    if (!d || d.length < 8) return d || "";
    return d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8);
  }
  function formatDicomTime(t) {
    if (!t || t.length < 6) return t || "";
    return t.slice(0, 2) + ":" + t.slice(2, 4) + ":" + t.slice(4, 6);
  }

  /* ---------------------------------------------------------------------
   * Parsing a single File into an "instance" record
   * ------------------------------------------------------------------- */
  function parseFile(file, arrayBuffer) {
    var byteArray = new Uint8Array(arrayBuffer);
    var dataSet = dicomParser.parseDicom(byteArray);

    var transferSyntax = str(dataSet, "x00020010", "1.2.840.10008.1.2.1");
    var syntaxKind = UNCOMPRESSED_TRANSFER_SYNTAXES[transferSyntax];

    var rows = uint16(dataSet, "x00280010", 0);
    var columns = uint16(dataSet, "x00280011", 0);
    var bitsAllocated = uint16(dataSet, "x00280100", 16);
    var pixelRepresentation = uint16(dataSet, "x00280103", 0);
    var samplesPerPixel = uint16(dataSet, "x00280002", 1);
    var photometric = str(dataSet, "x00280004", "MONOCHROME2");
    var numberOfFrames = parseInt(str(dataSet, "x00280008", "1"), 10) || 1;
    var planarConfiguration = uint16(dataSet, "x00280006", 0);

    var rescaleSlope = num(dataSet, "x00281053", 1);
    var rescaleIntercept = num(dataSet, "x00281052", 0);

    var fileWW = num(dataSet, "x00281051", null);
    var fileWC = num(dataSet, "x00281050", null);

    var pixelSpacingRow = 1, pixelSpacingCol = 1;
    var psEl = dataSet.elements.x00280030;
    if (psEl) {
      pixelSpacingRow = num(dataSet, "x00280030", 1);
      pixelSpacingCol = dataSet.floatString("x00280030", 1);
      if (isNaN(pixelSpacingCol)) pixelSpacingCol = pixelSpacingRow;
    }

    var instanceNumber = parseInt(str(dataSet, "x00200013", ""), 10);
    var sliceLocation = parseFloat(str(dataSet, "x00201041", ""));
    var imagePositionZ = NaN;
    var ippEl = dataSet.elements.x00200032;
    if (ippEl) {
      var z = dataSet.floatString("x00200032", 2);
      if (!isNaN(z)) imagePositionZ = z;
    }

    var seriesUID = str(dataSet, "x0020000e", file.name);
    var seriesDescription = str(dataSet, "x0008103e", "");
    var modality = str(dataSet, "x00080060", "");
    var sopInstanceUID = str(dataSet, "x00080018", "");

    var pixelDataElement = dataSet.elements.x7fe00010;

    var instance = {
      file: file,
      fileName: file.name,
      dataSet: dataSet,
      byteArray: byteArray,
      transferSyntax: transferSyntax,
      syntaxKind: syntaxKind,
      pixelDataElement: pixelDataElement,

      rows: rows,
      columns: columns,
      bitsAllocated: bitsAllocated,
      pixelRepresentation: pixelRepresentation,
      samplesPerPixel: samplesPerPixel,
      photometric: photometric,
      numberOfFrames: numberOfFrames,
      planarConfiguration: planarConfiguration,

      rescaleSlope: rescaleSlope,
      rescaleIntercept: rescaleIntercept,
      fileWW: fileWW,
      fileWC: fileWC,
      pixelSpacingRow: pixelSpacingRow,
      pixelSpacingCol: pixelSpacingCol,

      instanceNumber: isNaN(instanceNumber) ? null : instanceNumber,
      sliceLocation: isNaN(sliceLocation) ? null : sliceLocation,
      imagePositionZ: isNaN(imagePositionZ) ? null : imagePositionZ,

      seriesUID: seriesUID,
      seriesDescription: seriesDescription,
      modality: modality,
      sopInstanceUID: sopInstanceUID,

      // per-frame decoded cache: array indexed by frame number
      _frameCache: {},
    };

    return instance;
  }

  /* ---------------------------------------------------------------------
   * Pixel decoding: raw stored values -> real-world (rescaled) Float32Array
   * ------------------------------------------------------------------- */
  function decodeFrameRealValues(instance, frameIndex) {
    var cached = instance._frameCache[frameIndex];
    if (cached) return cached;

    if (!instance.syntaxKind) {
      throw new Error(
        "Unsupported transfer syntax (" + instance.transferSyntax + "). " +
        "This viewer supports uncompressed DICOM only. Re-export as " +
        "Explicit/Implicit VR Little Endian, or convert with a tool like dcm2niix/GDCM first."
      );
    }
    if (!instance.pixelDataElement) {
      throw new Error("File has no Pixel Data element.");
    }

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
    } else {
      // 16-bit samples. DICOM Explicit/Implicit VR Little Endian (the vast
      // majority of real-world CT exports) matches native typed-array
      // endianness, so a direct view works. Explicit VR Big Endian is
      // rare (retired in modern DICOM) — byte-swap it explicitly.
      if (instance.syntaxKind === "explicit-big-endian") {
        var swapped = new Uint16Array(pixelsPerFrame);
        var dv = new DataView(buffer, byteOffset, pixelsPerFrame * 2);
        for (var i = 0; i < pixelsPerFrame; i++) {
          swapped[i] = dv.getUint16(i * 2, false);
        }
        raw = instance.pixelRepresentation === 1 ? new Int16Array(swapped.buffer) : swapped;
      } else if (instance.pixelRepresentation === 1) {
        raw = new Int16Array(buffer, byteOffset, pixelsPerFrame);
      } else {
        raw = new Uint16Array(buffer, byteOffset, pixelsPerFrame);
      }
    }

    // Convert to real-world values (e.g. Hounsfield Units for CT) and, if
    // the image is multi-sample (RGB), reduce to luminance grayscale.
    var out = new Float32Array(rows * cols);
    var slope = instance.rescaleSlope, intercept = instance.rescaleIntercept;
    if (samplesPerPixel >= 3) {
      // Interleaved RGB assumed (planarConfiguration 0); good enough for the
      // occasional color secondary-capture image mixed into a CT series.
      for (var p = 0; p < rows * cols; p++) {
        var r = raw[p * samplesPerPixel];
        var g = raw[p * samplesPerPixel + 1];
        var b = raw[p * samplesPerPixel + 2];
        out[p] = (0.299 * r + 0.587 * g + 0.114 * b) * slope + intercept;
      }
    } else {
      for (var j = 0; j < out.length; j++) {
        out[j] = raw[j] * slope + intercept;
      }
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

  /* ---------------------------------------------------------------------
   * Windowing: real values -> 8-bit grayscale ImageData, drawn to an
   * offscreen canvas at native resolution.
   * ------------------------------------------------------------------- */
  function buildWindowedCanvas(instance, frameIndex, ww, wc, invert) {
    var decoded = decodeFrameRealValues(instance, frameIndex);
    var values = decoded.values;
    var rows = instance.rows, cols = instance.columns;

    var canvas = document.createElement("canvas");
    canvas.width = cols;
    canvas.height = rows;
    var ctx = canvas.getContext("2d");
    var imageData = ctx.createImageData(cols, rows);
    var data = imageData.data;

    var lower = wc - ww / 2;
    var widthSafe = ww <= 0 ? 1 : ww;
    var isMonochrome1 = instance.photometric === "MONOCHROME1";

    for (var i = 0, n = values.length; i < n; i++) {
      var v = values[i];
      var g;
      if (v <= lower) g = 0;
      else if (v >= lower + widthSafe) g = 255;
      else g = ((v - lower) / widthSafe) * 255;

      // MONOCHROME1 is inherently "0 = white" — invert unless the user has
      // already toggled invert (double negative cancels back to normal).
      if (isMonochrome1) g = 255 - g;
      if (invert) g = 255 - g;

      var idx = i * 4;
      data[idx] = g;
      data[idx + 1] = g;
      data[idx + 2] = g;
      data[idx + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
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
      if (a.instanceNumber !== null && b.instanceNumber !== null && a.instanceNumber !== b.instanceNumber) {
        return a.instanceNumber - b.instanceNumber;
      }
      if (a.imagePositionZ !== null && b.imagePositionZ !== null && a.imagePositionZ !== b.imagePositionZ) {
        return a.imagePositionZ - b.imagePositionZ;
      }
      if (a.sliceLocation !== null && b.sliceLocation !== null && a.sliceLocation !== b.sliceLocation) {
        return a.sliceLocation - b.sliceLocation;
      }
      return a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0;
    });
  }

  function expandMultiFrame(group) {
    // Represent each frame of a multi-frame instance as its own "slice" in
    // the stack, so the slider/thumbnails work uniformly.
    var expanded = [];
    group.instances.forEach(function (inst) {
      for (var f = 0; f < inst.numberOfFrames; f++) {
        expanded.push({ instance: inst, frameIndex: f });
      }
    });
    group.slices = expanded;
  }

  function getCurrentGroup() {
    return state.currentSeriesUID ? state.seriesMap[state.currentSeriesUID] : null;
  }
  function getCurrentSlice() {
    var group = getCurrentGroup();
    if (!group || !group.slices || !group.slices.length) return null;
    var idx = Math.max(0, Math.min(state.currentIndex, group.slices.length - 1));
    return group.slices[idx];
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
   * Loading files
   * ------------------------------------------------------------------- */
  function loadFiles(fileList) {
    var files = Array.prototype.filter.call(fileList, function (f) {
      return f.size > 132; // smaller than a DICOM preamble+header can't be valid
    });
    if (!files.length) {
      showToast("No files to load.", true);
      return;
    }

    var loaded = 0, skipped = 0;
    var pending = files.length;
    var firstNewSeriesUID = null;

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
          console.warn("Skipped file", file.name, err);
        } finally {
          pending--;
          if (pending === 0) onAllFilesProcessed(loaded, skipped, firstNewSeriesUID);
        }
      };
      reader.onerror = function () {
        skipped++;
        pending--;
        if (pending === 0) onAllFilesProcessed(loaded, skipped, firstNewSeriesUID);
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

    if (loaded > 0) {
      if (!state.currentSeriesUID) {
        selectSeries(firstNewSeriesUID || state.seriesOrder[0]);
      }
      renderSeriesList();
      showToast(
        loaded + " image" + (loaded === 1 ? "" : "s") + " loaded" +
        (skipped ? ", " + skipped + " skipped (not readable DICOM)" : ".")
      );
    } else {
      showToast("Couldn't read any DICOM files from the selection.", true);
    }
  }

  /* ---------------------------------------------------------------------
   * Series list / thumbnails UI
   * ------------------------------------------------------------------- */
  // uid -> { wrapper, sliceCount }, so loading more files doesn't force every
  // already-rendered series to regenerate its thumbnails from scratch.
  var seriesNodes = {};

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
      if (cached && cached.sliceCount === group.slices.length) return;

      var wrapper = buildSeriesNode(group, uid);
      if (cached && cached.wrapper.parentNode) {
        dom.seriesList.replaceChild(wrapper, cached.wrapper);
      } else {
        dom.seriesList.appendChild(wrapper);
      }
      seriesNodes[uid] = { wrapper: wrapper, sliceCount: group.slices.length };
    });
  }

  function buildSeriesNode(group, uid) {
    var wrapper = document.createElement("div");
    wrapper.className = "series-group";

    var header = document.createElement("div");
    header.className = "series-header";
    header.innerHTML =
      '<span>' + escapeHtml(group.modality ? group.modality + " — " : "") +
      escapeHtml(group.description) + '</span>' +
      '<span class="series-count">' + group.slices.length + '</span>';
    header.addEventListener("click", function () {
      selectSeries(uid);
    });
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
          if (uid === state.currentSeriesUID && index === state.currentIndex) {
            thumb.classList.add("active");
          }
          try {
            var ww = wwOf(slice.instance);
            var wc = wcOf(slice.instance);
            var small = buildWindowedCanvas(slice.instance, slice.frameIndex, ww, wc, false);
            thumb.appendChild(small);
          } catch (err) {
            thumb.textContent = "⚠";
          }
          var idxLabel = document.createElement("span");
          idxLabel.className = "thumb-idx";
          idxLabel.textContent = String(index + 1);
          thumb.appendChild(idxLabel);
          thumb.addEventListener("click", function () {
            selectSeries(uid, index);
          });
          grid.appendChild(thumb);
        })(i);
      }
      if (i < group.slices.length) {
        setTimeout(step, 0);
      }
    }
    step();
  }

  function highlightActiveThumb() {
    var previous = dom.seriesList.querySelector(".thumb.active");
    if (previous) previous.classList.remove("active");
    if (!state.currentSeriesUID) return;
    var selector = '.thumb[data-uid="' + cssEscape(state.currentSeriesUID) +
      '"][data-index="' + state.currentIndex + '"]';
    var current = dom.seriesList.querySelector(selector);
    if (current) {
      current.classList.add("active");
      if (current.scrollIntoView) {
        current.scrollIntoView({ block: "nearest" });
      }
    }
  }

  function cssEscape(value) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }

  /* ---------------------------------------------------------------------
   * Selecting series / slices
   * ------------------------------------------------------------------- */
  function selectSeries(uid, index) {
    state.currentSeriesUID = uid;
    state.currentIndex = index || 0;

    var group = getCurrentGroup();
    if (group && group.slices.length) {
      var first = group.slices[0].instance;
      state.windowWidth = wwOf(first);
      state.windowCenter = wcOf(first);
    }
    resetView(true);
    dom.sliceSlider.max = group ? Math.max(0, group.slices.length - 1) : 0;
    dom.sliceSlider.value = state.currentIndex;
    dom.sliceSlider.disabled = !group || group.slices.length <= 1;
    render();
    highlightActiveThumb();
  }

  function setSliceIndex(index) {
    var group = getCurrentGroup();
    if (!group || !group.slices.length) return;
    var clamped = Math.max(0, Math.min(index, group.slices.length - 1));
    if (clamped === state.currentIndex) return;
    state.currentIndex = clamped;
    dom.sliceSlider.value = clamped;
    render();
    highlightActiveThumb();
  }

  /* ---------------------------------------------------------------------
   * Rendering
   * ------------------------------------------------------------------- */
  function resizeCanvasToViewport() {
    var rect = dom.viewport.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    dom.canvas.width = Math.round(rect.width * dpr);
    dom.canvas.height = Math.round(rect.height * dpr);
    dom.canvas.style.width = rect.width + "px";
    dom.canvas.style.height = rect.height + "px";
  }

  function render() {
    var slice = getCurrentSlice();
    dom.viewportEmpty.style.display = slice ? "none" : "flex";
    if (!slice) {
      var ctx0 = dom.ctx;
      ctx0.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
      clearOverlays();
      dom.sliceCounter.textContent = "0 / 0";
      dom.zoomLabel.textContent = Math.round(state.zoom * 100) + "%";
      updateWLInputs();
      renderMetadata(null);
      return;
    }

    var instance = slice.instance;
    var canvas;
    try {
      canvas = buildWindowedCanvas(instance, slice.frameIndex, state.windowWidth, state.windowCenter, state.invert);
    } catch (err) {
      showToast(err.message, true);
      dom.ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
      clearOverlays();
      return;
    }

    var ctx = dom.ctx;
    var cw = dom.canvas.width, ch = dom.canvas.height;
    ctx.save();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = true;

    var aspectX = instance.pixelSpacingCol || 1;
    var aspectY = instance.pixelSpacingRow || 1;
    var imgW = instance.columns * aspectX;
    var imgH = instance.rows * aspectY;
    var rotated = state.rotation % 180 !== 0;
    var fitW = rotated ? imgH : imgW;
    var fitH = rotated ? imgW : imgH;
    var fitScale = Math.min(cw / fitW, ch / fitH) * 0.95;
    var scale = fitScale * state.zoom;

    ctx.translate(cw / 2 + state.panX, ch / 2 + state.panY);
    ctx.rotate((state.rotation * Math.PI) / 180);
    ctx.scale(state.flipH ? -1 : 1, state.flipV ? -1 : 1);
    ctx.scale(scale * aspectX, scale * aspectY);
    ctx.drawImage(canvas, -instance.columns / 2, -instance.rows / 2);
    ctx.restore();

    updateOverlays(instance, slice);
    updateWLInputs();
    renderMetadata(instance);
  }

  function clearOverlays() {
    dom.overlayTL.textContent = "";
    dom.overlayTR.textContent = "";
    dom.overlayBL.textContent = "";
    dom.overlayBR.textContent = "";
  }

  function updateOverlays(instance, slice) {
    var group = getCurrentGroup();
    var patientName = formatPersonName(str(instance.dataSet, "x00100010", ""));
    var patientId = str(instance.dataSet, "x00100020", "");
    dom.overlayTL.textContent =
      (patientName ? patientName + "\n" : "") +
      (patientId ? "ID: " + patientId : "");

    dom.overlayTR.textContent =
      (instance.modality || "") + "\n" +
      (group ? group.description : "");

    dom.overlayBL.textContent =
      "WW: " + Math.round(state.windowWidth) + "  WL: " + Math.round(state.windowCenter) +
      (state.invert ? "  [Inverted]" : "");

    var sliceLabel = group ? state.currentIndex + 1 + " / " + group.slices.length : "";
    dom.overlayBR.textContent =
      sliceLabel +
      (instance.sliceLocation !== null ? "\nLoc: " + instance.sliceLocation.toFixed(1) + " mm" : "");

    dom.sliceCounter.textContent = sliceLabel || "0 / 0";
    dom.zoomLabel.textContent = Math.round(state.zoom * 100) + "%";
  }

  function updateWLInputs() {
    dom.windowWidthInput.value = Math.round(state.windowWidth);
    dom.windowCenterInput.value = Math.round(state.windowCenter);
  }

  /* ---------------------------------------------------------------------
   * Metadata panel
   * ------------------------------------------------------------------- */
  function metaRow(container, label, value) {
    if (value === undefined || value === null || value === "") return;
    var row = document.createElement("div");
    row.className = "meta-row";
    var k = document.createElement("span");
    k.className = "meta-key";
    k.textContent = label;
    var v = document.createElement("span");
    v.className = "meta-val";
    v.textContent = value;
    row.appendChild(k);
    row.appendChild(v);
    container.appendChild(row);
  }
  function metaSection(container, title) {
    var el = document.createElement("div");
    el.className = "meta-section";
    el.textContent = title;
    container.appendChild(el);
  }

  function renderMetadata(instance) {
    var container = dom.metaTable;
    container.innerHTML = "";
    if (!instance) {
      var p = document.createElement("p");
      p.className = "muted small";
      p.textContent = "No image loaded.";
      container.appendChild(p);
      return;
    }
    var ds = instance.dataSet;

    metaSection(container, "Patient");
    metaRow(container, "Name", formatPersonName(str(ds, "x00100010", "")));
    metaRow(container, "Patient ID", str(ds, "x00100020", ""));
    metaRow(container, "Birth Date", formatDicomDate(str(ds, "x00100030", "")));
    metaRow(container, "Sex", str(ds, "x00100040", ""));

    metaSection(container, "Study");
    metaRow(container, "Study Date", formatDicomDate(str(ds, "x00080020", "")));
    metaRow(container, "Study Time", formatDicomTime(str(ds, "x00080030", "")));
    metaRow(container, "Description", str(ds, "x00081030", ""));
    metaRow(container, "Accession #", str(ds, "x00080050", ""));

    metaSection(container, "Series / Image");
    metaRow(container, "Modality", instance.modality);
    metaRow(container, "Series Desc.", instance.seriesDescription);
    metaRow(container, "Instance #", instance.instanceNumber);
    metaRow(container, "Manufacturer", str(ds, "x00080070", ""));
    metaRow(container, "Model", str(ds, "x00081090", ""));

    metaSection(container, "Geometry");
    metaRow(container, "Rows × Cols", instance.rows + " × " + instance.columns);
    metaRow(container, "Pixel Spacing", instance.pixelSpacingRow.toFixed(3) + " × " + instance.pixelSpacingCol.toFixed(3) + " mm");
    metaRow(container, "Slice Thickness", (function () { var v = num(ds, "x00180050", null); return v !== null ? v.toFixed(2) + " mm" : ""; })());
    metaRow(container, "Slice Location", instance.sliceLocation !== null ? instance.sliceLocation.toFixed(2) + " mm" : "");
    metaRow(container, "KVP", (function () { var v = num(ds, "x00180060", null); return v !== null ? v + " kV" : ""; })());

    metaSection(container, "Pixel Data");
    metaRow(container, "Bits Allocated", instance.bitsAllocated);
    metaRow(container, "Photometric", instance.photometric);
    metaRow(container, "Rescale Slope/Int.", instance.rescaleSlope + " / " + instance.rescaleIntercept);
    metaRow(container, "Frames", instance.numberOfFrames);
    metaRow(container, "Transfer Syntax", instance.transferSyntax + (instance.syntaxKind ? "" : " (unsupported)"));

    metaSection(container, "File");
    metaRow(container, "File Name", instance.fileName);
    metaRow(container, "SOP Instance UID", instance.sopInstanceUID);
  }

  function escapeHtml(s) {
    var div = document.createElement("div");
    div.textContent = String(s);
    return div.innerHTML;
  }

  /* ---------------------------------------------------------------------
   * View manipulation
   * ------------------------------------------------------------------- */
  function resetView(keepWL) {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    state.flipH = false;
    state.flipV = false;
    state.rotation = 0;
    state.invert = false;
    dom.invertBtn.classList.remove("active");
    if (!keepWL) {
      var slice = getCurrentSlice();
      if (slice) {
        state.windowWidth = wwOf(slice.instance);
        state.windowCenter = wcOf(slice.instance);
      }
    }
  }

  function applyPreset(key) {
    var preset = PRESETS[key];
    if (!preset) return;
    state.windowWidth = preset.ww;
    state.windowCenter = preset.wc;
    render();
  }

  function stopCine() {
    if (state.cineTimer) {
      clearInterval(state.cineTimer);
      state.cineTimer = null;
    }
    state.cinePlaying = false;
    dom.cinePlayBtn.textContent = "▶️";
  }
  function toggleCine() {
    var group = getCurrentGroup();
    if (!group || group.slices.length <= 1) return;
    if (state.cinePlaying) {
      stopCine();
      return;
    }
    state.cinePlaying = true;
    dom.cinePlayBtn.textContent = "⏸️";
    state.cineTimer = setInterval(function () {
      var g = getCurrentGroup();
      if (!g) return;
      var next = (state.currentIndex + 1) % g.slices.length;
      setSliceIndex(next);
    }, CINE_INTERVAL_MS);
  }

  /* ---------------------------------------------------------------------
   * Event wiring
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
      if (!confirm("Clear all loaded series and images?")) return;
      stopCine();
      state.seriesOrder = [];
      state.seriesMap = {};
      state.currentSeriesUID = null;
      state.currentIndex = 0;
      resetView(true);
      dom.sliceSlider.disabled = true;
      dom.sliceSlider.value = 0;
      renderSeriesList();
      render();
    });

    dom.presetSelect.addEventListener("change", function (e) {
      applyPreset(e.target.value);
    });

    dom.invertBtn.addEventListener("click", function () {
      state.invert = !state.invert;
      dom.invertBtn.classList.toggle("active", state.invert);
      render();
    });
    dom.flipHBtn.addEventListener("click", function () {
      state.flipH = !state.flipH;
      render();
    });
    dom.flipVBtn.addEventListener("click", function () {
      state.flipV = !state.flipV;
      render();
    });
    dom.rotateBtn.addEventListener("click", function () {
      state.rotation = (state.rotation + 90) % 360;
      render();
    });
    dom.resetBtn.addEventListener("click", function () {
      resetView(false);
      render();
    });

    dom.metaToggleBtn.addEventListener("click", function () {
      state.metaVisible = !state.metaVisible;
      dom.metaPanel.classList.toggle("collapsed", !state.metaVisible);
      dom.metaToggleBtn.classList.toggle("active", state.metaVisible);
      resizeCanvasToViewport();
      render();
    });
    dom.thumbToggleBtn.addEventListener("click", function () {
      state.thumbsVisible = !state.thumbsVisible;
      dom.thumbPanel.classList.toggle("collapsed", !state.thumbsVisible);
      dom.thumbToggleBtn.classList.toggle("active", state.thumbsVisible);
      resizeCanvasToViewport();
      render();
    });

    dom.cinePlayBtn.addEventListener("click", toggleCine);
    dom.sliceSlider.addEventListener("input", function (e) {
      stopCine();
      setSliceIndex(parseInt(e.target.value, 10));
    });

    dom.windowWidthInput.addEventListener("change", function (e) {
      var v = parseFloat(e.target.value);
      if (!isNaN(v) && v > 0) {
        state.windowWidth = v;
        dom.presetSelect.value = "";
        render();
      }
    });
    dom.windowCenterInput.addEventListener("change", function (e) {
      var v = parseFloat(e.target.value);
      if (!isNaN(v)) {
        state.windowCenter = v;
        dom.presetSelect.value = "";
        render();
      }
    });

    // --- Canvas mouse interactions ---
    dom.canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    dom.canvas.addEventListener("mousedown", function (e) {
      if (!getCurrentSlice()) return;
      e.preventDefault();
      if (e.button === 0) state.dragMode = "wl";
      else if (e.button === 1 || e.button === 2) state.dragMode = "pan";
      state.dragStart = { x: e.clientX, y: e.clientY, ww: state.windowWidth, wc: state.windowCenter, panX: state.panX, panY: state.panY };
    });
    window.addEventListener("mousemove", function (e) {
      if (!state.dragMode || !state.dragStart) return;
      var dx = e.clientX - state.dragStart.x;
      var dy = e.clientY - state.dragStart.y;
      if (state.dragMode === "wl") {
        var wwSensitivity = 2, wcSensitivity = 2;
        state.windowWidth = Math.max(1, state.dragStart.ww + dx * wwSensitivity);
        state.windowCenter = state.dragStart.wc - dy * wcSensitivity;
        dom.presetSelect.value = "";
        render();
      } else if (state.dragMode === "pan") {
        // panX/panY live in the canvas's device-pixel space, but mouse deltas
        // are CSS pixels — scale so the image tracks the cursor 1:1 on HiDPI.
        var dpr = window.devicePixelRatio || 1;
        state.panX = state.dragStart.panX + dx * dpr;
        state.panY = state.dragStart.panY + dy * dpr;
        render();
      }
    });
    window.addEventListener("mouseup", function () {
      state.dragMode = null;
      state.dragStart = null;
    });

    dom.canvas.addEventListener("wheel", function (e) {
      if (!getCurrentSlice()) return;
      e.preventDefault();
      if (e.shiftKey) {
        setSliceIndex(state.currentIndex + (e.deltaY > 0 ? 1 : -1));
        return;
      }
      var factor = e.deltaY > 0 ? 0.9 : 1.1;
      state.zoom = Math.max(0.1, Math.min(20, state.zoom * factor));
      render();
    }, { passive: false });

    // --- Keyboard shortcuts ---
    window.addEventListener("keydown", function (e) {
      if (["INPUT", "SELECT", "TEXTAREA"].indexOf(document.activeElement.tagName) !== -1) return;
      var group = getCurrentGroup();
      switch (e.key) {
        case "ArrowUp":
        case "ArrowRight":
          if (group) { stopCine(); setSliceIndex(state.currentIndex + 1); }
          e.preventDefault();
          break;
        case "ArrowDown":
        case "ArrowLeft":
          if (group) { stopCine(); setSliceIndex(state.currentIndex - 1); }
          e.preventDefault();
          break;
        case "PageUp":
          if (group) { stopCine(); setSliceIndex(state.currentIndex - 10); }
          e.preventDefault();
          break;
        case "PageDown":
          if (group) { stopCine(); setSliceIndex(state.currentIndex + 10); }
          e.preventDefault();
          break;
        case "i":
        case "I":
          dom.invertBtn.click();
          break;
        case "r":
        case "R":
          resetView(false);
          render();
          break;
        case "+":
        case "=":
          state.zoom = Math.min(20, state.zoom * 1.1);
          render();
          break;
        case "-":
        case "_":
          state.zoom = Math.max(0.1, state.zoom * 0.9);
          render();
          break;
        case " ":
          toggleCine();
          e.preventDefault();
          break;
      }
    });

    // --- Drag and drop ---
    ["dragenter", "dragover"].forEach(function (evt) {
      document.body.addEventListener(evt, function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
    });
    document.body.addEventListener("drop", function (e) {
      e.preventDefault();
      e.stopPropagation();
      handleDrop(e.dataTransfer);
    });

    // --- Resize ---
    window.addEventListener("resize", function () {
      resizeCanvasToViewport();
      render();
    });
    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        resizeCanvasToViewport();
        render();
      }).observe(dom.viewport);
    }
  }

  function handleDrop(dataTransfer) {
    var items = dataTransfer.items;
    if (items && items.length && items[0].webkitGetAsEntry) {
      var files = [];
      var pendingEntries = 0;
      var doneReading = false;

      function finalize() {
        if (doneReading && pendingEntries === 0) {
          if (files.length) loadFiles(files);
          else showToast("No readable files found in drop.", true);
        }
      }
      function readEntry(entry) {
        if (entry.isFile) {
          pendingEntries++;
          entry.file(function (file) {
            files.push(file);
            pendingEntries--;
            finalize();
          }, function () {
            pendingEntries--;
            finalize();
          });
        } else if (entry.isDirectory) {
          pendingEntries++;
          var reader = entry.createReader();
          var readBatch = function () {
            reader.readEntries(function (entries) {
              if (!entries.length) {
                pendingEntries--;
                finalize();
                return;
              }
              entries.forEach(readEntry);
              readBatch();
            }, function () {
              pendingEntries--;
              finalize();
            });
          };
          readBatch();
        }
      }

      for (var i = 0; i < items.length; i++) {
        var entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
        if (entry) readEntry(entry);
      }
      doneReading = true;
      finalize();
    } else if (dataTransfer.files && dataTransfer.files.length) {
      loadFiles(dataTransfer.files);
    }
  }

  /* ---------------------------------------------------------------------
   * Init
   * ------------------------------------------------------------------- */
  function init() {
    cacheDom();
    wireEvents();
    dom.metaToggleBtn.classList.toggle("active", state.metaVisible);
    dom.thumbToggleBtn.classList.toggle("active", state.thumbsVisible);
    resizeCanvasToViewport();
    render();

    if (!("dicomParser" in window)) {
      showToast("dicom-parser library failed to load.", true);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
