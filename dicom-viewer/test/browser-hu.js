/* The codec phantom has known HU: -1000 air, 40 soft tissue, 300 lesion, 900 bone. */
const { chromium } = require('playwright');
const UI = require('./ui');
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
  const files = fs.readdirSync(path.join(SP, 'series-raw')).filter(f => f.endsWith('.dcm')).sort()
    .map(f => path.join(SP, 'series-raw', f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await UI.pickLayout(page, 'axial');

  // Canvas point for a given plane pixel, via the app's own transform.
  const atPixel = (px, py) => page.evaluate(([px, py]) => {
    const C = window.__ctConsole;
    const g = C.cellGeom(0);
    const c = C.planeToCanvas(g.t, px, py);
    const cv = C.cellEl(0).querySelector('.vp-canvas');
    const r = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x: r.x + c.x / dpr, y: r.y + c.y / dpr };
  }, [px, py]);

  console.log('\n1. Live HU readout follows the cursor');
  check('the HU button starts active',
    await page.evaluate(() => !!document.querySelector('#moreMenu [data-more="hu"].on')));
  const centre = await atPixel(48.5, 48.5);          // lesion, 300 HU
  await page.mouse.move(centre.x, centre.y);
  await page.waitForTimeout(250);
  // Read the number itself rather than matching a phrasing, so the check
  // survives a change of wording.
  const valueOf = (txt) => parseFloat(String(txt).trim());
  const atLesion = await page.textContent('#huReadout');
  check('reads ~300 HU over the lesion', near(valueOf(atLesion), 300, 15) && /HU/.test(atLesion), atLesion);
  check('names the plane and pixel', /axial/.test(atLesion) && /px /.test(atLesion), atLesion);

  const corner = await atPixel(3.5, 3.5);            // air outside the body
  await page.mouse.move(corner.x, corner.y);
  await page.waitForTimeout(250);
  const atAir = await page.textContent('#huReadout');
  check('reads -1000 HU over air', near(valueOf(atAir), -1000, 10) && /HU/.test(atAir), atAir);

  const bone = await atPixel(8.5, 48.5);             // bone slab: x<10 and inside the body
  await page.mouse.move(bone.x, bone.y);
  await page.waitForTimeout(250);
  const atBone = await page.textContent('#huReadout');
  check('reads ~900 HU over the bone slab', near(valueOf(atBone), 900, 40) && /HU/.test(atBone), atBone);

  console.log('\n2. The readout is independent of the display window');
  await UI.pickWindow(page, 'bone');
  await page.mouse.move(centre.x + 1, centre.y);
  await page.mouse.move(centre.x, centre.y);
  await page.waitForTimeout(250);
  const afterWindow = await page.textContent('#huReadout');
  check('the same pixel reads the same HU in a bone window',
    afterWindow.split('·')[0].trim() === atLesion.split('·')[0].trim(),
    atLesion.split('·')[0].trim() + ' vs ' + afterWindow.split('·')[0].trim());
  await UI.pickWindow(page, 'invert');
  await page.mouse.move(centre.x + 1, centre.y); await page.mouse.move(centre.x, centre.y);
  await page.waitForTimeout(250);
  check('and the same again when inverted',
    (await page.textContent('#huReadout')).split('·')[0].trim() === atLesion.split('·')[0].trim());
  await UI.pickWindow(page, 'invert');
  await UI.pickWindow(page, 'soft');

  console.log('\n3. The HU button turns the readout off');
  await UI.pickMore(page, 'hu');
  await page.mouse.move(centre.x + 2, centre.y);
  await page.waitForTimeout(250);
  check('readout is blank when off', (await page.textContent('#huReadout')) === '');
  await UI.pickMore(page, 'hu');

  console.log('\n4. The HU probe tool pins a value with one click');
  await UI.pickTool(page, 'point');
  await page.mouse.click(centre.x, centre.y);
  await page.waitForTimeout(400);
  const probes = await page.evaluate(() => window.__ctConsole.state.measurements
    .filter(m => m.tool === 'point').length);
  check('one click creates the marker', probes === 1, probes + ' marker(s)');
  const probeText = await page.textContent('#measureList');
  check('the list shows its value with the HU unit', /30\d|29\d/.test(probeText) && /HU/.test(probeText),
    probeText.replace(/\s+/g, ' ').slice(0, 80));

  console.log('\n5. Rectangular ROI — the gesture');
  await UI.pickTool(page, 'rect');
  const a = await atPixel(44, 44), b = await atPixel(54, 54);
  await page.mouse.click(a.x, a.y); await page.waitForTimeout(150);
  await page.mouse.click(b.x, b.y); await page.waitForTimeout(400);
  const drawn = await page.evaluate(() => {
    const r = window.__ctConsole.state.measurements.filter(m => m.tool === 'rect');
    return { n: r.length, pts: r.length ? r[r.length - 1].points.length : 0 };
  });
  check('two clicks create a rectangle with two corners', drawn.n === 1 && drawn.pts === 2,
    JSON.stringify(drawn));

  console.log('\n6. Rectangular ROI — the arithmetic, on exact coordinates');
  // Mouse rounding shifts a corner by a pixel, so the numbers are checked
  // against points placed exactly rather than against a click.
  const stats = await page.evaluate(() => {
    const C = window.__ctConsole, M = window.CTMeasure;
    const s = C.getPlaneData('axial', C.state.index.axial);
    const cal = M.calibrationOf(s, 'PixelSpacing');
    const box = [{ x: 44, y: 44 }, { x: 54, y: 54 }];
    const rect = M.createMeasurement(M.TOOLS.rect, 'axial', 0, box);
    const ell = M.createMeasurement(M.TOOLS.ellipse, 'axial', 0, box);
    const rs = M.rectStats(s, box[0], box[1], cal);
    const es = M.ellipseStats(s, box[0], box[1], cal);
    return {
      rectDetail: M.evaluate(rect, s, cal).detail,
      area: rs.area, count: rs.count, mean: rs.mean, min: rs.min, max: rs.max,
      ellipseCount: es.count, ellipseArea: es.area,
      unit: C.state.seriesMap[C.state.currentSeriesUID].slices[0].instance.rescaleType,
    };
  });
  check('a 10x10 px box at 1 mm spacing is exactly 100 mm²', near(stats.area, 100, 1e-9),
    stats.area.toFixed(6) + ' mm²');
  check('and encloses exactly 100 pixels', stats.count === 100, stats.count + ' px');
  check('mean sits at the 300 HU lesion', near(stats.mean, 300, 12), stats.mean.toFixed(1) + ' HU');
  check('min and max bracket the mean', stats.min < stats.mean && stats.max > stats.mean,
    stats.min + ' .. ' + stats.max);
  check('the detail line carries min, max, area and n',
    /min /.test(stats.rectDetail) && /max /.test(stats.rectDetail) &&
    /mm²/.test(stats.rectDetail) && /n=100/.test(stats.rectDetail), stats.rectDetail);
  // The inscribed ellipse must cover pi/4 of the square, to within one ring of pixels.
  check('the inscribed ellipse covers ~78.5% of the same box',
    near(stats.ellipseCount / stats.count, Math.PI / 4, 0.04) &&
    near(stats.ellipseArea / stats.area, Math.PI / 4, 1e-9),
    (100 * stats.ellipseCount / stats.count).toFixed(1) + '% of pixels, ' +
    (100 * stats.ellipseArea / stats.area).toFixed(1) + '% of area');

  console.log('\n7. Reset menu');
  await UI.pickTool(page, 'none');
  await page.evaluate(() => {
    const C = window.__ctConsole;
    C.state.cells[0].view.zoom = 3;
    C.state.cells[0].view.rotation = 90;
    C.state.windowWidth = 1234; C.state.windowCenter = 77;
    C.rotateOblique('axial', 0.3);
    C.renderAll();
  });
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => ({
    zoom: window.__ctConsole.state.cells[0].view.zoom,
    ww: window.__ctConsole.state.windowWidth,
    tilt: window.__ctConsole.tiltOf('coronal'),
    measures: window.__ctConsole.state.measurements.length,
  }));
  check('setup: zoomed, re-windowed, tilted, with measurements',
    before.zoom === 3 && before.ww === 1234 && before.tilt > 1 && before.measures >= 2,
    JSON.stringify(before));

  const openMenu = async () => { await page.click('#resetBtn'); await page.waitForTimeout(250); };
  await openMenu();
  check('the menu opens', !(await page.getAttribute('#resetMenu', 'hidden') === ''));
  // Playwright will click a visually clipped element, so assert the menu is
  // genuinely on top at its own coordinates — the thing a mouse would hit.
  const reachable = await page.evaluate(() => {
    const m = document.getElementById('resetMenu');
    const r = m.getBoundingClientRect();
    const probes = [[r.x + r.width / 2, r.y + 12], [r.x + r.width / 2, r.y + r.height - 12]];
    return probes.map(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return { inside: !!(hit && m.contains(hit)), got: hit ? hit.tagName : null };
    });
  });
  check('every part of the menu is actually hit-testable, not clipped',
    reachable.every(r => r.inside), JSON.stringify(reachable));
  check('the menu sits inside the viewport', await page.evaluate(() => {
    const r = document.getElementById('resetMenu').getBoundingClientRect();
    return r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  }));
  await page.click('[data-reset="view"]'); await page.waitForTimeout(400);
  let now = await page.evaluate(() => ({
    zoom: window.__ctConsole.state.cells[0].view.zoom,
    rot: window.__ctConsole.state.cells[0].view.rotation,
    ww: window.__ctConsole.state.windowWidth,
    tilt: window.__ctConsole.tiltOf('coronal'),
    measures: window.__ctConsole.state.measurements.length,
  }));
  check('"Reset view" clears zoom and rotation only',
    now.zoom === 1 && now.rot === 0 && now.ww === 1234 && now.tilt > 1 && now.measures >= 2,
    JSON.stringify(now));

  await openMenu();
  await page.click('[data-reset="window"]'); await page.waitForTimeout(400);
  now = await page.evaluate(() => ({
    ww: window.__ctConsole.state.windowWidth, wc: window.__ctConsole.state.windowCenter,
    tilt: window.__ctConsole.tiltOf('coronal'),
    measures: window.__ctConsole.state.measurements.length,
  }));
  check('"Reset window/level" restores the study\'s own W/L, leaving the rest',
    now.ww === 400 && now.wc === 40 && now.tilt > 1 && now.measures >= 2, JSON.stringify(now));

  await openMenu();
  await page.click('[data-reset="oblique"]'); await page.waitForTimeout(400);
  now = await page.evaluate(() => ({
    tilt: window.__ctConsole.tiltOf('coronal'),
    measures: window.__ctConsole.state.measurements.length,
  }));
  check('"Straighten planes" removes the tilt, keeping measurements',
    now.tilt < 1e-9 && now.measures >= 2, JSON.stringify(now));

  await openMenu();
  await page.click('[data-reset="measurements"]'); await page.waitForTimeout(400);
  check('"Clear measurements" empties the list',
    (await page.evaluate(() => window.__ctConsole.state.measurements.length)) === 0);

  console.log('\n8. Reset panes and reset everything');
  await UI.pickLayout(page, '2x3');
  await page.evaluate(() => {
    const C = window.__ctConsole;
    C.state.cells[1].wl = { ww: 2000, wc: 480, preset: 'bone' };
    C.state.cells[2].pinned = true; C.state.cells[2].index = 3;
    C.renderAll();
  });
  await page.waitForTimeout(400);
  await openMenu();
  await page.click('[data-reset="panes"]'); await page.waitForTimeout(700);
  const panes = await page.evaluate(() => ({
    wl: window.__ctConsole.state.cells[1].wl,
    pinned: window.__ctConsole.state.cells[2].pinned,
    count: window.__ctConsole.cellCount(),
    layout: window.__ctConsole.state.layout,
  }));
  check('"Reset panes" drops per-pane windows and pins, keeping the layout',
    panes.wl === null && panes.pinned === false && panes.count === 6 && panes.layout === '2x3',
    JSON.stringify(panes));

  await page.evaluate(() => {
    const C = window.__ctConsole;
    C.state.cells[0].view.zoom = 2.5; C.state.windowWidth = 999;
    C.rotateOblique('axial', 0.2); C.renderAll();
  });
  await page.waitForTimeout(400);
  await openMenu();
  await page.click('[data-reset="all"]'); await page.waitForTimeout(800);
  const all = await page.evaluate(() => ({
    zoom: window.__ctConsole.state.cells[0].view.zoom,
    ww: window.__ctConsole.state.windowWidth,
    tilt: window.__ctConsole.tiltOf('coronal'),
    measures: window.__ctConsole.state.measurements.length,
    volume: !!window.__ctConsole.state.volume,
  }));
  check('"Reset everything" clears all of it but keeps the study loaded',
    all.zoom === 1 && all.ww === 400 && all.tilt < 1e-9 && all.measures === 0 && all.volume,
    JSON.stringify(all));

  /* Two separate claims about the toolbar, and the second is the one that
     matters. Keeping it to a single row saves grid height; keeping every
     control reachable is what stops a person being unable to open the
     report panel. An earlier build satisfied the first by scrolling the bar
     sideways, which broke the second silently — a button past the right
     edge is still in the DOM and still clickable from script. */
  console.log('\n9. Every toolbar control is reachable, at every width');
  for (const w of [2560, 1920, 1680, 1400, 1280, 1100, 900]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(250);
    const bar = await page.evaluate(() => {
      const el = document.querySelector('.toolbar');
      const unreachable = [...el.querySelectorAll('button, select, label.file-btn')]
        .filter(c => {
          const q = c.getBoundingClientRect();
          if (!q.width || !q.height) return false;
          const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
          return !(hit && (c === hit || c.contains(hit)));
        })
        .map(c => c.id || c.textContent.trim().slice(0, 12));
      return { h: Math.round(el.getBoundingClientRect().height),
               overflow: el.scrollWidth - el.clientWidth, unreachable };
    });
    check(`${w}px: no control is out of reach`, bar.unreachable.length === 0,
      bar.unreachable.join(', '));
    check(`${w}px: nothing is scrolled off the end`, bar.overflow <= 0, bar.overflow + 'px');
    if (w >= 1100) {
      check(`${w}px: still a single row`, bar.h < 60, bar.h + 'px');
    }
  }
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.waitForTimeout(300);

  /* Every toolbar menu must open where it can be pressed. This is the
     failure that made the Reset menu unreachable once: it was inside a
     scrolling container, looked fine, and passed a scripted click. */
  console.log('\n9b. Every toolbar menu opens and every item is clickable');
  for (const [btn, menu] of [['openBtn','openMenu'], ['layoutBtn','layoutMenu'],
                             ['windowBtn','windowMenu'], ['toolMoreBtn','toolMenu'],
                             ['orientBtn','orientMenu'], ['moreBtn','moreMenu'],
                             ['resetBtn','resetMenu']]) {
    await page.click('#' + btn);
    await page.waitForTimeout(140);
    const r = await page.evaluate((m) => {
      const el = document.getElementById(m);
      if (el.hidden) return { open: false };
      const box = el.getBoundingClientRect();
      const bad = [...el.querySelectorAll('button')].filter(i => {
        const q = i.getBoundingClientRect();
        if (!q.width || !q.height) return true;
        const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
        return !(hit && (i === hit || i.contains(hit)));
      }).map(i => i.textContent.trim().slice(0, 18));
      return { open: true, bad,
               offscreen: box.right > innerWidth + 1 || box.bottom > innerHeight + 1 ||
                          box.left < -1 || box.top < -1 };
    }, menu);
    check(`${menu}: opens, on screen, every item clickable`,
      r.open && !r.offscreen && r.bad.length === 0,
      !r.open ? 'did not open' : r.offscreen ? 'runs off screen' : r.bad.join(', '));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    check(`${menu}: Escape closes it`,
      await page.evaluate(m => document.getElementById(m).hidden, menu));
  }

  console.log('\n10. A projected slab is never labelled as a plain pixel value');
  await UI.pickLayout(page, 'axial');
  const probePt = await atPixel(48.5, 48.5);
  await page.mouse.move(probePt.x, probePt.y); await page.waitForTimeout(250);
  const thin = await page.textContent('#huReadout');
  check('a thin slice reads as plain HU', /HU/.test(thin) && !/\(/.test(thin), thin);
  for (const [mode, tag] of [['mip', 'MIP'], ['minip', 'MinIP'], ['average', 'Avg']]) {
    await page.evaluate((m) => { const C = window.__ctConsole;
      C.state.thicknessMm = 10; C.state.projectionMode = m; C.renderAll(); }, mode);
    await page.waitForTimeout(400);
    await page.mouse.move(probePt.x + 1, probePt.y);
    await page.mouse.move(probePt.x, probePt.y);
    await page.waitForTimeout(250);
    const txt = await page.textContent('#huReadout');
    check(`a 10 mm ${tag} slab says so`, txt.includes('(' + tag + ')'), txt);
  }
  await page.evaluate(() => { const C = window.__ctConsole;
    C.state.thicknessMm = 0; C.state.projectionMode = 'average';
    C.state.boneCut = true; C.renderAll(); });
  await page.waitForTimeout(400);
  await page.mouse.move(probePt.x + 1, probePt.y); await page.mouse.move(probePt.x, probePt.y);
  await page.waitForTimeout(250);
  check('the threshold mask is disclosed in the readout',
    (await page.textContent('#huReadout')).includes('(threshold mask)'),
    await page.textContent('#huReadout'));
  await page.evaluate(() => { window.__ctConsole.state.boneCut = false; window.__ctConsole.renderAll(); });
  await page.waitForTimeout(300);

  console.log('\n11. Negative values format the same everywhere');
  const neg = await page.evaluate(() => {
    const M = window.CTMeasure, C = window.__ctConsole;
    const s = C.getPlaneData('axial', C.state.index.axial);
    const m = M.createMeasurement(M.TOOLS.point, 'axial', 0, [{ x: 3.5, y: 3.5 }]);
    return { marker: M.evaluate(m, s, M.calibrationOf(s, 'PixelSpacing')).primary,
             raw: M.pointValue(s, { x: 3.5, y: 3.5 }).value };
  });
  check('a -1000 HU pixel reads "-1000", not "-1000.0"',
    neg.marker === String(neg.raw), neg.marker + ' vs raw ' + neg.raw);

  console.log('\n12. No page errors');
  check('clean console', errors.length === 0, errors.slice(0, 4).join(' ;; ') || 'none');

  await page.screenshot({ path: path.join(SP, 'shot-hu.png') });
  await browser.close();
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'All HU / ROI / reset checks passed') + '\n');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
