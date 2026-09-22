/* ==========================================================================
   CT Console — volume engine.

   Turns a sorted DICOM series into a regularly-sampled 3D volume of
   Hounsfield Units, then reslices planes out of it: the three orthogonal
   planes (axial, coronal, sagittal) by direct indexing, and arbitrary
   oblique planes by trilinear sampling. Either can be taken as a slab of
   given thickness projected with Average / MIP / MinIP.

   Everything here is pure computation over typed arrays — no DOM, no
   globals beyond the CTVolume namespace — so it can be exercised headlessly.
   ========================================================================== */
(function (global) {
  "use strict";

  var AIR_HU = -1024;

  // A 512x512x400 series is 105M voxels = 210MB as Int16. Past this budget we
  // downsample in-plane so a large study can't wedge the tab.
  var MAX_VOXELS = 80e6;

  // Oblique reslicing is trilinear-sampled in JS rather than blitted, so a
  // thick slab is capped to this many steps and the stride widened instead.
  var MAX_OBLIQUE_STEPS = 32;

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
   * Oblique reslicing
   *
   * Samples an arbitrary plane through the volume with trilinear
   * interpolation. The plane is defined by a centre point in millimetres and
   * two orthonormal in-plane axes; the slab is accumulated along their cross
   * product. At identity orientation this reduces to the orthogonal result.
   * ------------------------------------------------------------------- */

  /**
   * @param {Object} volume
   * @param {number[]} centerMm  [x, y, z] in millimetres from the volume origin
   * @param {number[]} axisU     unit vector for the output's +column direction
   * @param {number[]} axisV     unit vector for the output's +row direction
   * @param {Object} [opts]      { width, height, pixelMm, thicknessMm, mode, boneCut }
   */
  function extractOblique(volume, centerMm, axisU, axisV, opts) {
    opts = opts || {};
    var mode = opts.mode || MODES.average;
    var mask = opts.boneCut ? volume.boneMask : null;

    // Isotropic output sampling: use the finest voxel pitch so an oblique cut
    // through thick slices isn't needlessly blurred.
    var pixelMm = opts.pixelMm || Math.min(volume.spacingX, volume.spacingY, volume.spacingZ);
    var width = opts.width || defaultObliqueSize(volume, pixelMm);
    var height = opts.height || width;

    var normal = cross(axisU, axisV);
    var pitch = 1;  // step along the normal, in mm
    var thickness = opts.thicknessMm || 0;
    var span = thickness > pixelMm ? Math.round(thickness / pixelMm) : 1;
    if (span < 1) span = 1;
    pitch = pixelMm;
    // An oblique slab is trilinear-sampled per step, so cap the step count and
    // widen the stride instead: the slab still spans `thickness` millimetres.
    if (span > MAX_OBLIQUE_STEPS) {
      pitch = thickness / MAX_OBLIQUE_STEPS;
      span = MAX_OBLIQUE_STEPS;
    }
    var half = (span - 1) / 2;

    var out = new Float32Array(width * height);
    var isMip = mode === MODES.mip;
    var isMinip = mode === MODES.minip;
    if (isMip) out.fill(-Infinity);
    else if (isMinip) out.fill(Infinity);

    var sx = volume.spacingX, sy = volume.spacingY, sz = volume.spacingZ;
    var o = 0;

    for (var j = 0; j < height; j++) {
      var jf = j - height / 2 + 0.5;
      for (var i = 0; i < width; i++) {
        var iff = i - width / 2 + 0.5;

        // Base position for this output pixel, in millimetres.
        var bx = centerMm[0] + axisU[0] * iff * pixelMm + axisV[0] * jf * pixelMm;
        var by = centerMm[1] + axisU[1] * iff * pixelMm + axisV[1] * jf * pixelMm;
        var bz = centerMm[2] + axisU[2] * iff * pixelMm + axisV[2] * jf * pixelMm;

        var acc = 0, n = 0;
        for (var k = 0; k < span; k++) {
          var off = (k - half) * pitch;
          var px = (bx + normal[0] * off) / sx;
          var py = (by + normal[1] * off) / sy;
          var pz = (bz + normal[2] * off) / sz;

          var v = sampleTrilinear(volume, px, py, pz, mask);
          if (v === null) continue;
          if (isMip) { if (v > out[o]) out[o] = v; }
          else if (isMinip) { if (v < out[o]) out[o] = v; }
          else { acc += v; n++; }
        }

        if (mode === MODES.average) out[o] = n ? acc / n : AIR_HU;
        o++;
      }
    }

    if (isMip || isMinip) {
      for (var q = 0; q < out.length; q++) if (!isFinite(out[q])) out[q] = AIR_HU;
    }

    return {
      data: out,
      width: width,
      height: height,
      spacingX: pixelMm,
      spacingY: pixelMm,
      samples: span,
      oblique: true,
      pixelMm: pixelMm,
      center: centerMm.slice(),
      axisU: axisU.slice(),
      axisV: axisV.slice(),
      normal: normal,
    };
  }

  /** Output size that comfortably covers the volume's diagonal. */
  function defaultObliqueSize(volume, pixelMm) {
    var ex = volume.cols * volume.spacingX;
    var ey = volume.rows * volume.spacingY;
    var ez = volume.depth * volume.spacingZ;
    var diag = Math.sqrt(ex * ex + ey * ey + ez * ez);
    // Cap the cost of an oblique reslice; 640 is plenty for on-screen review.
    return Math.min(640, Math.max(64, Math.round(diag / pixelMm)));
  }

  /**
   * Trilinear sample in voxel coordinates. Returns null outside the volume so
   * the caller can distinguish "no data" from a genuine air reading.
   */
  function sampleTrilinear(volume, x, y, z, mask) {
    var cols = volume.cols, rows = volume.rows, depth = volume.depth;
    if (x < 0 || y < 0 || z < 0 || x > cols - 1 || y > rows - 1 || z > depth - 1) return null;

    var x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
    var x1 = x0 + 1 > cols - 1 ? x0 : x0 + 1;
    var y1 = y0 + 1 > rows - 1 ? y0 : y0 + 1;
    var z1 = z0 + 1 > depth - 1 ? z0 : z0 + 1;

    var fx = x - x0, fy = y - y0, fz = z - z0;
    var data = volume.data;
    var sliceStride = cols * rows;

    function at(xi, yi, zi) {
      var idx = zi * sliceStride + yi * cols + xi;
      return mask && mask[idx] ? AIR_HU : data[idx];
    }

    var c000 = at(x0, y0, z0), c100 = at(x1, y0, z0);
    var c010 = at(x0, y1, z0), c110 = at(x1, y1, z0);
    var c001 = at(x0, y0, z1), c101 = at(x1, y0, z1);
    var c011 = at(x0, y1, z1), c111 = at(x1, y1, z1);

    var c00 = c000 + (c100 - c000) * fx;
    var c10 = c010 + (c110 - c010) * fx;
    var c01 = c001 + (c101 - c001) * fx;
    var c11 = c011 + (c111 - c011) * fx;

    var c0 = c00 + (c10 - c00) * fy;
    var c1 = c01 + (c11 - c01) * fy;

    return c0 + (c1 - c0) * fz;
  }

  /* ---------------------------------------------------------------------
   * Small vector helpers
   * ------------------------------------------------------------------- */
  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  }

  function normalize(v) {
    var len = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
  }

  /** Rotate vector `v` about unit axis `axis` by `angle` radians (Rodrigues). */
  function rotateAbout(v, axis, angle) {
    var c = Math.cos(angle), s = Math.sin(angle);
    var k = normalize(axis);
    var dot = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
    var cr = cross(k, v);
    return [
      v[0] * c + cr[0] * s + k[0] * dot * (1 - c),
      v[1] * c + cr[1] * s + k[1] * dot * (1 - c),
      v[2] * c + cr[2] * s + k[2] * dot * (1 - c),
    ];
  }

  /**
   * Re-orthonormalise a plane frame. Repeated incremental rotations
   * accumulate floating-point drift, which would slowly shear the reslice;
   * snapping the frame back after every rotation keeps it rigid.
   *
   * @param {Object} frame  { u, v, n } — n is the index-increasing normal
   */
  function orthonormalize(frame) {
    var u = normalize(frame.u);
    var v = frame.v;
    // Gram-Schmidt v against u, then rebuild n from the sign it started with.
    var d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    v = normalize([v[0] - u[0] * d, v[1] - u[1] * d, v[2] - u[2] * d]);
    var c = cross(u, v);
    var n = frame.n;
    var sign = c[0] * n[0] + c[1] * n[1] + c[2] * n[2] < 0 ? -1 : 1;
    return { u: u, v: v, n: [c[0] * sign, c[1] * sign, c[2] * sign] };
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
    extractOblique: extractOblique,
    defaultObliqueSize: defaultObliqueSize,
    sampleTrilinear: sampleTrilinear,
    cross: cross,
    normalize: normalize,
    rotateAbout: rotateAbout,
    orthonormalize: orthonormalize,
    computeBoneMask: computeBoneMask,
    packTexture: packTexture,
    estimateSliceSpacing: estimateSliceSpacing,
  };
})(typeof window !== "undefined" ? window : globalThis);
