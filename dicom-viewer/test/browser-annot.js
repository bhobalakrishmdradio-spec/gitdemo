/* Annotation and measurement editing, driven through real mouse events.

   Every claim here is checked against what the application reports, not
   against the function that computes it: a tool that places its points in
   the wrong pane, or an ROI that survives a series change, would pass a
   unit test and fail a reader. */
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
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });
  const files = fs.readdirSync(path.join(SP, 'phantom')).filter(f => f.endsWith('.dcm')).sort()
    .map(f => path.join(SP, 'phantom', f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume, null, { timeout: 60000 });
  await page.waitForTimeout(800);

  // One big axial pane, so every click lands where it is aimed.
  await page.evaluate(() => { window.__ctConsole.setLayout('axial'); });
  await page.waitForTimeout(400);

  /* Plane coordinates -> viewport CSS pixels, for pane 0. */
  const toScreen = (px, py) => page.evaluate(([x, y]) => {
    const C = window.__ctConsole;
    const g = C.cellGeom(0);
    const c = C.planeToCanvas(g.t, x, y);
    const r = C.cellEl(0).querySelector('canvas').getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x: r.left + c.x / dpr, y: r.top + c.y / dpr };
  }, [px, py]);

  const clickPlane = async (px, py) => {
    const s = await toScreen(px, py);
    await page.mouse.click(s.x, s.y);
    await page.waitForTimeout(60);
  };
  const setTool = (t) => page.evaluate((tool) => window.__ctConsole.setTool(tool), t);
  const last = () => page.evaluate(() => {
    const C = window.__ctConsole, M = window.CTMeasure;
    const m = C.state.measurements[C.state.measurements.length - 1];
    if (!m) return null;
    const g = C.cellGeom(0);
    const res = M.evaluate(m, g.slab, C.calibrationFor(m.plane, g.slab));
    return { tool: m.tool, n: m.points.length, primary: res.primary, detail: res.detail,
             seriesUid: m.seriesUid, plane: m.plane, sliceIndex: m.sliceIndex, id: m.id,
             points: m.points.map(p => ({ x: p.x, y: p.y })) };
  });
  const count = () => page.evaluate(() => window.__ctConsole.state.measurements.length);
  const clearAll = () => page.evaluate(() => window.__ctConsole.clearMeasurements());

  /* Geometry of the phantom plane, so expectations are derived, not guessed. */
  const geom = await page.evaluate(() => {
    const s = window.__ctConsole.getPlaneData('axial');
    return { w: s.width, h: s.height, sx: s.spacingX, sy: s.spacingY };
  });
  console.log(`Plane ${geom.w}x${geom.h}, spacing ${geom.sx} x ${geom.sy} mm\n`);

  /* =================================================================== */
  console.log('1. Every new tool places the points it is clicked at');

  await clearAll();
  await setTool('distance');
  await clickPlane(20.5, 30.5); await clickPlane(60.5, 30.5);
  let m = await last();
  const expectMm = 40 * geom.sx;
  check('distance places 2 points', m && m.tool === 'distance' && m.n === 2, m && m.n);
  check(`distance reads ${expectMm.toFixed(1)} mm`,
    near(parseFloat(m.primary), expectMm, 0.35), m.primary);

  await clearAll();
  await setTool('polyline');
  await clickPlane(20.5, 30.5); await clickPlane(60.5, 30.5); await clickPlane(60.5, 70.5);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
  m = await last();
  check('polyline keeps all 3 clicked points', m && m.tool === 'polyline' && m.n === 3, m && m.n);
  check('polyline sums both segments',
    near(parseFloat(m.primary), 40 * geom.sx + 40 * geom.sy, 0.5), m.primary);
  check('polyline says how many segments', /2 segments/.test(m.detail), m.detail);

  await clearAll();
  await setTool('cobb');
  // Two horizontal lines tilted 0 deg and 20 deg: the Cobb angle is 20 deg.
  const rad = 20 * Math.PI / 180;
  const run = 40, rise = (40 * geom.sx * Math.tan(rad)) / geom.sy;
  await clickPlane(20.5, 30.5); await clickPlane(20.5 + run, 30.5);
  await clickPlane(20.5, 70.5); await clickPlane(20.5 + run, 70.5 + rise);
  m = await last();
  check('Cobb takes 4 points', m && m.tool === 'cobb' && m.n === 4, m && m.n);
  check('Cobb reads 20.0 deg', near(parseFloat(m.primary), 20, 0.2), m.primary);

  await clearAll();
  await setTool('circle');
  const rPx = 20;
  await clickPlane(64.5, 64.5); await clickPlane(64.5 + rPx, 64.5);
  m = await last();
  check('circle takes centre then edge', m && m.tool === 'circle' && m.n === 2, m && m.n);
  // A click lands on a screen pixel, so the radius is only approximately the
  // one aimed at. Check the area against the radius actually stored.
  const rActual = Math.hypot((m.points[1].x - m.points[0].x) * geom.sx,
                             (m.points[1].y - m.points[0].y) * geom.sy);
  const areaReported = parseFloat((m.detail.match(/([\d.]+) mm²/) || [])[1]);
  check(`circle radius is close to the ${(rPx * geom.sx).toFixed(1)} mm aimed at`,
    near(rActual, rPx * geom.sx, 0.5), rActual.toFixed(3) + ' mm');
  check('circle area = pi r^2 for the radius it actually has',
    near(areaReported, Math.PI * rActual * rActual, 0.6),
    areaReported + ' vs ' + (Math.PI * rActual * rActual).toFixed(1));

  await clearAll();
  await setTool('polygon');
  await clickPlane(40.5, 40.5); await clickPlane(80.5, 40.5); await clickPlane(80.5, 80.5);
  await clickPlane(40.5, 80.5);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
  m = await last();
  check('polygon closes with 4 vertices', m && m.tool === 'polygon' && m.n === 4, m && m.n);
  // Shoelace over the vertices actually stored; again the clicks are only
  // as precise as a screen pixel.
  const shoelace = (pts) => {
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      sum += (a.x * geom.sx) * (b.y * geom.sy) - (b.x * geom.sx) * (a.y * geom.sy);
    }
    return Math.abs(sum) / 2;
  };
  const polyWant = shoelace(m.points);
  check(`polygon area = ${polyWant.toFixed(0)} mm2 by shoelace`,
    near(parseFloat((m.detail.match(/([\d.]+) mm²/) || [])[1]), polyWant, 0.6), m.detail);
  check('polygon is within 1% of the 1600 mm2 square aimed at',
    Math.abs(polyWant - 1600) / 1600 < 0.01, polyWant.toFixed(1));

  /* The same square drawn as a rectangle must enclose exactly the same
     pixels: one ROI rule, or two ROIs over one square disagree quietly. */
  const polyStats = await page.evaluate(() => {
    const C = window.__ctConsole, M = window.CTMeasure, g = C.cellGeom(0);
    const mm = C.state.measurements[C.state.measurements.length - 1];
    return M.regionStats(mm, g.slab, C.calibrationFor(mm.plane, g.slab));
  });
  await setTool('rect');
  await clickPlane(40.5, 40.5); await clickPlane(80.5, 80.5);
  const rectM = await last();
  const rectStats = await page.evaluate(() => {
    const C = window.__ctConsole, M = window.CTMeasure, g = C.cellGeom(0);
    const mm = C.state.measurements[C.state.measurements.length - 1];
    return M.regionStats(mm, g.slab, C.calibrationFor(mm.plane, g.slab));
  });
  check('rectangle and polygon over the same square enclose the same pixels',
    rectStats.count === polyStats.count, rectStats.count + ' vs ' + polyStats.count);
  check('rectangle and polygon over the same square agree on the mean',
    rectM.primary === m.primary, rectM.primary + ' vs ' + m.primary);

  /* =================================================================== */
  console.log('\n2. Traced shapes follow the drag');
  await clearAll();
  await setTool('freehandRoi');
  const a = await toScreen(50.5, 50.5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let k = 0; k <= 24; k++) {
    const th = (k / 24) * Math.PI * 2;
    const s = await toScreen(64.5 + 15 * Math.cos(th), 64.5 + 15 * Math.sin(th));
    await page.mouse.move(s.x, s.y);
  }
  await page.mouse.up();
  await page.waitForTimeout(120);
  m = await last();
  check('freehand ROI records a traced path', m && m.tool === 'freehandRoi' && m.n > 8, m && m.n);
  check('freehand ROI reports statistics', m && /±/.test(m.primary), m && m.primary);

  /* =================================================================== */
  console.log('\n3. Annotations carry text, not numbers');
  await clearAll();
  await setTool('arrow');
  await clickPlane(30.5, 30.5); await clickPlane(70.5, 70.5);
  m = await last();
  check('arrow is placed', m && m.tool === 'arrow' && m.n === 2, m && m.n);
  check('arrow reports no measurement', m && !/mm|±|°/.test(m.primary), m && m.primary);

  await setTool('text');
  await clickPlane(50.5, 50.5);
  await page.waitForTimeout(150);
  check('caption editor opens on the canvas',
    await page.isVisible('#annotInput'));
  await page.fill('#annotField', 'Lesion A');
  await page.click('#annotOk');
  await page.waitForTimeout(120);
  const texts = await page.evaluate(() =>
    window.__ctConsole.state.measurements.filter(x => x.tool === 'text').map(x => x.text));
  check('caption is kept', texts.length === 1 && texts[0] === 'Lesion A', JSON.stringify(texts));

  // Cancelling a brand new caption must leave nothing behind.
  const before = await count();
  await setTool('text');
  await clickPlane(90.5, 90.5);
  await page.waitForTimeout(120);
  await page.click('#annotCancel');
  await page.waitForTimeout(120);
  check('a cancelled caption leaves no invisible marker',
    (await count()) === before, before + ' -> ' + (await count()));

  /* =================================================================== */
  console.log('\n4. Measurements can be reshaped and moved after placement');
  await clearAll();
  await setTool('distance');
  await clickPlane(30.5, 64.5); await clickPlane(70.5, 64.5);
  let d0 = await last();
  const startMm = parseFloat(d0.primary);

  // Handles are live only under Navigate, so that a drawing tool always
  // draws. Switch to it, as a reader would.
  await setTool('none');
  check('a drawing tool does not grab handles',
    (await page.evaluate(() => { window.__ctConsole.setTool('distance');
      const C = window.__ctConsole, g = C.cellGeom(0);
      const p = C.planeToCanvas(g.t, C.state.measurements[0].points[1].x,
                                     C.state.measurements[0].points[1].y);
      const r = C.cellEl(0).querySelector('canvas').getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const hit = C.hitTestMeasurement(0, r.left + p.x / dpr, r.top + p.y / dpr);
      C.setTool('none');
      return hit; })) === null);

  // Drag the second endpoint 20 px further out.
  let from = await toScreen(70.5, 64.5), to = await toScreen(90.5, 64.5);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  let d1 = await last();
  check('dragging an endpoint reshapes the measurement',
    near(parseFloat(d1.primary), startMm + 20 * geom.sx, 0.6),
    d0.primary + ' -> ' + d1.primary);
  check('reshaping does not create a second measurement', (await count()) === 1, await count());

  // Now grab the centre grip and move the whole thing; its length must not change.
  const grip = await page.evaluate(() => {
    const C = window.__ctConsole;
    const m = C.state.measurements[0];
    return C.moveGrip(m);
  });
  from = await toScreen(grip.x, grip.y);
  to = await toScreen(grip.x, grip.y + 20);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  let d2 = await last();
  check('moving by the grip preserves the length',
    near(parseFloat(d2.primary), parseFloat(d1.primary), 0.05),
    d1.primary + ' -> ' + d2.primary);
  check('moving by the grip actually moved it',
    near(d2.points[0].y, d1.points[0].y + 20, 1.5),
    d1.points[0].y.toFixed(1) + ' -> ' + d2.points[0].y.toFixed(1));

  /* =================================================================== */
  console.log('\n5. Hiding is separate from deleting');
  const id = d2.id;
  await page.evaluate((i) => window.__ctConsole.toggleMeasurementHidden(i), id);
  await page.waitForTimeout(80);
  check('a hidden measurement is still in the list', (await count()) === 1, await count());
  check('a hidden measurement is not drawn',
    (await page.evaluate(() => {
      const C = window.__ctConsole, g = C.cellGeom(0);
      return C.measurementsFor(g.plane, g.index, g.uid).length;
    })) === 0);
  check('its row is still shown, marked hidden',
    (await page.locator('.measure-row.hidden-row').count()) === 1);
  await page.evaluate((i) => window.__ctConsole.toggleMeasurementHidden(i), id);
  await page.waitForTimeout(80);
  check('unhiding brings it back',
    (await page.evaluate(() => {
      const C = window.__ctConsole, g = C.cellGeom(0);
      return C.measurementsFor(g.plane, g.index, g.uid).length;
    })) === 1);

  await page.evaluate((i) => window.__ctConsole.deleteMeasurement(i), id);
  await page.waitForTimeout(80);
  check('deleting removes it', (await count()) === 0, await count());

  /* =================================================================== */
  console.log('\n6. The ROI histogram agrees with the ROI it came from');
  await clearAll();
  await setTool('rect');
  await clickPlane(30.5, 30.5); await clickPlane(98.5, 98.5);
  await page.waitForTimeout(200);
  const hist = await page.evaluate(() => {
    const C = window.__ctConsole, M = window.CTMeasure;
    const m = C.state.measurements[0];
    const g = C.cellGeom(0);
    const cal = C.calibrationFor(m.plane, g.slab);
    const h = M.histogramOf(m, g.slab, cal, 48);
    const s = M.regionStats(m, g.slab, cal);
    let sum = 0; for (let i = 0; i < h.counts.length; i++) sum += h.counts[i];
    return { sum, n: s.count, mean: s.mean, hmean: h.stats.mean,
             visible: !document.getElementById('roiHistogram').hidden,
             note: document.getElementById('histogramNote').textContent };
  });
  check('histogram counts exactly the ROI pixels', hist.sum === hist.n, hist.sum + ' vs ' + hist.n);
  check('histogram mean equals the ROI mean', hist.mean === hist.hmean);
  check('histogram is shown for a selected ROI', hist.visible);
  check('histogram caption names n and the mean',
    /n=\d+/.test(hist.note) && /mean/.test(hist.note), hist.note);

  /* =================================================================== */
  console.log('\n7. Measurements survive a reload, on the right series');
  const uid = await page.evaluate(() => window.__ctConsole.state.currentSeriesUID);
  const beforeReload = await page.evaluate(() => {
    const C = window.__ctConsole;
    return C.state.measurements.map(m => ({ tool: m.tool, n: m.points.length,
      x: m.points[0].x, y: m.points[0].y, uid: m.seriesUid }));
  });
  check('the ROI was stamped with its series', beforeReload[0].uid === uid);

  await page.reload({ waitUntil: 'networkidle' });
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume, null, { timeout: 60000 });
  await page.waitForTimeout(900);
  const afterReload = await page.evaluate(() => {
    const C = window.__ctConsole;
    return C.state.measurements.map(m => ({ tool: m.tool, n: m.points.length,
      x: m.points[0].x, y: m.points[0].y, uid: m.seriesUid }));
  });
  check('the ROI came back after a reload', afterReload.length === beforeReload.length,
    afterReload.length + ' vs ' + beforeReload.length);
  check('it came back on the same series and at the same place',
    afterReload.length === 1 && afterReload[0].uid === uid &&
    near(afterReload[0].x, beforeReload[0].x, 1e-6) &&
    near(afterReload[0].y, beforeReload[0].y, 1e-6),
    JSON.stringify(afterReload[0]));
  check('it is drawn on the reloaded series',
    (await page.evaluate(() => {
      const C = window.__ctConsole, g = C.cellGeom(0);
      return C.measurementsFor(g.plane, g.index, g.uid).length;
    })) === 1);

  /* A measurement must not be drawn over a different series. */
  const otherUid = await page.evaluate(() => {
    const C = window.__ctConsole;
    return C.state.seriesOrder.filter(u => u !== C.state.currentSeriesUID)[0] || null;
  });
  if (otherUid) {
    const leaked = await page.evaluate((u) => {
      const C = window.__ctConsole, g = C.cellGeom(0);
      return C.measurementsFor(g.plane, g.index, u).length;
    }, otherUid);
    check('it is NOT drawn over a different series', leaked === 0, leaked);
  } else {
    check('it is NOT drawn over a different series (no second series to test)', true, 'skipped');
  }

  await clearAll();
  await page.waitForTimeout(100);
  const leftOver = await page.evaluate((u) => {
    try { return window.localStorage.getItem('ctconsole.measure.' + u); } catch (e) { return 'ERR'; }
  }, uid);
  check('deleting the last measurement clears its stored record', leftOver === null, leftOver);

  /* =================================================================== */
  console.log('\n8. Nothing regressed');
  check('the overflow menu is reachable by a real cursor', await page.evaluate(async () => {
    const btn = document.getElementById('toolMoreBtn');
    btn.click();
    await new Promise(r => setTimeout(r, 60));
    const menu = document.getElementById('toolMenu');
    if (menu.hidden) return false;
    const item = menu.querySelector('[data-tool="polygon"]');
    const r = item.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!(hit && item.contains(hit));
  }));
  await page.keyboard.press('Escape');
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nAll annotation checks passed');
  process.exit(fails ? 1 : 0);
})();
