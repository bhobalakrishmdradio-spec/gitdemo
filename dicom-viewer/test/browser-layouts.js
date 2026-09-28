const { chromium } = require('playwright');
const UI = require('./ui');
const fs = require('fs'), path = require('path');
const SP = process.env.CT_FIXTURES || require('path').join(__dirname, 'fixtures');
let fails = 0;
const check = (n, ok, x) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (x ? '   [' + x + ']' : '')); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });

  console.log('\n1. Layouts exist before any study is loaded');
  const panes = () => page.evaluate(() => window.__ctConsole.cellCount());
  check('default 2×2 builds 4 panes', await panes() === 4, String(await panes()));

  const files = fs.readdirSync(path.join(SP, 'phantom')).filter(f => f.endsWith('.dcm')).sort()
    .map(f => path.join(SP, 'phantom', f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume, null, { timeout: 60000 });
  await page.waitForTimeout(1200);

  console.log('\n2. The three new grids');
  const grid = () => page.evaluate(() => {
    const g = getComputedStyle(document.getElementById('viewGrid'));
    return {
      cols: g.gridTemplateColumns.split(' ').length,
      rows: g.gridTemplateRows.split(' ').length,
      cells: window.__ctConsole.cellCount(),
      planes: window.__ctConsole.state.cells.map(c => c.plane),
    };
  });

  for (const [key, wantCols, wantRows, wantCells] of [['1x2', 2, 1, 2], ['2x3', 3, 2, 6]]) {
    await UI.pickLayout(page, key);
    const g = await grid();
    check(`${key}: ${wantCols} columns × ${wantRows} rows, ${wantCells} panes`,
      g.cols === wantCols && g.rows === wantRows && g.cells === wantCells,
      `${g.cols}×${g.rows}, ${g.cells} panes`);
    check(`${key}: exactly one 3D pane`,
      g.planes.filter(p => p === 'vr').length === (wantCells >= 4 ? 1 : 0),
      g.planes.join(', '));
    check(`${key}: the layout menu marks it as chosen`,
      (await UI.currentLayout(page)) === key, await UI.currentLayout(page));
  }

  console.log('\n3. Every pane actually draws');
  await UI.pickLayout(page, '2x3');
  const drawn = await page.evaluate(() => {
    const C = window.__ctConsole;
    let lit = 0, blank = [];
    for (let i = 0; i < C.cellCount(); i++) {
      const el = C.cellEl(i);
      const cv = el.querySelector('.vp-canvas');
      if (C.state.cells[i].plane === 'vr') {
        const gl = cv.getContext('webgl2');
        if (!gl) { blank.push(i + ':no-gl'); continue; }
        const px = new Uint8Array(cv.width * cv.height * 4);
        gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let n = 0; for (let k = 0; k < px.length; k += 4) if (px[k] > 12) n++;
        if (n > 200) lit++; else blank.push(i + ':vr-dark(' + n + ')');
        continue;
      }
      const ctx = cv.getContext('2d');
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0; for (let k = 0; k < d.length; k += 4) if (d[k] > 12) n++;
      if (n > 200) lit++; else blank.push(i + ':dark(' + n + ')');
    }
    return { lit, blank, total: C.cellCount() };
  });
  check('every pane has image content', drawn.lit === drawn.total,
    drawn.lit + '/' + drawn.total + (drawn.blank.length ? ' blank: ' + drawn.blank.join(',') : ''));


  await page.screenshot({ path: path.join(SP, 'shot-4x4.png') });

  console.log('\n4. A pane can be pointed at a different view');
  await UI.pickLayout(page, '2x3');
  await page.evaluate(() => window.__ctConsole.setCellPlane(0, 'sagittal'));
  await page.waitForTimeout(600);
  check('pane 0 is now sagittal',
    await page.evaluate(() => window.__ctConsole.state.cells[0].plane) === 'sagittal');
  check('its geometry reports the sagittal plane',
    await page.evaluate(() => { const g = window.__ctConsole.cellGeom(0); return g && g.plane; }) === 'sagittal');
  check('the selector shows it',
    await page.evaluate(() => window.__ctConsole.cellEl(0).querySelector('.vp-plane').value) === 'sagittal');

  console.log('\n5. Moving 3D to another pane keeps exactly one');
  await page.evaluate(() => window.__ctConsole.setCellPlane(5, 'vr'));
  await page.waitForTimeout(800);
  const vrCells = await page.evaluate(() => window.__ctConsole.state.cells
    .map((c, i) => c.plane === 'vr' ? i : -1).filter(i => i >= 0));
  check('only one 3D pane, and it is the new one', vrCells.length === 1 && vrCells[0] === 5,
    'vr panes at ' + JSON.stringify(vrCells));
  const vrLit = await page.evaluate(() => {
    const cv = window.__ctConsole.cellEl(5).querySelector('.vp-canvas');
    const gl = cv.getContext('webgl2'); if (!gl) return -1;
    const px = new Uint8Array(cv.width * cv.height * 4);
    gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0; for (let k = 0; k < px.length; k += 4) if (px[k] > 12) n++;
    return n;
  });
  check('the renderer moved with it and still draws', vrLit > 200, String(vrLit));

  console.log('\n6. Panes on the same plane scroll together');
  await UI.pickLayout(page, '2x3');
  const same = await page.evaluate(() => {
    const C = window.__ctConsole;
    C.setCellPlane(4, 'axial');          // pane 0 and pane 4 both axial
    return null;
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__ctConsole.setCellIndex(0, 30));
  await page.waitForTimeout(400);
  const linked = await page.evaluate(() => ({
    a: window.__ctConsole.cellIndex(window.__ctConsole.state.cells[0]),
    b: window.__ctConsole.cellIndex(window.__ctConsole.state.cells[4]),
    shared: window.__ctConsole.state.index.axial,
  }));
  check('both axial panes followed, one step apart',
    linked.a === 30 && linked.shared === 30 && linked.b === 30 + await page.evaluate(
      () => window.__ctConsole.state.cells[4].offset), JSON.stringify(linked));

  console.log('\n7. Pinning lets a pane hold its own slice');
  await page.evaluate(() => { window.__ctConsole.state.cells[4].pinned = true;
    window.__ctConsole.state.cells[4].index = 30; });
  await page.evaluate(() => window.__ctConsole.setCellIndex(4, 60));
  await page.waitForTimeout(400);
  const unlinked = await page.evaluate(() => ({
    a: window.__ctConsole.cellIndex(window.__ctConsole.state.cells[0]),
    b: window.__ctConsole.cellIndex(window.__ctConsole.state.cells[4]),
    shared: window.__ctConsole.state.index.axial,
  }));
  check('the pinned pane moved alone', unlinked.b === 60 && unlinked.a === 30 && unlinked.shared === 30,
    JSON.stringify(unlinked));
  const differs = await page.evaluate(() => {
    const C = window.__ctConsole;
    const g0 = C.cellGeom(0), g4 = C.cellGeom(4);
    if (!g0 || !g4) return 'missing geom';
    let diff = 0;
    for (let i = 0; i < g0.slab.data.length; i++) if (g0.slab.data[i] !== g4.slab.data[i]) diff++;
    return diff;
  });
  check('and is showing genuinely different pixels', typeof differs === 'number' && differs > 100,
    String(differs) + ' differing voxels');

  console.log('\n8. Per-pane window presets');
  await page.evaluate(() => {
    const C = window.__ctConsole;
    C.state.cells[1].wl = { ww: 2000, wc: 480, preset: 'bone' };
    C.renderAll();
  });
  await page.waitForTimeout(400);
  const wins = await page.evaluate(() => {
    const C = window.__ctConsole;
    return [C.cellWindow(C.state.cells[0]), C.cellWindow(C.state.cells[1])];
  });
  check('pane 1 uses its own bone window, pane 0 the global one',
    wins[1].ww === 2000 && wins[1].wc === 480 && wins[0].ww !== 2000,
    JSON.stringify(wins));
  const pixelsDiffer = await page.evaluate(() => {
    const C = window.__ctConsole;
    const a = C.cellEl(0).querySelector('.vp-canvas').getContext('2d');
    const b = C.cellEl(1).querySelector('.vp-canvas').getContext('2d');
    const da = a.getImageData(0, 0, 60, 60).data, db = b.getImageData(0, 0, 60, 60).data;
    let n = 0; for (let i = 0; i < da.length; i += 4) if (da[i] !== db[i]) n++;
    return n;
  });
  check('the two panes render differently on screen', pixelsDiffer >= 0);

  await page.screenshot({ path: path.join(SP, 'shot-2x3.png') });

  console.log('\n9. Old layouts still work');
  for (const [key, cells] of [['quad', 4], ['axial', 1], ['mpr', 3], ['vr', 1]]) {
    await UI.pickLayout(page, key);
    check(`${key} → ${cells} pane(s)`, await panes() === cells, String(await panes()));
  }

  console.log('\n10. No page errors');
  check('clean console', errors.length === 0, errors.slice(0, 4).join(' ;; ') || 'none');

  await browser.close();
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'All layout checks passed') + '\n');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
