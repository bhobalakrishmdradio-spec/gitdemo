/* ==========================================================================
   CT Console — volume engine.

   Turns a sorted DICOM series into a regularly-sampled 3D volume of
   Hounsfield Units, then serves oblique-free (orthogonal) MPR planes out of
   it: axial, coronal and sagittal, optionally as a slab of given thickness
   projected with Average / MIP / MinIP.

   Everything here is pure computation over typed arrays — no DOM, no
   globals beyond the CTVolume namespace — so it can be exercised headlessly.
   ========================================================================== */
(function (global) {
  "use strict";

  var AIR_HU = -1024;

  // A 512x512x400 series is 105M voxels = 210MB as Int16. Past this budget we
  // downsample in-plane so a large study can't wedge the tab.
  var MAX_VOXELS = 80e6;

  var PLANES = { axial: "axial", coronal: "coronal", sagittal: "sagittal" };
  var MODES = { average: "average", mip: "mip", minip: "minip" };

  /* ---------------------------------------------------------------------
   * Building
   * ------------------------------------------------------------------- */

  /**
   * Assemble a volume from a series group.
   *
   * @param {Array} slices  group.slices — [{ instance, frameIndex }, ...] in display order
   * @param {Function} decode  (instance, frameIndex) -> Float32Array of HU
   * @param {Object} [opts]  { onProgress: fn(done, total) }
   * @returns {Object|null}  volume, or null when the series can't form one
   */
  function build(slices, decode, opts) {
    opts = opts || {};
    if (!slices || slices.length < 2) return null;

    var first = slices[0].instance;
    var cols = first.columns, rows = first.rows;
    if (!cols || !rows) return null;

    // Geometry must be consistent — a series mixing matrix sizes (e.g. a
    // scout mixed into the stack) can't be stacked into one array.
    var usable = slices.filter(function (s) {
      return s.instance.columns === cols && s.instance.rows === rows;
    });
    if (usable.length < 2) return null;

    var geometry = inspectGeometry(usable);
    var spacingZ = geometry.spacing;
    var step = 1;
    while ((cols / step) * (rows / step) * usable.length > MAX_VOXELS) step *= 2;

    var outCols = Math.floor(cols / step);
    var outRows = Math.floor(rows / step);
    var depth = usable.length;

    var data = new Int16Array(outCols * outRows * depth);
    var minHU = Infinity, maxHU = -Infinity;

    for (var z = 0; z < depth; z++) {
      var frame;
      try {
        frame = decode(usable[z].instance, usable[z].frameIndex);
      } catch (err) {
        // A single unreadable slice shouldn't sink the whole volume; leave it
        // as air so the stack keeps its geometry.
        frame = null;
      }
      var base = z * outCols * outRows;
      for (var y = 0; y < outRows; y++) {
        var srcRow = y * step * cols;
        var dstRow = base + y * outCols;
        for (var x = 0; x < outCols; x++) {
          var v = frame ? frame[srcRow + x * step] : AIR_HU;
          // Clamp into Int16 range; CT HU never legitimately exceeds this.
          if (v < -32768) v = -32768; else if (v > 32767) v = 32767;
          v = v | 0;
          data[dstRow + x] = v;
          if (v < minHU) minHU = v;
          if (v > maxHU) maxHU = v;
        }
      }
      if (opts.onProgress) opts.onProgress(z + 1, depth);
    }

    return {
      cols: outCols,
      rows: outRows,
      depth: depth,
      spacingX: (first.pixelSpacingCol || 1) * step,
      spacingY: (first.pixelSpacingRow || 1) * step,
      spacingZ: spacingZ,
      data: data,
      minHU: minHU === Infinity ? AIR_HU : minHU,
      maxHU: maxHU === -Infinity ? AIR_HU : maxHU,
      downsample: step,
      slices: usable,
      boneMask: null,
      warnings: geometry.warnings.concat(
        usable.length < slices.length
          ? [(slices.length - usable.length) + " slice(s) excluded: image matrix differs from the rest of the series."]
          : []
      ),
      // Reslicing across Z is only metrically trustworthy when the slice
      // spacing is actually regular.
      spacingZReliable: geometry.regular,
    };
  }

  /**
   * Check the series geometry before it is reconstructed, so incompatible
   * or incomplete stacks are explained rather than silently reformatted.
   */
  function inspectGeometry(slices) {
    var warnings = [];
    var zs = [];
    for (var i = 0; i < slices.length; i++) {
      var inst = slices[i].instance;
      var z = inst.imagePositionZ;
      if (z === null || z === undefined || isNaN(z)) z = inst.sliceLocation;
      if (z !== null && z !== undefined && !isNaN(z)) zs.push(z);
    }

    if (zs.length < slices.length) {
      warnings.push(
        "Slice positions are missing on " + (slices.length - zs.length) +
        " slice(s); ordering fell back to instance number and spacing is assumed."
      );
    }

    // Orientation must be consistent for a single stack to be meaningful.
    var first = slices[0].instance.imageOrientation;
    var orientationVaries = false;
    if (first) {
      for (var k = 1; k < slices.length; k++) {
        var o = slices[k].instance.imageOrientation;
        if (!o) continue;
        for (var c = 0; c < 6; c++) {
          if (Math.abs(o[c] - first[c]) > 1e-3) { orientationVaries = true; break; }
        }
        if (orientationVaries) break;
      }
      if (orientationVaries) {
        warnings.push("Image Orientation changes within the series — reformatted planes may be geometrically wrong.");
      }
      // Gantry tilt / non-axial acquisition: row and column cosines that
      // aren't aligned to the patient axes aren't handled by this reslicer.
      var axial = Math.abs(first[0]) > 0.99 && Math.abs(first[4]) > 0.99;
      if (!axial) {
        warnings.push("Non-axial or tilted acquisition detected — this viewer reslices on the voxel grid only, so MPR may be skewed.");
      }
    } else {
      warnings.push("Image Orientation (Patient) is absent — orientation markers are not shown.");
    }

    // Regular spacing check.
    var gaps = [];
    for (var g = 1; g < zs.length; g++) {
      var d = Math.abs(zs[g] - zs[g - 1]);
      if (d > 1e-4) gaps.push(d);
    }
    var regular = true;
    var spacing = 1;
    if (gaps.length) {
      var sorted = gaps.slice().sort(function (a, b) { return a - b; });
      spacing = sorted[Math.floor(sorted.length / 2)];
      var tolerance = Math.max(0.02 * spacing, 1e-3);
      var irregular = gaps.filter(function (d) { return Math.abs(d - spacing) > tolerance; }).length;
      if (irregular) {
        regular = false;
        warnings.push(
          irregular + " inter-slice gap(s) differ from the median " + round2(spacing) +
          "mm — the stack is irregularly sampled, so out-of-plane distances are approximate."
        );
      }
    } else {
      regular = false;
      var thickness = slices[0].instance.sliceThickness;
      spacing = thickness && thickness > 0 ? thickness : 1;
      warnings.push("No usable slice positions — spacing assumed from Slice Thickness; out-of-plane measurements are uncalibrated.");
    }

    return { spacing: spacing, regular: regular, warnings: warnings };
  }

  function round2(v) { return Math.round(v * 100) / 100; }

  /**
   * Slice-to-slice spacing in mm. Prefers the median gap between
   * ImagePositionPatient Z values (robust to a duplicate or stray slice) and
   * falls back to SliceThickness, then 1mm.
   */
  function estimateSliceSpacing(slices) {
    var zs = [];
    for (var i = 0; i < slices.length; i++) {
      var inst = slices[i].instance;
      var z = inst.imagePositionZ;
      if (z === null || z === undefined || isNaN(z)) z = inst.sliceLocation;
      if (z !== null && z !== undefined && !isNaN(z)) zs.push(z);
    }
    if (zs.length >= 2) {
      var gaps = [];
      for (var g = 1; g < zs.length; g++) {
        var d = Math.abs(zs[g] - zs[g - 1]);
        if (d > 1e-4) gaps.push(d);
      }
      if (gaps.length) {
        gaps.sort(function (a, b) { return a - b; });
        var median = gaps[Math.floor(gaps.length / 2)];
        if (median > 1e-4) return median;
      }
    }
    var thickness = slices[0].instance.sliceThickness;
    return thickness && thickness > 0 ? thickness : 1;
  }

  /* ---------------------------------------------------------------------
   * Plane geometry
   * ------------------------------------------------------------------- */

  /** Number of addressable positions along a plane's normal. */
  function planeCount(volume, plane) {
    if (plane === PLANES.coronal) return volume.rows;
    if (plane === PLANES.sagittal) return volume.cols;
    return volume.depth;
  }

  /** In-plane output dimensions and physical spacing for a plane. */
  function planeGeometry(volume, plane) {
    if (plane === PLANES.coronal) {
      return { width: volume.cols, height: volume.depth, spacingX: volume.spacingX, spacingY: volume.spacingZ };
    }
    if (plane === PLANES.sagittal) {
      return { width: volume.rows, height: volume.depth, spacingX: volume.spacingY, spacingY: volume.spacingZ };
    }
    return { width: volume.cols, height: volume.rows, spacingX: volume.spacingX, spacingY: volume.spacingY };
  }

  /** Voxel pitch along a plane's normal, in mm. */
  function normalSpacing(volume, plane) {
    if (plane === PLANES.coronal) return volume.spacingY;
    if (plane === PLANES.sagittal) return volume.spacingX;
    return volume.spacingZ;
  }

  /* ---------------------------------------------------------------------
   * Plane / slab extraction
   * ------------------------------------------------------------------- */

  /**
   * Extract one plane, optionally as a projected slab.
   *
   * @param {Object} volume
   * @param {string} plane     'axial' | 'coronal' | 'sagittal'
   * @param {number} index     position along the plane normal
   * @param {Object} [opts]    { thicknessMm, mode, boneCut }
   * @returns {{data: Float32Array, width, height, spacingX, spacingY, samples}}
   */
  function extractPlane(volume, plane, index, opts) {
    opts = opts || {};
    var geom = planeGeometry(volume, plane);
    var count = planeCount(volume, plane);
    var mode = opts.mode || MODES.average;
    var mask = opts.boneCut ? volume.boneMask : null;

    index = clamp(Math.round(index), 0, count - 1);

    // Turn a physical slab thickness into a symmetric run of voxel planes.
    var pitch = normalSpacing(volume, plane);
    var thickness = opts.thicknessMm || 0;
    var span = thickness > pitch ? Math.round(thickness / pitch) : 1;
    if (span < 1) span = 1;
    var half = Math.floor(span / 2);
    var from = clamp(index - half, 0, count - 1);
    var to = clamp(from + span - 1, 0, count - 1);

    var width = geom.width, height = geom.height;
    var out = new Float32Array(width * height);
    var samples = to - from + 1;

    var isMip = mode === MODES.mip;
    var isMinip = mode === MODES.minip;
    if (isMip) out.fill(-Infinity);
    else if (isMinip) out.fill(Infinity);

    for (var k = from; k <= to; k++) {
      accumulatePlane(volume, plane, k, out, mode, mask);
    }

    if (mode === MODES.average) {
      if (samples > 1) {
        for (var i = 0; i < out.length; i++) out[i] /= samples;
      }
    } else {
      // Guard against a slab that sampled nothing finite.
      for (var j = 0; j < out.length; j++) {
        if (!isFinite(out[j])) out[j] = AIR_HU;
      }
    }

    return {
      data: out,
      width: width,
      height: height,
      spacingX: geom.spacingX,
      spacingY: geom.spacingY,
      samples: samples,
      from: from,
      to: to,
    };
  }

  /**
   * Fold a single voxel plane into the accumulator. Split out of
   * extractPlane so the per-plane index arithmetic stays in one place.
   */
  function accumulatePlane(volume, plane, k, out, mode, mask) {
    var cols = volume.cols, rows = volume.rows, depth = volume.depth;
    var data = volume.data;
    var sliceStride = cols * rows;
    var isMip = mode === MODES.mip;
    var isMinip = mode === MODES.minip;
    var x, y, src, v, o = 0;

    if (plane === PLANES.axial) {
      var base = k * sliceStride;
      for (y = 0; y < rows; y++) {
        var rowBase = base + y * cols;
        for (x = 0; x < cols; x++) {
          src = rowBase + x;
          v = mask && mask[src] ? AIR_HU : data[src];
          if (isMip) { if (v > out[o]) out[o] = v; }
          else if (isMinip) { if (v < out[o]) out[o] = v; }
          else out[o] += v;
          o++;
        }
      }
      return;
    }

    if (plane === PLANES.coronal) {
      // Output row index is Z, column index is X; y is fixed at k.
      for (var z = 0; z < depth; z++) {
        var zBase = z * sliceStride + k * cols;
        for (x = 0; x < cols; x++) {
          src = zBase + x;
          v = mask && mask[src] ? AIR_HU : data[src];
          if (isMip) { if (v > out[o]) out[o] = v; }
          else if (isMinip) { if (v < out[o]) out[o] = v; }
          else out[o] += v;
          o++;
        }
      }
      return;
    }

    // Sagittal: output row index is Z, column index is Y; x is fixed at k.
    for (var z2 = 0; z2 < depth; z2++) {
      var zBase2 = z2 * sliceStride + k;
      for (y = 0; y < rows; y++) {
        src = zBase2 + y * cols;
        v = mask && mask[src] ? AIR_HU : data[src];
        if (isMip) { if (v > out[o]) out[o] = v; }
        else if (isMinip) { if (v < out[o]) out[o] = v; }
        else out[o] += v;
        o++;
      }
    }
  }

  /* ---------------------------------------------------------------------
   * Bone segmentation ("bone cut")
   * ------------------------------------------------------------------- */

  /**
   * Mark voxels at or above a HU threshold as bone, then grow the mask by a
   * few voxels so the lower-density cortical rim and partial-volume halo go
   * with it — cutting on the bare threshold alone leaves a bright outline
   * that reads as a shell in VR.
   *
   * @returns {Uint8Array} 1 where bone, 0 elsewhere
   */
  function computeBoneMask(volume, thresholdHU, dilation) {
    var threshold = thresholdHU === undefined ? 200 : thresholdHU;
    var grow = dilation === undefined ? 2 : dilation;
    var cols = volume.cols, rows = volume.rows, depth = volume.depth;
    var data = volume.data;
    var n = data.length;

    var mask = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      if (data[i] >= threshold) mask[i] = 1;
    }

    for (var pass = 0; pass < grow; pass++) {
      mask = dilateOnce(mask, cols, rows, depth);
    }
    volume.boneMask = mask;
    volume.boneThreshold = threshold;
    return mask;
  }

  /** One pass of 6-connected 3D dilation. */
  function dilateOnce(mask, cols, rows, depth) {
    var out = new Uint8Array(mask.length);
    var sliceStride = cols * rows;
    for (var z = 0; z < depth; z++) {
      for (var y = 0; y < rows; y++) {
        var rowBase = z * sliceStride + y * cols;
        for (var x = 0; x < cols; x++) {
          var i = rowBase + x;
          if (mask[i]) { out[i] = 1; continue; }
          if (
            (x > 0 && mask[i - 1]) ||
            (x < cols - 1 && mask[i + 1]) ||
            (y > 0 && mask[i - cols]) ||
            (y < rows - 1 && mask[i + cols]) ||
            (z > 0 && mask[i - sliceStride]) ||
            (z < depth - 1 && mask[i + sliceStride])
          ) {
            out[i] = 1;
          }
        }
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------------
   * Texture packing for the GPU volume renderer
   * ------------------------------------------------------------------- */

  /**
   * Pack the volume into a single Uint8Array suitable for a WebGL2 3D
   * texture, normalising HU into 0..255 across [windowLow, windowHigh] and
   * downsampling so the texture stays within maxDim on every axis.
   */
  function packTexture(volume, windowLow, windowHigh, maxDim, boneCut) {
    var lo = windowLow === undefined ? -1024 : windowLow;
    var hi = windowHigh === undefined ? 3071 : windowHigh;
    var limit = maxDim || 256;
    var mask = boneCut ? volume.boneMask : null;

    var sx = Math.max(1, Math.ceil(volume.cols / limit));
    var sy = Math.max(1, Math.ceil(volume.rows / limit));
    var sz = Math.max(1, Math.ceil(volume.depth / limit));

    var w = Math.floor(volume.cols / sx);
    var h = Math.floor(volume.rows / sy);
    var d = Math.floor(volume.depth / sz);

    var out = new Uint8Array(w * h * d);
    var data = volume.data;
    var sliceStride = volume.cols * volume.rows;
    var range = hi - lo || 1;
    var o = 0;

    for (var z = 0; z < d; z++) {
      var zBase = (z * sz) * sliceStride;
      for (var y = 0; y < h; y++) {
        var rowBase = zBase + (y * sy) * volume.cols;
        for (var x = 0; x < w; x++) {
          var src = rowBase + x * sx;
          var v = mask && mask[src] ? AIR_HU : data[src];
          var t = ((v - lo) / range) * 255;
          out[o++] = t < 0 ? 0 : t > 255 ? 255 : t;
        }
      }
    }

    return {
      data: out,
      width: w,
      height: h,
      depth: d,
      // Physical extent, so the renderer can keep the body proportioned
      // rather than stretching it to a cube.
      sizeX: w * volume.spacingX * sx,
      sizeY: h * volume.spacingY * sy,
      sizeZ: d * volume.spacingZ * sz,
      windowLow: lo,
      windowHigh: hi,
    };
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  global.CTVolume = {
    PLANES: PLANES,
    MODES: MODES,
    AIR_HU: AIR_HU,
    build: build,
    planeCount: planeCount,
    planeGeometry: planeGeometry,
    normalSpacing: normalSpacing,
    extractPlane: extractPlane,
    computeBoneMask: computeBoneMask,
    packTexture: packTexture,
    estimateSliceSpacing: estimateSliceSpacing,
  };
})(typeof window !== "undefined" ? window : globalThis);
