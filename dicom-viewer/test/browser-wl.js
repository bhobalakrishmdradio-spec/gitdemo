const { chromium } = require('playwright');
const UI = require('./ui');
const fs = require('fs'), path = require('path');
const SP = process.env.CT_FIXTURES || require('path').join(__dirname, 'fixtures');
let fails = 0;
const check = (n, ok, x) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (x ? '   [' + x + ']' : '')); if (!ok) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

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
  await page.waitForTimeout(1200);

  const wl = () => page.evaluate(() => [window.__ctConsole.state.windowWidth, window.__ctConsole.state.windowCenter]);
  /* Start the drags away from the middle of the pane. The crosshair has a
     grip at its intersection, which starts dead centre, and grabbing that
     moves the crosshair rather than the window — deliberately, since the
     grip is drawn at the size it is hit-tested at. A reader adjusting the
     window drags from the image, not from the grip. */
  const box = await page.evaluate(() => {
    const r = window.__ctConsole.cellEl(0).querySelector('.vp-canvas').getBoundingClientRect();
    return { x: r.x + r.width * 0.3, y: r.y + r.height * 0.3 };
  });
  const drag = async (dx, dy) => {
    await page.mouse.move(box.x, box.y); await page.mouse.down();
    for (let k = 1; k <= 10; k++) { await page.mouse.move(box.x + dx * k / 10, box.y + dy * k / 10); await page.waitForTimeout(8); }
    await page.mouse.up(); await page.waitForTimeout(200);
  };
  const preset = async (p) => { await UI.pickWindow(page, p); };

  console.log('\n0. The crosshair grip is small, and only the grip grabs');
  {
    const g = await page.evaluate(() => {
      const C = window.__ctConsole, geom = C.cellGeom(0);
      const idx = C.indexRecord(C.state.currentSeriesUID);
      const w = C.crosshairWorld(geom.vol, idx);
      const pp = C.worldToPlane(geom.plane, geom.slab, w, geom.index, geom.vol);
      const c = C.planeToCanvas(geom.t, pp.x, pp.y);
      const r = C.cellEl(0).querySelector('canvas').getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      return { x: r.left + c.x / dpr, y: r.top + c.y / dpr, w: r.width, h: r.height,
               left: r.left, top: r.top };
    });
    const hit = (x, y) => page.evaluate(([a, b]) =>
      !!window.__ctConsole.hitTestCrosshair(0, a, b), [x, y]);
    check('the grip itself grabs', await hit(g.x, g.y));
    check('20 px away does not', !(await hit(g.x + 20, g.y)));
    check('along the arm does not — the arms span the whole pane',
      !(await hit(g.x, g.y + g.h * 0.3)) && !(await hit(g.x + g.w * 0.3, g.y)));
    // Hiding the lines lives with the other display toggles under More; the
    // toolbar's crosshair button arms the crosshair *tool*, which is a
    // different thing and must not be used to turn the drawing off.
    check('and nothing grabs once the crosshair lines are hidden', await (async () => {
      await UI.pickMore(page, 'crosshairShow');
      const off = await hit(g.x, g.y);
      await UI.pickMore(page, 'crosshairShow');
      return !off;
    })());
    check('the toolbar button arms the crosshair tool rather than hiding the lines',
      await (async () => {
        await page.click('#crosshairBtn'); await page.waitForTimeout(200);
        const armed = await page.evaluate(() => window.__ctConsole.state.tool === 'crosshair'
          && window.__ctConsole.state.crosshair === true);
        await page.click('#crosshairBtn'); await page.waitForTimeout(200);
        const off = await page.evaluate(() => window.__ctConsole.state.tool);
        return armed && off === 'none';
      })());
  }

  console.log('\n1. The same drag changes every window by the same proportion');
  const ratios = {};
  for (const p of ['brain', 'soft', 'lung']) {
    await preset(p);
    const [w0] = await wl();
    await drag(80, 0);
    const [w1] = await wl();
    ratios[p] = w1 / w0;
    console.log(`     ${p.padEnd(6)} W${String(Math.round(w0)).padStart(4)} -> W${String(Math.round(w1)).padStart(4)}   ×${ratios[p].toFixed(3)}`);
  }
  const rs = Object.values(ratios);
  check('80 px right scales every window identically',
    Math.max(...rs) - Math.min(...rs) < 0.01, 'ratios ' + rs.map(r => r.toFixed(3)).join(', '));
  check('and 160 px doubles it, as documented', near(rs[0] * rs[0], 2, 0.03),
    '80 px = ×' + rs[0].toFixed(3) + ', so 160 px = ×' + (rs[0] * rs[0]).toFixed(3));

  console.log('\n2. Level steps in proportion to the window, not a fixed HU count');
  const levelSteps = {};
  for (const p of ['brain', 'soft', 'lung']) {
    await preset(p);
    const [w0, c0] = await wl();
    await drag(0, 50);
    const [, c1] = await wl();
    levelSteps[p] = (c1 - c0) / w0;
    console.log(`     ${p.padEnd(6)} W${String(Math.round(w0)).padStart(4)} level ${Math.round(c0)} -> ${Math.round(c1)}` +
      `   = ${(levelSteps[p] * 100).toFixed(1)}% of the window`);
  }
  const ls = Object.values(levelSteps);
  check('50 px down shifts every window by the same fraction of itself',
    Math.max(...ls) - Math.min(...ls) < 0.005, ls.map(v => (v * 100).toFixed(1) + '%').join(', '));
  check('dragging down darkens (level increases)', ls.every(v => v > 0),
    ls.map(v => v.toFixed(3)).join(', '));

  console.log('\n3. A brain window is now controllable');
  await preset('brain');
  const [bw0, bc0] = await wl();
  await drag(20, 0);
  const [bw1] = await wl();
  check('20 px right moves W80 by under 10%, not 50%',
    (bw1 / bw0 - 1) < 0.12, 'W' + bw0 + ' -> W' + bw1.toFixed(1) +
    ' (' + ((bw1 / bw0 - 1) * 100).toFixed(1) + '%)');
  await preset('brain');
  await drag(0, 20);
  const [, bc1] = await wl();
  check('20 px down moves the level by under 10% of the window, not 50%',
    Math.abs(bc1 - bc0) / bw0 < 0.12, 'level ' + bc0 + ' -> ' + bc1.toFixed(1));

  console.log('\n4. The width no longer collapses');
  await preset('soft');
  await drag(-300, 0);
  const [cw] = await wl();
  check('300 px left leaves a usable window, not 1', cw > 20, 'W' + cw.toFixed(1));
  await drag(300, 0);
  const [cw2] = await wl();
  check('dragging back out recovers it', cw2 > 200, 'W' + cw2.toFixed(1));
  await preset('soft');
  await drag(-1200, 0);
  const [cw3] = await wl();
  check('even an extreme drag stays above the floor', cw3 >= 1, 'W' + cw3.toFixed(3));

  console.log('\n5. The image actually responds');
  const meanOf = () => page.evaluate(() => {
    const cv = window.__ctConsole.cellEl(0).querySelector('.vp-canvas');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let s = 0, n = 0; for (let k = 0; k < d.length; k += 40) { s += d[k]; n++; }
    return s / n;
  });
  await preset('soft');
  const m0 = await meanOf();
  await drag(0, -120);
  const mUp = await meanOf();
  await preset('soft');
  await drag(0, 120);
  const mDown = await meanOf();
  check('dragging up brightens the image', mUp > m0 + 3,
    m0.toFixed(1) + ' -> ' + mUp.toFixed(1));
  check('dragging down darkens it', mDown < m0 - 3,
    m0.toFixed(1) + ' -> ' + mDown.toFixed(1));

  console.log('\n6. Panels and per-pane windows keep up');
  await preset('soft');
  await drag(0, 60);
  const inputs = await page.evaluate(() => [document.getElementById('windowWidth').value,
    document.getElementById('windowCenter').value, (document.querySelector('#windowPresets [data-window].on') || {dataset:{}}).dataset.window || '']);
  const cur = await wl();
  check('the Width/Level boxes track the drag',
    +inputs[0] === Math.round(cur[0]) && +inputs[1] === Math.round(cur[1]),
    inputs.slice(0, 2).join(' / ') + ' vs ' + cur.map(v => Math.round(v)).join(' / '));
  check('the preset dropdown drops back to Custom', inputs[2] === '', 'value "' + inputs[2] + '"');

  await page.evaluate(() => {
    const sel = window.__ctConsole.cellEl(1).querySelector('.vp-wl');
    sel.value = 'bone'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const globalBefore = await wl();
  const paneBox = await page.evaluate(() => {
    const r = window.__ctConsole.cellEl(1).querySelector('.vp-canvas').getBoundingClientRect();
    // Off-centre, clear of the crosshair grip, as in section 1.
    return { x: r.x + r.width * 0.3, y: r.y + r.height * 0.3 };
  });
  await page.mouse.move(paneBox.x, paneBox.y); await page.mouse.down();
  for (let k = 1; k <= 10; k++) { await page.mouse.move(paneBox.x, paneBox.y + k * 6); await page.waitForTimeout(8); }
  await page.mouse.up(); await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    global: [window.__ctConsole.state.windowWidth, window.__ctConsole.state.windowCenter],
    pane: window.__ctConsole.cellWindow(window.__ctConsole.state.cells[1]),
    sel: window.__ctConsole.cellEl(1).querySelector('.vp-wl').value,
  }));
  check('dragging a pane with its own window leaves the global one alone',
    JSON.stringify(after.global) === JSON.stringify(globalBefore),
    JSON.stringify(globalBefore) + ' -> ' + JSON.stringify(after.global));
  check('that pane\'s own level moved', after.pane.wc !== 480, 'wc ' + after.pane.wc.toFixed(1));
  check('and its preset box drops to global-custom so it can be re-picked',
    after.sel === '', 'value "' + after.sel + '"');

  console.log('\n7. No page errors');
  check('clean console', errors.length === 0, errors.slice(0, 3).join(' ;; ') || 'none');

  await browser.close();
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'All window/level checks passed') + '\n');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
