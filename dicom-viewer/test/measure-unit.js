/* Ground-truth checks for the new measurement maths. */
global.window = global;
require(require('path').join(__dirname, '..', 'js', 'measure.js'));
var M = window.CTMeasure;
var fails = 0;
function check(name, ok, extra) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (extra ? '   [' + extra + ']' : ''));
  if (!ok) fails++;
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }

/* A 64x64 plane, 0.5 mm x 2.0 mm pixels — deliberately anisotropic, because
   isotropic test data hides every spacing bug there is. */
var W = 64, H = 64, SX = 0.5, SY = 2.0;
var data = new Int16Array(W * H);
for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) data[y * W + x] = -1000;
/* A 20x20 pixel block of exactly 100 HU centred at (32,32). */
for (var y = 22; y < 42; y++) for (var x = 22; x < 42; x++) data[y * W + x] = 100;
var slab = { data: data, width: W, height: H, spacingX: SX, spacingY: SY };
var cal = M.calibrationOf(slab, 'PixelSpacing');
check('calibration is mm', cal.calibrated && cal.unit === 'mm');

/* ---- rectangle: exact area and exact statistics ---- */
var rect = M.createMeasurement(M.TOOLS.rect, 'axial', 0, [{x:22,y:22},{x:42,y:42}]);
var rs = M.regionStats(rect, slab, cal);
check('rect n = 400 pixels', rs.count === 400, 'n=' + rs.count);
check('rect mean = 100 HU', rs.mean === 100, rs.mean);
check('rect sd = 0', rs.stdDev === 0, rs.stdDev);
check('rect area = (20*0.5) x (20*2.0) = 400 mm2', near(rs.area, 400, 1e-9), rs.area);
check('rect perimeter = 2*(10+40) = 100 mm', near(rs.perimeter, 100, 1e-9), rs.perimeter);

/* ---- polygon covering the same square must agree with the rectangle ---- */
var poly = M.createMeasurement(M.TOOLS.polygon, 'axial', 0,
  [{x:22,y:22},{x:42,y:22},{x:42,y:42},{x:22,y:42}]);
var ps = M.regionStats(poly, slab, cal);
check('polygon n matches rect', ps.count === rs.count, ps.count + ' vs ' + rs.count);
check('polygon area matches rect', near(ps.area, rs.area, 1e-9), ps.area);
check('polygon perimeter matches rect', near(ps.perimeter, rs.perimeter, 1e-9), ps.perimeter);

/* Shoelace must not care which way round the vertices were clicked. */
var reversed = M.createMeasurement(M.TOOLS.polygon, 'axial', 0,
  [{x:22,y:42},{x:42,y:42},{x:42,y:22},{x:22,y:22}]);
check('polygon area is winding-independent',
  near(M.regionStats(reversed, slab, cal).area, rs.area, 1e-9));

/* ---- circle: circular in millimetres, not in pixels ---- */
var circ = M.createMeasurement(M.TOOLS.circle, 'axial', 0, [{x:32,y:32},{x:32+10/SX,y:32}]);
var e = M.ellipseRadii(circ, cal);
check('circle radius = 10 mm', near(e.radiusMm, 10, 1e-9), e.radiusMm);
check('circle rx in px = 10/0.5 = 20', near(e.rx, 20, 1e-9), e.rx);
check('circle ry in px = 10/2.0 = 5', near(e.ry, 5, 1e-9), e.ry);
var cs = M.regionStats(circ, slab, cal);
check('circle area = pi*10*10 = 314.16 mm2', near(cs.area, Math.PI * 100, 1e-6), cs.area);
check('circle perimeter = 2*pi*10 = 62.83 mm', near(cs.perimeter, 2 * Math.PI * 10, 1e-6), cs.perimeter);

/* ---- polyline: sum of calibrated segments ---- */
var pline = M.createMeasurement(M.TOOLS.polyline, 'axial', 0,
  [{x:0,y:0},{x:20,y:0},{x:20,y:10}]);           // 20*0.5 = 10 mm, then 10*2.0 = 20 mm
var plr = M.evaluate(pline, slab, cal);
check('polyline = 30.0 mm', plr.primary === '30.0 mm', plr.primary);
check('polyline says 2 segments', /2 segments/.test(plr.detail), plr.detail);

/* ---- Cobb angle: known 30 deg between two lines, in physical space ---- */
function ptAtAngle(deg, len) {   /* a point len mm from the origin at deg */
  return { x: (len * Math.cos(deg * Math.PI / 180)) / SX,
           y: (len * Math.sin(deg * Math.PI / 180)) / SY };
}
var cobb = M.createMeasurement(M.TOOLS.cobb, 'axial', 0,
  [{x:0,y:0}, ptAtAngle(10, 30), {x:0,y:0}, ptAtAngle(40, 30)]);
check('Cobb = 30.0 deg', near(M.cobbAngle(cobb.points, cal), 30, 1e-6), M.cobbAngle(cobb.points, cal));
/* Drawing one endplate backwards must not give 150 deg. */
var cobbRev = M.createMeasurement(M.TOOLS.cobb, 'axial', 0,
  [{x:0,y:0}, ptAtAngle(10, 30), ptAtAngle(40, 30), {x:0,y:0}]);
check('Cobb folds a reversed line to the same 30 deg',
  near(M.cobbAngle(cobbRev.points, cal), 30, 1e-6), M.cobbAngle(cobbRev.points, cal));

/* ---- histogram totals must equal the ROI's own n ---- */
var mixed = M.createMeasurement(M.TOOLS.rect, 'axial', 0, [{x:12,y:12},{x:52,y:52}]);
var ms = M.regionStats(mixed, slab, cal);
var h = M.histogramOf(mixed, slab, cal, 32);
var sum = 0; for (var i = 0; i < h.counts.length; i++) sum += h.counts[i];
check('histogram total equals ROI n', sum === ms.count, sum + ' vs ' + ms.count);
check('histogram spans the ROI min..max', h.min === ms.min && h.max === ms.max,
  h.min + '..' + h.max);
check('histogram has two populated bins', h.counts[0] > 0 && h.counts[31] > 0,
  h.counts[0] + ' / ' + h.counts[31]);
/* -1000 background is 1200 px, 100 HU block is 400 px. */
check('histogram low bin = background count', h.counts[0] === ms.count - 400, h.counts[0]);

/* ---- a uniform ROI must not divide by a zero range ---- */
var flat = M.createMeasurement(M.TOOLS.rect, 'axial', 0, [{x:24,y:24},{x:34,y:34}]);
var fh = M.histogramOf(flat, slab, cal, 16);
var fsum = 0; for (var i = 0; i < fh.counts.length; i++) fsum += fh.counts[i];
check('uniform ROI histogram still counts every pixel', fsum === 100, fsum);

/* ---- annotations carry no number ---- */
var arrow = M.createMeasurement(M.TOOLS.arrow, 'axial', 0, [{x:1,y:1},{x:5,y:5}]);
var ar = M.evaluate(arrow, slab, cal);
check('arrow evaluates as an annotation', ar.annotation === true && ar.raw === null);
check('arrow is not an intensity tool', !M.reportsIntensity(M.TOOLS.arrow));

/* ---- uncalibrated planes report pixels, never millimetres ---- */
var raw = M.calibrationOf(slab, null);
check('no spacing source = px', !raw.calibrated && raw.unit === 'px');
var dUncal = M.evaluate(
  M.createMeasurement(M.TOOLS.distance, 'axial', 0, [{x:0,y:0},{x:10,y:0}]), slab, raw);
check('uncalibrated distance is in px', /px$/.test(dUncal.primary), dUncal.primary);
check('uncalibrated distance says so', dUncal.detail === 'uncalibrated', dUncal.detail);

console.log(fails ? '\n' + fails + ' check(s) failed' : '\nAll measurement maths checks passed');
process.exit(fails ? 1 : 0);
