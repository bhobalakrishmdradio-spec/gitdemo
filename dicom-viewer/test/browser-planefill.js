/* "All axial" must turn any grid into a filmstrip of that plane. */
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
  const files = fs.readdirSync(path.join(SP, 'phantom')).filter(f => f.endsWith('.dcm')).sort()
    .map(f => path.join(SP, 'phantom', f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume, null, { timeout: 60000 });
  await page.waitForTimeout(1200);

  const planes = () => page.evaluate(() => window.__ctConsole.state.cells.map(c => c.plane));
  const slices = () => page.evaluate(() => window.__ctConsole.state.cells
    .map(c => c.plane === 'vr' ? null : window.__ctConsole.cellIndex(c)));
  const distinct = () => page.evaluate(() => {
    const C = window.__ctConsole; const seen = new Set();
    for (let i = 0; i < C.cellCount(); i++) {
      if (C.state.cells[i].plane === 'vr') continue;
      const cv = C.cellEl(i).querySelector('.vp-canvas');
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let h = 0; for (let k = 0; k < d.length; k += 4) h = (Math.imul(h, 31) + d[k]) | 0;
      seen.add(h);
    }
    return seen.size;
  });
  const setFill = async (v) => { await UI.pickFill(page, v); };

  console.log('\n1. Each grid can be filled with one plane');
  for (const layout of ['2x3', 'quad', '1x2']) {
    await UI.pickLayout(page, layout);
    for (const plane of ['axial', 'coronal', 'sagittal']) {
      await setFill(plane);
      const p = await planes();
      check(`${layout} + all ${plane}: every pane is ${plane}`,
        p.length > 0 && p.every(x => x === plane), p.join(','));
    }
    await setFill('mix');
  }

  console.log('\n2. A filled grid is a filmstrip of consecutive slices');
  await UI.pickLayout(page, '2x3');
  await setFill('axial');
  const s = await slices();
  check(`${s.length} panes on ${s.length} consecutive slices`,
    s.length > 1 && s.every((v, i) => v === s[0] + i), s.join(','));
  const d = await distinct();
  check(`and they render ${s.length} distinct images`, d === s.length,
    d + ' distinct of ' + s.length);

  console.log('\n3. Scrolling pages the whole strip');
  await page.evaluate(() => {
    for (let k = 0; k < 3; k++) window.__ctConsole.cellEl(0).dispatchEvent(
      new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(600);
  const s2 = await slices();
  check('every pane advanced by 3, spacing intact',
    s2.every((v, i) => v === s[i] + 3), s2.join(','));

  console.log('\n4. The choice survives a layout change');
  await UI.pickLayout(page, '2x3');
  const p6 = await planes();
  check('switching to 2×3 keeps all-axial', p6.length === 6 && p6.every(x => x === 'axial'),
    p6.join(','));
  check('the selector still reads "All axial"',
    (await UI.currentFill(page)) === 'axial', await UI.currentFill(page));

  console.log('\n5. Layouts defined by their planes are exempt');
  await UI.pickLayout(page, 'mpr');
  check('MPR stays axial/coronal/sagittal',
    JSON.stringify(await planes()) === JSON.stringify(['axial', 'coronal', 'sagittal']),
    (await planes()).join(','));
  check('and the whole-grid plane choice is not offered there',
    !(await UI.fillEnabled(page, 'axial')));
  await UI.pickLayout(page, 'vr');
  check('the 3D layout stays 3D', JSON.stringify(await planes()) === JSON.stringify(['vr']),
    (await planes()).join(','));

  console.log('\n6. Back to mixed, and the 3D pane returns');
  await UI.pickLayout(page, 'quad');
  await setFill('mix');
  const q = await planes();
  check('2×2 mixed is the three planes plus 3D',
    JSON.stringify(q) === JSON.stringify(['axial', 'coronal', 'sagittal', 'vr']), q.join(','));
  const vrLit = await page.evaluate(() => {
    const C = window.__ctConsole;
    const i = C.state.cells.findIndex(c => c.plane === 'vr');
    if (i < 0) return -1;
    const cv = C.cellEl(i).querySelector('.vp-canvas');
    const gl = cv.getContext('webgl2'); if (!gl) return -2;
    const px = new Uint8Array(cv.width * cv.height * 4);
    gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0; for (let k = 0; k < px.length; k += 4) if (px[k] > 12) n++;
    return n;
  });
  check('the 3D renderer comes back and draws', vrLit > 200, String(vrLit));

  console.log('\n7. Changing one pane by hand makes the grid mixed again');
  await UI.pickLayout(page, '2x3');
  await setFill('axial');
  await page.evaluate(() => window.__ctConsole.setCellPlane(2, 'coronal'));
  await page.waitForTimeout(700);
  check('the selector drops back to "Mixed planes"',
    (await UI.currentFill(page)) === 'mix', await UI.currentFill(page));

  console.log('\n8. No page errors');
  check('clean console', errors.length === 0, errors.slice(0, 4).join(' ;; ') || 'none');

  await UI.pickLayout(page, '2x3');
  await setFill('axial');
  await page.screenshot({ path: path.join(SP, 'shot-filmstrip.png') });
  await browser.close();
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'All plane-fill checks passed') + '\n');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
