/* ==========================================================================
   CT Console — measurement engine.

   Point (HU probe), distance, angle, and elliptical and rectangular ROI
   measurements.

   Two rules from the base plan drive the design here:

     · Statistics are computed from the *pixel values* of the plane being
       measured, never from the rendered/windowed screenshot. Window/level
       and invert therefore cannot change a reported number.

     · Physical units are only reported when the source metadata supports
       them. Without usable Pixel Spacing a measurement reports pixels and
       says it is uncalibrated, rather than inventing millimetres.

   Measurements are stored in *plane coordinates* (fractional column/row of
   the extracted plane), so they stay anchored to the anatomy through zoom,
   pan, rotation and flipping — the view transform is applied at draw time.
   ========================================================================== */
(function (global) {
  "use strict";

  var TOOLS = {
    none: "none",
    point: "point",          // single-pixel value probe
    distance: "distance",
    angle: "angle",
    ellipse: "ellipse",
    rect: "rect",            // rectangular ROI
  };

  /* ---------------------------------------------------------------------
   * Calibration
   * ------------------------------------------------------------------- */

  /**
   * Decide whether a plane can be measured in millimetres.
   * `spacingX`/`spacingY` come from the volume, which derives them from
   * Pixel Spacing and the slice geometry.
   */
  function calibrationOf(slab, source) {
    var sx = slab.spacingX, sy = slab.spacingY;
    var usable = isFinite(sx) && isFinite(sy) && sx > 0 && sy > 0;
    return {
      calibrated: !!usable && !!source,
      spacingX: usable ? sx : 1,
      spacingY: usable ? sy : 1,
      unit: usable && source ? "mm" : "px",
      // Where the calibration came from, so the UI can be honest about it.
      provenance: !source ? "none" : usable ? source : "none",
    };
  }

  /* ---------------------------------------------------------------------
   * Geometry
   * ------------------------------------------------------------------- */

  /** Straight-line distance between two plane points, in physical units. */
  function distanceBetween(p0, p1, cal) {
    var dx = (p1.x - p0.x) * cal.spacingX;
    var dy = (p1.y - p0.y) * cal.spacingY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Angle at the vertex p1 formed by p0-p1-p2, in degrees.
   * Computed in physical space so anisotropic voxels don't skew it.
   */
  function angleAt(p0, p1, p2, cal) {
    var ax = (p0.x - p1.x) * cal.spacingX, ay = (p0.y - p1.y) * cal.spacingY;
    var bx = (p2.x - p1.x) * cal.spacingX, by = (p2.y - p1.y) * cal.spacingY;
    var la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) return NaN;
    var cos = (ax * bx + ay * by) / (la * lb);
    cos = Math.max(-1, Math.min(1, cos));
    return (Math.acos(cos) * 180) / Math.PI;
  }

  /* ---------------------------------------------------------------------
   * Point probe
   * ------------------------------------------------------------------- */

  /**
   * The stored value of the single pixel a point falls in.
   *
   * Plane coordinates put the centre of pixel i at i + 0.5, so the pixel a
   * point lands in is simply its floor. Reading one pixel rather than
   * interpolating is deliberate: an interpolated "HU" is a number the
   * scanner never measured.
   */
  function pointValue(slab, p) {
    var x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= slab.width || y >= slab.height) return null;
    return { value: slab.data[y * slab.width + x], x: x, y: y };
  }

  /* ---------------------------------------------------------------------
   * ROI statistics
   * ------------------------------------------------------------------- */

  /** Shared reducer, so every ROI shape reports the same statistics. */
  function accumulate(slab, x0, x1, y0, y1, inside) {
    var n = 0, sum = 0, sumSq = 0, min = Infinity, max = -Infinity;
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        if (inside && !inside(x, y)) continue;
        var v = slab.data[y * slab.width + x];
        n++; sum += v; sumSq += v * v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!n) return null;
    var mean = sum / n;
    return {
      count: n, mean: mean,
      // Population variance over the enclosed pixels.
      stdDev: Math.sqrt(Math.max(0, sumSq / n - mean * mean)),
      min: min, max: max,
    };
  }

  /**
   * Intensity statistics inside an axis-aligned rectangle given by two
   * opposite corners.
   */
  function rectStats(slab, p0, p1, cal) {
    var lx = Math.min(p0.x, p1.x), hx = Math.max(p0.x, p1.x);
    var ly = Math.min(p0.y, p1.y), hy = Math.max(p0.y, p1.y);
    if (hx - lx < 1 || hy - ly < 1) return null;

    var x0 = Math.max(0, Math.floor(lx));
    var x1 = Math.min(slab.width - 1, Math.ceil(hx) - 1);
    var y0 = Math.max(0, Math.floor(ly));
    var y1 = Math.min(slab.height - 1, Math.ceil(hy) - 1);
    if (x1 < x0 || y1 < y0) return null;

    var s = accumulate(slab, x0, x1, y0, y1, null);
    if (!s) return null;
    s.area = (hx - lx) * cal.spacingX * (hy - ly) * cal.spacingY;
    s.width = (hx - lx) * cal.spacingX;
    s.height = (hy - ly) * cal.spacingY;
    return s;
  }

  /**
   * Intensity statistics inside an axis-aligned ellipse defined by two
   * corner points of its bounding box.
   *
   * Samples the plane's real values (HU for CT with a Hounsfield rescale),
   * so the result is independent of how the image is displayed.
   */
  function ellipseStats(slab, p0, p1, cal) {
    var cx = (p0.x + p1.x) / 2;
    var cy = (p0.y + p1.y) / 2;
    var rx = Math.abs(p1.x - p0.x) / 2;
    var ry = Math.abs(p1.y - p0.y) / 2;
    if (rx < 0.5 || ry < 0.5) return null;

    var x0 = Math.max(0, Math.floor(cx - rx));
    var x1 = Math.min(slab.width - 1, Math.ceil(cx + rx));
    var y0 = Math.max(0, Math.floor(cy - ry));
    var y1 = Math.min(slab.height - 1, Math.ceil(cy + ry));

    var s = accumulate(slab, x0, x1, y0, y1, function (x, y) {
      var nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
      return nx * nx + ny * ny <= 1;             // pixel centre inside the ellipse
    });
    if (!s) return null;

    // Physical area of the ellipse, or pixel count when uncalibrated.
    s.area = Math.PI * rx * cal.spacingX * ry * cal.spacingY;
    s.radiusX = rx * cal.spacingX;
    s.radiusY = ry * cal.spacingY;
    return s;
  }

  /* ---------------------------------------------------------------------
   * Measurement records
   * ------------------------------------------------------------------- */

  var nextId = 1;

  function createMeasurement(tool, plane, sliceIndex, points) {
    return {
      id: nextId++,
      tool: tool,
      plane: plane,
      sliceIndex: sliceIndex,
      points: points.map(function (p) { return { x: p.x, y: p.y }; }),
    };
  }

  /**
   * Recompute a measurement's result against the plane it belongs to.
   * Returns a display-ready record; never mutates the measurement.
   */
  function evaluate(measurement, slab, cal) {
    var pts = measurement.points;
    if (measurement.tool === TOOLS.distance && pts.length >= 2) {
      var d = distanceBetween(pts[0], pts[1], cal);
      return {
        primary: formatValue(d, cal.unit),
        detail: cal.calibrated ? null : "uncalibrated",
        raw: { distance: d },
      };
    }

    if (measurement.tool === TOOLS.angle && pts.length >= 3) {
      var a = angleAt(pts[0], pts[1], pts[2], cal);
      return {
        primary: isNaN(a) ? "—" : a.toFixed(1) + "°",
        detail: null,
        raw: { angle: a },
      };
    }

    if (measurement.tool === TOOLS.point && pts.length >= 1) {
      var pv = pointValue(slab, pts[0]);
      if (!pv) return { primary: "—", detail: null, raw: null };
      return {
        primary: formatNumber(pv.value),
        detail: "pixel " + pv.x + ", " + pv.y,
        raw: pv,
      };
    }

    if ((measurement.tool === TOOLS.ellipse || measurement.tool === TOOLS.rect) &&
        pts.length >= 2) {
      var s = measurement.tool === TOOLS.rect
        ? rectStats(slab, pts[0], pts[1], cal)
        : ellipseStats(slab, pts[0], pts[1], cal);
      if (!s) return { primary: "—", detail: null, raw: null };
      var areaUnit = cal.calibrated ? "mm²" : "px²";
      var areaValue = cal.calibrated ? s.area : s.count;
      return {
        primary: s.mean.toFixed(1) + " ± " + s.stdDev.toFixed(1),
        detail:
          "min " + Math.round(s.min) + " · max " + Math.round(s.max) +
          " · " + formatNumber(areaValue) + " " + areaUnit +
          " · n=" + s.count,
        raw: s,
      };
    }

    return { primary: "—", detail: null, raw: null };
  }

  function formatValue(v, unit) {
    if (!isFinite(v)) return "—";
    return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + " " + unit;
  }

  function formatNumber(v) {
    if (!isFinite(v)) return "—";
    return v >= 100 ? Math.round(v).toString() : v.toFixed(1);
  }

  /** How many points a tool needs before it is complete. */
  function pointsNeeded(tool) {
    if (tool === TOOLS.angle) return 3;
    if (tool === TOOLS.point) return 1;
    if (tool === TOOLS.distance || tool === TOOLS.ellipse || tool === TOOLS.rect) return 2;
    return 0;
  }

  /** True when a tool reports intensities rather than geometry. */
  function reportsIntensity(tool) {
    return tool === TOOLS.point || tool === TOOLS.ellipse || tool === TOOLS.rect;
  }

  global.CTMeasure = {
    TOOLS: TOOLS,
    calibrationOf: calibrationOf,
    distanceBetween: distanceBetween,
    angleAt: angleAt,
    ellipseStats: ellipseStats,
    rectStats: rectStats,
    pointValue: pointValue,
    reportsIntensity: reportsIntensity,
    createMeasurement: createMeasurement,
    evaluate: evaluate,
    pointsNeeded: pointsNeeded,
    formatValue: formatValue,
  };
})(typeof window !== "undefined" ? window : globalThis);
