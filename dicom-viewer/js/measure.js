/* ==========================================================================
   CT Console — measurement and annotation engine.

   Probe, distance, polyline, angle, Cobb angle, circular / elliptical /
   rectangular / polygonal / freehand ROIs, plus arrow, text and freehand
   annotations.

   Three rules from the base plan drive the design here:

     · Statistics are computed from the *pixel values* of the plane being
       measured, never from the rendered/windowed screenshot. Window/level,
       inversion and colour maps therefore cannot change a reported number.

     · Physical units are only reported when the source metadata supports
       them. Without usable Pixel Spacing a measurement reports pixels and
       says it is uncalibrated, rather than inventing millimetres.

     · Annotations are *not* measurements. An arrow or a caption carries no
       number, and must never be listed as though it had measured something.

   Measurements are stored in *plane coordinates* (fractional column/row of
   the extracted plane), so they stay anchored to the anatomy through zoom,
   pan, rotation and flipping — the view transform is applied at draw time.
   ========================================================================== */
(function (global) {
  "use strict";

  var TOOLS = {
    none: "none",
    point: "point",              // single-pixel value probe
    distance: "distance",
    polyline: "polyline",        // summed segment length
    angle: "angle",
    cobb: "cobb",                // angle between two independent lines
    ellipse: "ellipse",
    circle: "circle",            // centre + edge, isotropic in millimetres
    rect: "rect",
    polygon: "polygon",          // click-by-click closed region
    freehandRoi: "freehandRoi",  // traced closed region
    arrow: "arrow",              // annotation
    text: "text",                // annotation
    freehand: "freehand",        // annotation
    sculpt: "sculpt",            // not a measurement; here so the UI can share one group
  };

  /**
   * One table describing every tool, so the UI, the hit-tester, the drawing
   * code and the report all agree on what a tool is without repeating the
   * knowledge. `points` is how many clicks complete it; `variable` tools are
   * finished explicitly, and `trace` tools are drawn by dragging.
   */
  var TOOL_INFO = {
    none:        { label: "Navigate",       glyph: "✥", points: 0 },
    point:       { label: "Probe",          glyph: "⌖", points: 1, intensity: true },
    distance:    { label: "Distance",       glyph: "↔", points: 2 },
    polyline:    { label: "Polyline",       glyph: "⌇", points: 0, variable: true, min: 2 },
    angle:       { label: "Angle",          glyph: "∠", points: 3 },
    cobb:        { label: "Cobb angle",     glyph: "⋀", points: 4 },
    ellipse:     { label: "Ellipse ROI",    glyph: "◯", points: 2, intensity: true, roi: true },
    circle:      { label: "Circle ROI",     glyph: "⊙", points: 2, intensity: true, roi: true },
    rect:        { label: "Rectangle ROI",  glyph: "▭", points: 2, intensity: true, roi: true },
    polygon:     { label: "Polygon ROI",    glyph: "⬠", points: 0, variable: true, min: 3,
                   intensity: true, roi: true },
    freehandRoi: { label: "Freehand ROI",   glyph: "✺", points: 0, trace: true, min: 3,
                   intensity: true, roi: true },
    arrow:       { label: "Arrow",          glyph: "↗", points: 2, annotation: true },
    text:        { label: "Text",           glyph: "T", points: 1, annotation: true, wantsText: true },
    freehand:    { label: "Draw",           glyph: "✎", points: 0, trace: true, min: 2,
                   annotation: true },
    sculpt:      { label: "Sculpt",         glyph: "✂", points: 0 },
  };

  function info(tool) { return TOOL_INFO[tool] || TOOL_INFO.none; }

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

  /** Summed length of an open or closed path, in physical units. */
  function pathLength(pts, cal, closed) {
    var total = 0;
    for (var i = 1; i < pts.length; i++) total += distanceBetween(pts[i - 1], pts[i], cal);
    if (closed && pts.length > 2) total += distanceBetween(pts[pts.length - 1], pts[0], cal);
    return total;
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

  /**
   * Angle between two independent lines p0-p1 and p2-p3, in degrees.
   *
   * This is the Cobb convention: the lines are drawn along two endplates and
   * the reported angle is the one between them, which is the same as the
   * angle between their perpendiculars. Lines have no direction, so the
   * result is folded into 0-90° — drawing an endplate "backwards" cannot
   * turn a 20° curve into a 160° one.
   */
  function cobbAngle(pts, cal) {
    if (pts.length < 4) return NaN;
    var ax = (pts[1].x - pts[0].x) * cal.spacingX, ay = (pts[1].y - pts[0].y) * cal.spacingY;
    var bx = (pts[3].x - pts[2].x) * cal.spacingX, by = (pts[3].y - pts[2].y) * cal.spacingY;
    var la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) return NaN;
    var cos = Math.abs((ax * bx + ay * by) / (la * lb));
    cos = Math.min(1, cos);
    return (Math.acos(cos) * 180) / Math.PI;
  }

  /** Shoelace area of a closed polygon, in physical units. */
  function polygonArea(pts, cal) {
    if (pts.length < 3) return 0;
    var sum = 0;
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      sum += (a.x * cal.spacingX) * (b.y * cal.spacingY) -
             (b.x * cal.spacingX) * (a.y * cal.spacingY);
    }
    return Math.abs(sum) / 2;
  }

  /** Even-odd ray cast. `x`, `y` are plane coordinates (pixel centres). */
  function pointInPolygon(pts, x, y) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function centroid(pts) {
    var sx = 0, sy = 0;
    pts.forEach(function (p) { sx += p.x; sy += p.y; });
    return { x: sx / pts.length, y: sy / pts.length };
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
   * ROI regions
   *
   * Every ROI shape reduces to a bounding box plus a predicate, so the
   * statistics, the pixel count and the histogram all sample exactly the
   * same pixels. A shape that changes its own maths is a shape whose mean
   * and whose histogram can disagree.
   * ------------------------------------------------------------------- */

  /**
   * Pixels whose *centre* falls inside [lx, hx] x [ly, hy].
   *
   * One rule for every ROI. The alternative — counting any pixel the shape
   * touches — is defensible on its own, but mixing the two is not: a
   * rectangle and a polygon drawn over the same square would then enclose
   * different numbers of pixels and report different means, and neither
   * number would be wrong enough to notice.
   */
  function clampBox(slab, lx, hx, ly, hy) {
    var x0 = Math.max(0, Math.ceil(lx - 0.5));
    var x1 = Math.min(slab.width - 1, Math.floor(hx - 0.5));
    var y0 = Math.max(0, Math.ceil(ly - 0.5));
    var y1 = Math.min(slab.height - 1, Math.floor(hy - 0.5));
    if (x1 < x0 || y1 < y0) return null;
    return { x0: x0, x1: x1, y0: y0, y1: y1 };
  }

  /**
   * Bounding box and inside-test for an ROI measurement.
   * Returns null when the shape is too small or falls outside the plane.
   */
  function regionOf(measurement, slab, cal) {
    var pts = measurement.points;
    var tool = measurement.tool;

    if (tool === TOOLS.rect && pts.length >= 2) {
      var lx = Math.min(pts[0].x, pts[1].x), hx = Math.max(pts[0].x, pts[1].x);
      var ly = Math.min(pts[0].y, pts[1].y), hy = Math.max(pts[0].y, pts[1].y);
      if (hx - lx < 1 || hy - ly < 1) return null;
      var box = clampBox(slab, lx, hx, ly, hy);
      if (!box) return null;
      box.inside = null;                                  // the whole box counts
      box.area = (hx - lx) * cal.spacingX * (hy - ly) * cal.spacingY;
      box.perimeter = 2 * ((hx - lx) * cal.spacingX + (hy - ly) * cal.spacingY);
      box.width = (hx - lx) * cal.spacingX;
      box.height = (hy - ly) * cal.spacingY;
      return box;
    }

    if ((tool === TOOLS.ellipse || tool === TOOLS.circle) && pts.length >= 2) {
      var e = ellipseRadii(measurement, cal);
      if (!e || e.rx < 0.5 || e.ry < 0.5) return null;
      var eb = clampBox(slab, e.cx - e.rx, e.cx + e.rx, e.cy - e.ry, e.cy + e.ry);
      if (!eb) return null;
      eb.inside = function (x, y) {
        var nx = (x + 0.5 - e.cx) / e.rx, ny = (y + 0.5 - e.cy) / e.ry;
        return nx * nx + ny * ny <= 1;                    // pixel centre inside
      };
      var a = e.rx * cal.spacingX, b = e.ry * cal.spacingY;
      eb.area = Math.PI * a * b;
      // Ramanujan's approximation; exact for a circle, <1e-5 relative error
      // for the eccentricities an ROI realistically reaches.
      var h = Math.pow(a - b, 2) / Math.pow(a + b, 2);
      eb.perimeter = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
      eb.radiusX = a;
      eb.radiusY = b;
      return eb;
    }

    if ((tool === TOOLS.polygon || tool === TOOLS.freehandRoi) && pts.length >= 3) {
      var lo = { x: Infinity, y: Infinity }, hi = { x: -Infinity, y: -Infinity };
      pts.forEach(function (p) {
        lo.x = Math.min(lo.x, p.x); hi.x = Math.max(hi.x, p.x);
        lo.y = Math.min(lo.y, p.y); hi.y = Math.max(hi.y, p.y);
      });
      var pb = clampBox(slab, lo.x, hi.x, lo.y, hi.y);
      if (!pb) return null;
      pb.inside = function (x, y) { return pointInPolygon(pts, x + 0.5, y + 0.5); };
      pb.area = polygonArea(pts, cal);
      pb.perimeter = pathLength(pts, cal, true);
      return pb;
    }

    return null;
  }

  /**
   * Centre and radii of a circle or ellipse in plane coordinates.
   *
   * An ellipse is given by two corners of its bounding box. A circle is
   * given by its centre and a point on its edge, and is circular in
   * *millimetres* — so on an anisotropic plane it is drawn as an ellipse in
   * pixels, which is the only way its radius can mean one number.
   */
  function ellipseRadii(measurement, cal) {
    var pts = measurement.points;
    if (pts.length < 2) return null;
    if (measurement.tool === TOOLS.circle) {
      var r = distanceBetween(pts[0], pts[1], cal);          // physical radius
      return {
        cx: pts[0].x, cy: pts[0].y,
        rx: r / cal.spacingX, ry: r / cal.spacingY,
        radiusMm: r,
      };
    }
    return {
      cx: (pts[0].x + pts[1].x) / 2,
      cy: (pts[0].y + pts[1].y) / 2,
      rx: Math.abs(pts[1].x - pts[0].x) / 2,
      ry: Math.abs(pts[1].y - pts[0].y) / 2,
    };
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

  /** Statistics for any ROI measurement, or null when it has no area. */
  function regionStats(measurement, slab, cal) {
    var r = regionOf(measurement, slab, cal);
    if (!r) return null;
    var s = accumulate(slab, r.x0, r.x1, r.y0, r.y1, r.inside);
    if (!s) return null;
    s.area = r.area;
    s.perimeter = r.perimeter;
    if (r.radiusX !== undefined) { s.radiusX = r.radiusX; s.radiusY = r.radiusY; }
    if (r.width !== undefined) { s.width = r.width; s.height = r.height; }
    return s;
  }

  /**
   * Distribution of the values inside an ROI.
   *
   * Walks exactly the pixels regionStats() counted, so the histogram's total
   * always equals the reported n. Bin edges span the ROI's own min..max: a
   * fixed -1024..3071 axis would render most soft-tissue ROIs as one spike.
   */
  function histogramOf(measurement, slab, cal, binCount) {
    var r = regionOf(measurement, slab, cal);
    if (!r) return null;
    var s = accumulate(slab, r.x0, r.x1, r.y0, r.y1, r.inside);
    if (!s) return null;

    var bins = Math.max(4, binCount || 48);
    var lo = s.min, hi = s.max;
    if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }           // a uniform ROI
    var counts = new Uint32Array(bins);
    var scale = bins / (hi - lo);

    for (var y = r.y0; y <= r.y1; y++) {
      for (var x = r.x0; x <= r.x1; x++) {
        if (r.inside && !r.inside(x, y)) continue;
        var b = Math.floor((slab.data[y * slab.width + x] - lo) * scale);
        if (b >= bins) b = bins - 1;                        // the maximum itself
        if (b < 0) b = 0;
        counts[b]++;
      }
    }

    var peak = 0;
    for (var i = 0; i < bins; i++) if (counts[i] > peak) peak = counts[i];
    return { counts: counts, min: lo, max: hi, peak: peak, total: s.count, stats: s };
  }

  /** Kept for callers that want one shape directly. */
  function ellipseStats(slab, p0, p1, cal) {
    return regionStats({ tool: TOOLS.ellipse, points: [p0, p1] }, slab, cal);
  }
  function rectStats(slab, p0, p1, cal) {
    return regionStats({ tool: TOOLS.rect, points: [p0, p1] }, slab, cal);
  }

  /* ---------------------------------------------------------------------
   * Measurement records
   * ------------------------------------------------------------------- */

  var nextId = 1;

  function createMeasurement(tool, plane, sliceIndex, points, extra) {
    var m = {
      id: nextId++,
      tool: tool,
      plane: plane,
      sliceIndex: sliceIndex,
      seriesUid: null,          // set by the caller; keeps ROIs off other series
      hidden: false,
      text: "",
      created: new Date().toISOString(),
      points: points.map(function (p) { return { x: p.x, y: p.y }; }),
    };
    if (extra) Object.keys(extra).forEach(function (k) { m[k] = extra[k]; });
    return m;
  }

  /** Re-seed the id counter after restoring saved measurements. */
  function seedIds(list) {
    list.forEach(function (m) { if (m.id >= nextId) nextId = m.id + 1; });
  }

  /**
   * Recompute a measurement's result against the plane it belongs to.
   * Returns a display-ready record; never mutates the measurement.
   */
  function evaluate(measurement, slab, cal) {
    var pts = measurement.points;
    var tool = measurement.tool;
    var meta = info(tool);

    if (meta.annotation) {
      return {
        primary: measurement.text || meta.label,
        detail: null,
        raw: null,
        annotation: true,
      };
    }

    if (tool === TOOLS.distance && pts.length >= 2) {
      var d = distanceBetween(pts[0], pts[1], cal);
      return {
        primary: formatValue(d, cal.unit),
        detail: cal.calibrated ? null : "uncalibrated",
        raw: { distance: d },
      };
    }

    if (tool === TOOLS.polyline && pts.length >= 2) {
      var pl = pathLength(pts, cal, false);
      return {
        primary: formatValue(pl, cal.unit),
        detail: (pts.length - 1) + " segment" + (pts.length === 2 ? "" : "s") +
          (cal.calibrated ? "" : " · uncalibrated"),
        raw: { distance: pl, segments: pts.length - 1 },
      };
    }

    if (tool === TOOLS.angle && pts.length >= 3) {
      var a = angleAt(pts[0], pts[1], pts[2], cal);
      return { primary: isNaN(a) ? "—" : a.toFixed(1) + "°", detail: null, raw: { angle: a } };
    }

    if (tool === TOOLS.cobb && pts.length >= 4) {
      var cb = cobbAngle(pts, cal);
      return {
        primary: isNaN(cb) ? "—" : cb.toFixed(1) + "°",
        detail: "between the two drawn lines",
        raw: { angle: cb },
      };
    }

    if (tool === TOOLS.point && pts.length >= 1) {
      var pv = pointValue(slab, pts[0]);
      if (!pv) return { primary: "—", detail: null, raw: null };
      return {
        primary: formatIntensity(pv.value),
        detail: "pixel " + pv.x + ", " + pv.y,
        raw: pv,
      };
    }

    if (meta.roi) {
      var s = regionStats(measurement, slab, cal);
      if (!s) return { primary: "—", detail: null, raw: null };
      var areaUnit = cal.calibrated ? "mm²" : "px²";
      var areaValue = cal.calibrated ? s.area : s.count;
      var detail =
        "min " + Math.round(s.min) + " · max " + Math.round(s.max) +
        " · " + formatNumber(areaValue) + " " + areaUnit +
        " · n=" + s.count;
      if (cal.calibrated && isFinite(s.perimeter)) {
        detail += " · perim " + formatNumber(s.perimeter) + " mm";
      }
      return {
        primary: s.mean.toFixed(1) + " ± " + s.stdDev.toFixed(1),
        detail: detail,
        raw: s,
      };
    }

    return { primary: "—", detail: null, raw: null };
  }

  function formatValue(v, unit) {
    if (!isFinite(v)) return "—";
    return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + " " + unit;
  }

  /**
   * Intensities, not areas: a stored value is usually an integer, and
   * formatNumber's "one decimal below 100" rule turns -1000 into "-1000.0",
   * implying a precision the sample does not have.
   */
  function formatIntensity(v) {
    if (!isFinite(v)) return "—";
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }

  function formatNumber(v) {
    if (!isFinite(v)) return "—";
    return v >= 100 ? Math.round(v).toString() : v.toFixed(1);
  }

  /** How many points a fixed-shape tool needs before it is complete. */
  function pointsNeeded(tool) { return info(tool).points || 0; }

  /** True when a tool collects points until the user says stop. */
  function isVariable(tool) { return !!info(tool).variable; }

  /** True when a tool is drawn by dragging rather than clicking. */
  function isTrace(tool) { return !!info(tool).trace; }

  /** Fewest points a variable or traced tool needs to be worth keeping. */
  function minPoints(tool) { return info(tool).min || info(tool).points || 0; }

  /** True when a tool reports intensities rather than geometry. */
  function reportsIntensity(tool) { return !!info(tool).intensity; }

  /** True when a tool encloses an area whose pixels can be summarised. */
  function isRoi(tool) { return !!info(tool).roi; }

  /** True when a tool draws a mark but measures nothing. */
  function isAnnotation(tool) { return !!info(tool).annotation; }

  /** True when a tool needs a caption typed before it means anything. */
  function wantsText(tool) { return !!info(tool).wantsText; }

  function glyph(tool) { return info(tool).glyph; }
  function label(tool) { return info(tool).label; }

  /**
   * Shift every point of a measurement. Used when the whole object is
   * dragged, so the shape is preserved exactly and only its position moves.
   */
  function translate(measurement, dx, dy) {
    measurement.points.forEach(function (p) { p.x += dx; p.y += dy; });
  }


  /* ---------------------------------------------------------------------
   * Persistence
   *
   * Measurements are saved per *series*, not per study: a ROI drawn on the
   * arterial phase means nothing on the venous one, and an ROI is anchored
   * to a slice index that only its own series numbers the same way.
   *
   * Storage is this browser's localStorage, so saved measurements stay on
   * this device and are readable by anyone with access to this browser
   * profile. The UI says so; this module does not pretend otherwise.
   * ------------------------------------------------------------------- */

  var STORE_PREFIX = "ctconsole.measure.";

  function storeKey(seriesUid) { return STORE_PREFIX + seriesUid; }

  /** Strip a record down to what is worth saving, and can be trusted back. */
  function serialise(m) {
    return {
      id: m.id,
      tool: m.tool,
      plane: m.plane,
      sliceIndex: m.sliceIndex,
      seriesUid: m.seriesUid || null,
      hidden: !!m.hidden,
      text: m.text || "",
      created: m.created || null,
      points: m.points.map(function (p) { return { x: p.x, y: p.y }; }),
    };
  }

  /** Save every measurement belonging to one series. */
  function saveFor(seriesUid, all) {
    if (!seriesUid) return false;
    var mine = (all || []).filter(function (m) { return m.seriesUid === seriesUid; });
    try {
      if (!mine.length) { global.localStorage.removeItem(storeKey(seriesUid)); return true; }
      global.localStorage.setItem(storeKey(seriesUid),
        JSON.stringify({ version: 1, saved: new Date().toISOString(),
                         items: mine.map(serialise) }));
      return true;
    } catch (err) {
      return false;                       // private mode, quota, blocked store
    }
  }

  /**
   * Read one series' saved measurements.
   *
   * Anything that does not look like a measurement this build understands is
   * dropped rather than half-restored: a record with an unknown tool or no
   * points would otherwise draw nothing and still occupy the list.
   */
  function loadFor(seriesUid) {
    if (!seriesUid) return [];
    var raw;
    try { raw = global.localStorage.getItem(storeKey(seriesUid)); }
    catch (err) { return []; }
    if (!raw) return [];
    var parsed;
    try { parsed = JSON.parse(raw); } catch (err) { return []; }
    if (!parsed || !Array.isArray(parsed.items)) return [];

    var out = [];
    parsed.items.forEach(function (r) {
      if (!r || !TOOL_INFO[r.tool] || !Array.isArray(r.points) || !r.points.length) return;
      var pts = [];
      for (var i = 0; i < r.points.length; i++) {
        var p = r.points[i];
        if (!p || !isFinite(p.x) || !isFinite(p.y)) return;
        pts.push({ x: p.x, y: p.y });
      }
      if (pts.length < minPoints(r.tool)) return;
      out.push({
        id: typeof r.id === "number" ? r.id : nextId++,
        tool: r.tool,
        plane: r.plane,
        sliceIndex: r.sliceIndex,
        seriesUid: seriesUid,
        hidden: !!r.hidden,
        text: typeof r.text === "string" ? r.text : "",
        created: r.created || null,
        points: pts,
      });
    });
    seedIds(out);
    return out;
  }

  function removeFor(seriesUid) {
    try { global.localStorage.removeItem(storeKey(seriesUid)); return true; }
    catch (err) { return false; }
  }

  /** Series UIDs that have saved measurements. */
  function storedSeries() {
    var out = [];
    try {
      for (var i = 0; i < global.localStorage.length; i++) {
        var k = global.localStorage.key(i);
        if (k && k.indexOf(STORE_PREFIX) === 0) out.push(k.slice(STORE_PREFIX.length));
      }
    } catch (err) { /* storage unavailable */ }
    return out;
  }

  global.CTMeasure = {
    TOOLS: TOOLS,
    TOOL_INFO: TOOL_INFO,
    info: info,
    calibrationOf: calibrationOf,
    distanceBetween: distanceBetween,
    pathLength: pathLength,
    angleAt: angleAt,
    cobbAngle: cobbAngle,
    polygonArea: polygonArea,
    pointInPolygon: pointInPolygon,
    centroid: centroid,
    ellipseRadii: ellipseRadii,
    regionOf: regionOf,
    regionStats: regionStats,
    histogramOf: histogramOf,
    ellipseStats: ellipseStats,
    rectStats: rectStats,
    pointValue: pointValue,
    reportsIntensity: reportsIntensity,
    isRoi: isRoi,
    isAnnotation: isAnnotation,
    isVariable: isVariable,
    isTrace: isTrace,
    wantsText: wantsText,
    minPoints: minPoints,
    glyph: glyph,
    label: label,
    translate: translate,
    createMeasurement: createMeasurement,
    seedIds: seedIds,
    saveFor: saveFor,
    loadFor: loadFor,
    removeFor: removeFor,
    storedSeries: storedSeries,
    evaluate: evaluate,
    pointsNeeded: pointsNeeded,
    formatValue: formatValue,
    formatIntensity: formatIntensity,
    formatNumber: formatNumber,
  };
})(typeof window !== "undefined" ? window : globalThis);
