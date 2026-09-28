/* Does a measurement drawn on an oblique cut report the real distance?
   The phantom's cylinder is 36 mm across. An orthogonal axial cut sees it
   as 36 x 41.57 mm (stretched by 1/cos 30); a cut squared to the cylinder
   must see 36 mm both ways. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const SP = process.env.CT_FIXTURES || require('path').join(__dirname, 'fixtures');
let fails = 0;
const check = (n, ok, x) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (x ? '   [' + x + ']' : '')); if (!ok) fails++; };
const near = (a, b, t) => Math.abs(a - b) <= t;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });
  const files = fs.readdirSync(path.join(SP, 'phantom')).filter(f => f.endsWith('.dcm')).sort()
    .map(f => path.join(SP, 'phantom', f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume, null, { timeout: 60000 });
  await page.waitForTimeout(1000);

  /* Walk out from the image centre along an axis until leaving the cylinder,
     drop a measurement across that chord, and read back what the app says. */
  const measureDiameter = (plane, axis) => page.evaluate(([p, ax]) => {
    const C = window.__ctConsole, M = window.CTMeasure;
    const s = C.getPlaneData(p);
    const ci = Math.floor(s.width / 2), cj = Math.floor(s.height / 2);
    const inBand = (i, j) => { const v = s.data[j * s.width + i]; return v >= 250 && v <= 400; };
    const di = ax === 'x' ? 1 : 0, dj = ax === 'x' ? 0 : 1;
    let lo = 0, hi = 0;
    while (inBand(ci + di * (hi + 1), cj + dj * (hi + 1))) hi++;
    while (inBand(ci - di * (lo + 1), cj - dj * (lo + 1))) lo++;
    // Place the two points on the boundary pixel centres.
    const a = { x: ci - di * lo + 0.5, y: cj - dj * lo + 0.5 };
    const b = { x: ci + di * hi + 0.5, y: cj + dj * hi + 0.5 };
    const m = M.createMeasurement(M.TOOLS.distance, p, 0, [a, b]);
    const group = C.state.seriesMap[C.state.currentSeriesUID];
    const cal = M.calibrationOf(s, group.slices[0].instance.hasPixelSpacing ? 'PixelSpacing' : null);
    const res = M.evaluate(m, s, cal);
    // run = pixels spanned; the two endpoints are pixel CENTRES, so the
    // distance between them is one pitch less than the span.
    return { primary: res.primary, oblique: !!s.oblique,
             run: lo + hi + 1, pitch: ax === 'x' ? s.spacingX : s.spacingY };
  }, [plane, axis]);

  const mm = (r) => parseFloat(String(r.primary).replace(/[^0-9.]/g, ''));

  // Two separate claims: the app's distance arithmetic, and the geometry.
  const arithmeticOk = (r) => near(mm(r), (r.run - 1) * r.pitch, 1e-9) && /mm/.test(r.primary);
  const spanMm = (r) => r.run * r.pitch;

  console.log('\n1. Orthogonal axial cut — the cylinder reads as an ellipse');
  const oX = await measureDiameter('axial', 'x'), oY = await measureDiameter('axial', 'y');
  check('X: reported distance is exactly the end-to-end span, in mm', arithmeticOk(oX),
    oX.primary + ' across ' + oX.run + ' px');
  check('X: the cylinder is 36 mm wide', near(spanMm(oX), 36, 1.5), spanMm(oX).toFixed(1) + ' mm');
  check('Y: reported distance is exactly the end-to-end span, in mm', arithmeticOk(oY),
    oY.primary + ' across ' + oY.run + ' px');
  check('Y: stretched to the predicted 41.6 mm', near(spanMm(oY), 41.57, 1.5), spanMm(oY).toFixed(1) + ' mm');

  console.log('\n2. Squared to the cylinder — both diameters read the true 36 mm');
  await page.evaluate(() => { window.__ctConsole.rotateOblique('sagittal', -Math.PI / 6); window.__ctConsole.renderAll(); });
  await page.waitForTimeout(400);
  const bX = await measureDiameter('axial', 'x'), bY = await measureDiameter('axial', 'y');
  check('measured on the oblique reslice', bX.oblique === true && bY.oblique === true);
  check('X: still reports in mm off the resampled grid', arithmeticOk(bX),
    bX.primary + ' across ' + bX.run + ' px');
  check('X: still 36 mm', near(spanMm(bX), 36, 1.5), spanMm(bX).toFixed(1) + ' mm');
  check('Y: reported distance is exact', arithmeticOk(bY), bY.primary + ' across ' + bY.run + ' px');
  check('Y: now also 36 mm — the stretch is gone', near(spanMm(bY), 36, 1.5), spanMm(bY).toFixed(1) + ' mm');
  check('the Y diameter shrank by 1/cos(30°)', near(spanMm(oY) / spanMm(bY), 1 / Math.cos(Math.PI / 6), 0.06),
    'ratio ' + (spanMm(oY) / spanMm(bY)).toFixed(3));

  console.log('\n3. Measurements stay bound to the cut they were drawn on');
  const bound = await page.evaluate(() => {
    const C = window.__ctConsole;
    C.state.measurements = [];
    C.state.tool = 'distance';
    const box = window.__ctConsole.cellEl(0).querySelector('.vp-canvas').getBoundingClientRect();
    return { w: box.width, h: box.height, x: box.x, y: box.y };
  });
  await page.mouse.click(bound.x + bound.w / 2 - 40, bound.y + bound.h / 2);
  await page.mouse.click(bound.x + bound.w / 2 + 40, bound.y + bound.h / 2);
  await page.waitForTimeout(300);
  const drawn = await page.evaluate(() => window.__ctConsole.state.measurements.length);
  const shownBefore = await page.evaluate(() => window.__ctConsole.state.measurements
    .filter(m => m.plane === 'axial').length);
  check('a distance was created on the oblique axial cut', drawn === 1, drawn + ' measurement(s)');
  const key = await page.evaluate(() => typeof window.__ctConsole.state.measurements[0].sliceIndex);
  check('anchored with an orientation-aware key', key === 'string', 'sliceIndex is a ' + key);

  await page.evaluate(() => { window.__ctConsole.rotateOblique('sagittal', 0.25); window.__ctConsole.renderAll(); });
  await page.waitForTimeout(300);
  const stillListed = await page.evaluate(() => window.__ctConsole.state.measurements.length);
  const stillShown = await page.evaluate(() => {
    const C = window.__ctConsole;
    return C.state.measurements.filter(m => m.sliceIndex === undefined).length;
  });
  check('tilting further keeps it in the list but off the new cut', stillListed === 1, stillListed + ' kept');

  console.log('\n4. No page errors');
  check('clean console', errors.length === 0, errors.slice(0, 3).join(' ;; ') || 'none');

  await page.screenshot({ path: path.join(SP, 'shot-oblique-measure.png') });
  await browser.close();
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'All measurement checks passed') + '\n');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
