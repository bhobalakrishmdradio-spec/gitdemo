const { chromium } = require('playwright');
const UI = require('./ui');
const fs = require('fs'), path = require('path');
const SP = process.env.CT_FIXTURES || require('path').join(__dirname, 'fixtures');
const PH = path.join(SP, 'phantom');

let fails = 0;
function check(name, ok, extra) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (extra ? '   [' + extra + ']' : ''));
  if (!ok) fails++;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });

  const files = fs.readdirSync(PH).filter(f => f.endsWith('.dcm')).sort().map(f => path.join(PH, f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  // The Tools panel follows the armed tool, so pin every section before
  // reaching for a control that belongs to another context.
  await UI.showAllTools(page);

  const vol = await page.evaluate(() => {
    const v = window.__ctConsole.state.volume;
    return { cols: v.cols, rows: v.rows, depth: v.depth, sx: v.spacingX, sy: v.spacingY, sz: v.spacingZ };
  });
  console.log('\nVolume: ' + vol.cols + '×' + vol.rows + '×' + vol.depth +
              ' at ' + vol.sx + '/' + vol.sy + '/' + vol.sz + ' mm\n');

  console.log('1. Starts orthogonal');
  check('obliqueActive() is false at rest', await page.evaluate(() => window.__ctConsole.obliqueActive()) === false);
  check('no oblique badge in the axial overlay',
    !/oblique/i.test(await page.evaluate(() =>
      window.__ctConsole.cellEl(0).querySelector('.vp-tr').textContent)));

  // Area of the 300 HU cylinder in a plane, in mm^2.
  const areaOf = (plane) => page.evaluate((p) => {
    const C = window.__ctConsole;
    const s = C.getPlaneData(p);
    let count = 0;
    for (let i = 0; i < s.data.length; i++) if (s.data[i] >= 250 && s.data[i] <= 400) count++;
    // Diameter through the image centre along each output axis. Measured as
    // the contiguous run containing the centre, so the bone slab elsewhere in
    // the row (and the interpolated values along its edge) can't widen it.
    const inBand = (i, j) => {
      const v = s.data[j * s.width + i];
      return v >= 250 && v <= 400;
    };
    const ci = Math.floor(s.width / 2), cj = Math.floor(s.height / 2);
    function run(di, dj) {
      if (!inBand(ci, cj)) return 0;
      let len = 1;
      for (let k = 1; ; k++) {
        const i = ci + di * k, j = cj + dj * k;
        if (i < 0 || j < 0 || i >= s.width || j >= s.height || !inBand(i, j)) break;
        len++;
      }
      for (let k = 1; ; k++) {
        const i = ci - di * k, j = cj - dj * k;
        if (i < 0 || j < 0 || i >= s.width || j >= s.height || !inBand(i, j)) break;
        len++;
      }
      return len;
    }
    return {
      area: count * s.spacingX * s.spacingY,
      extentX: run(1, 0) * s.spacingX,
      extentY: run(0, 1) * s.spacingY,
      oblique: !!s.oblique, w: s.width, h: s.height, pitch: s.spacingX,
    };
  }, plane);

  console.log('\n2. Orthogonal axial cut of a 30-degree-tilted cylinder is an ellipse');
  const before = await areaOf('axial');
  const R = 18, circleArea = Math.PI * R * R;
  const ellipseArea = circleArea / Math.cos(Math.PI / 6);
  check('axial slab is the axis-aligned fast path', before.oblique === false);
  check('area matches the predicted ellipse ' + ellipseArea.toFixed(0) + ' mm²',
    near(before.area, ellipseArea, ellipseArea * 0.04), 'measured ' + before.area.toFixed(1) + ' mm²');
  check('diameter through the centre: 36 mm across X, stretched along Y',
    near(before.extentX, 2 * R, 2) && before.extentY > 2 * R + 3,
    'X ' + before.extentX.toFixed(1) + ' mm, Y ' + before.extentY.toFixed(1) + ' mm');

  console.log('\n3. Tilting the sagittal crosshair by -30 deg squares the axial cut to the cylinder');
  await page.evaluate(() => {
    const C = window.__ctConsole;
    C.rotateOblique('sagittal', -Math.PI / 6);
    C.renderAll();
  });
  await page.waitForTimeout(400);

  const tilts = await page.evaluate(() => ({
    axial: window.__ctConsole.tiltOf('axial'),
    coronal: window.__ctConsole.tiltOf('coronal'),
    sagittal: window.__ctConsole.tiltOf('sagittal'),
    active: window.__ctConsole.obliqueActive(),
  }));
  check('obliqueActive() is now true', tilts.active === true);
  check('axial tilted 30°', near(tilts.axial, 30, 0.01), tilts.axial.toFixed(3) + '°');
  check('coronal tilted 30°', near(tilts.coronal, 30, 0.01), tilts.coronal.toFixed(3) + '°');
  check('sagittal (the plane dragged in) unchanged', near(tilts.sagittal, 0, 1e-9), tilts.sagittal.toExponential(1) + '°');

  const after = await areaOf('axial');
  check('axial slab now takes the oblique path', after.oblique === true);
  check('area matches the true circular cross-section ' + circleArea.toFixed(0) + ' mm²',
    near(after.area, circleArea, circleArea * 0.04), 'measured ' + after.area.toFixed(1) + ' mm²');
  check('diameter through the centre is now 36 mm both ways',
    near(after.extentX, 2 * R, 2) && near(after.extentY, 2 * R, 2),
    'X ' + after.extentX.toFixed(1) + ' mm, Y ' + after.extentY.toFixed(1) + ' mm');
  check('shrank by exactly the 1/cos(30°) the geometry predicts',
    near(before.area / after.area, 1 / Math.cos(Math.PI / 6), 0.03),
    'ratio ' + (before.area / after.area).toFixed(4) + ' vs ' + (1 / Math.cos(Math.PI / 6)).toFixed(4));
  check('sagittal — the plane dragged in — keeps the fast axis-aligned path',
    (await areaOf('sagittal')).oblique === false);

  console.log('\n4. Overlay and panel report the tilt');
  check('axial overlay shows the angle',
    /oblique\s+30\.0°/i.test(await page.evaluate(() => window.__ctConsole.cellEl(0).querySelector('.vp-tr').textContent)),
    (await page.evaluate(() => window.__ctConsole.cellEl(0).querySelector('.vp-tr').textContent)).replace(/\n/g, ' | '));
  const panel = await page.textContent('#obliqueInfo');
  check('tools panel lists per-plane tilt', panel.includes('30.0') && panel.includes('Axial'),
    panel.replace(/\s+/g, ' ').trim());
  check('straighten button is enabled', await page.isEnabled('#obliqueResetBtn'));

  console.log('\n5. Crosshair geometry round-trips through millimetres');
  const rt = await page.evaluate(() => {
    const C = window.__ctConsole;
    const back = C.indicesFromWorld(C.crosshairWorld());
    const idx = C.state.index;
    // And a plane<->world round trip at an off-centre point.
    const slab = C.getPlaneData('coronal');
    const w = C.planeToWorld('coronal', slab, 37.25, 61.5);
    const p = C.worldToPlane('coronal', slab, w);
    return { back, idx, dx: Math.abs(p.x - 37.25), dy: Math.abs(p.y - 61.5) };
  });
  check('indices recovered from the crosshair point',
    rt.back.axial === rt.idx.axial && rt.back.coronal === rt.idx.coronal &&
    rt.back.sagittal === rt.idx.sagittal,
    JSON.stringify(rt.back) + ' vs ' + JSON.stringify(rt.idx));
  check('plane → world → plane is exact', rt.dx < 1e-9 && rt.dy < 1e-9,
    'err ' + Math.max(rt.dx, rt.dy).toExponential(2) + ' px');

  await page.screenshot({ path: path.join(SP, 'shot-oblique.png') });

  console.log('\n6. Straighten restores the orthogonal state');
  await page.click('#obliqueResetBtn');
  await page.waitForTimeout(400);
  const reset = await areaOf('axial');
  check('obliqueActive() false again', await page.evaluate(() => window.__ctConsole.obliqueActive()) === false);
  check('back on the fast path', reset.oblique === false);
  check('axial area matches the original ellipse', near(reset.area, before.area, 1e-6),
    reset.area.toFixed(2) + ' vs ' + before.area.toFixed(2));
  check('straighten button disabled again', !(await page.isEnabled('#obliqueResetBtn')));

  console.log('\n7. Alt+drag drives the same rotation from the mouse');
  const box = await page.evaluate(() => { const r = window.__ctConsole.cellEl(2).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const cxp = box.x + box.width / 2, cyp = box.y + box.height / 2;
  await page.keyboard.down('Alt');
  await page.mouse.move(cxp + 120, cyp);
  await page.mouse.down();
  await page.mouse.move(cxp + 110, cyp - 42, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForTimeout(400);
  const dragTilt = await page.evaluate(() => ({
    a: window.__ctConsole.tiltOf('axial'), s: window.__ctConsole.tiltOf('sagittal'),
  }));
  check('Alt+drag tilted the companion planes', dragTilt.a > 5, 'axial now ' + dragTilt.a.toFixed(1) + '°');
  check('Alt+drag left the dragged plane square', near(dragTilt.s, 0, 1e-9));

  console.log('\n8. Slab projection still works on an oblique cut');
  await page.evaluate(() => {
    const C = window.__ctConsole;
    C.state.thicknessMm = 10;
    C.state.projectionMode = 'mip';
    C.renderAll();
  });
  await page.waitForTimeout(500);
  const slab = await page.evaluate(() => {
    const s = window.__ctConsole.getPlaneData('axial');
    let max = -1e9;
    for (let i = 0; i < s.data.length; i++) if (s.data[i] > max) max = s.data[i];
    return { samples: s.samples, max, oblique: !!s.oblique };
  });
  check('oblique MIP slab accumulates multiple steps', slab.oblique && slab.samples > 1,
    slab.samples + ' steps');
  check('MIP picks up the 900 HU bone slab', slab.max > 850, 'max ' + slab.max.toFixed(0) + ' HU');

  await page.screenshot({ path: path.join(SP, 'shot-oblique-mip.png') });

  console.log('\n9. Bone cut still applies through the oblique path');
  await page.evaluate(() => {
    const C = window.__ctConsole;
    C.state.thicknessMm = 0; C.state.projectionMode = 'average';
    C.state.boneCut = true; C.renderAll();
  });
  await page.waitForTimeout(300);
  await page.click('#boneCutToggle');
  await page.waitForTimeout(900);
  const cut = await page.evaluate(() => {
    const s = window.__ctConsole.getPlaneData('axial');
    let max = -1e9;
    for (let i = 0; i < s.data.length; i++) if (s.data[i] > max) max = s.data[i];
    return { max, oblique: !!s.oblique, on: window.__ctConsole.state.boneCut };
  });
  check('bone removed from the oblique reslice', !cut.on || cut.max < 850,
    'boneCut=' + cut.on + ' max ' + cut.max.toFixed(0) + ' HU');

  console.log('\n10. No page errors');
  check('clean console', errors.length === 0, errors.slice(0, 4).join(' ;; ') || 'none');

  await browser.close();
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'All browser checks passed') + '\n');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
