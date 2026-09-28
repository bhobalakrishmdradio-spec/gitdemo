/* Hand sculpting, and cine playback. */
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
  page.on('dialog', d => d.accept());
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });
  const files = fs.readdirSync(path.join(SP, 'series-raw')).filter(f => f.endsWith('.dcm')).sort()
    .map(f => path.join(SP, 'series-raw', f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await UI.pickLayout(page, 'axial');

  const atPixel = (px, py) => page.evaluate(([px, py]) => {
    const C = window.__ctConsole; const g = C.cellGeom(0);
    const c = C.planeToCanvas(g.t, px, py);
    const cv = C.cellEl(0).querySelector('.vp-canvas'); const r = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x: r.x + c.x / dpr, y: r.y + c.y / dpr };
  }, [px, py]);
  // Count how much of the plane is showing air (i.e. cut away).
  const airCount = () => page.evaluate(() => {
    const C = window.__ctConsole, V = window.CTVolume;
    const s = C.getPlaneData('axial', C.state.index.axial, C.state.volume);
    let n = 0; for (let i = 0; i < s.data.length; i++) if (s.data[i] <= V.AIR_HU) n++;
    return n;
  });

  console.log('\n1. Sculpting removes tissue where you drag');
  const before = await airCount();
  await UI.pickTool(page, 'sculpt');
  const a = await atPixel(40, 48), b = await atPixel(56, 48);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  for (let k = 1; k <= 8; k++) {
    await page.mouse.move(a.x + (b.x - a.x) * k / 8, a.y);
    await page.waitForTimeout(30);
  }
  await page.mouse.up(); await page.waitForTimeout(600);
  const after = await airCount();
  check('the sculpted region reads as air', after > before + 100,
    before + ' → ' + after + ' air pixels');
  check('the viewer knows something is cut',
    await page.evaluate(() => window.__ctConsole.cutActive()));

  console.log('\n2. It does not touch the source data');
  const raw = await page.evaluate(() => {
    const C = window.__ctConsole;
    const vol = C.state.volume;
    const stride = vol.cols * vol.rows;
    const z = C.state.index.axial;
    // The voxel under the middle of the stroke, read straight from the volume.
    return vol.data[z * stride + 48 * vol.cols + 48];
  });
  check('the underlying voxel still holds its original value', raw > -900,
    'stored value ' + raw);

  console.log('\n3. Undo puts it back');
  await page.click('#sculptUndoBtn'); await page.waitForTimeout(600);
  const undone = await airCount();
  check('one undo restores the stroke', undone === before, undone + ' vs ' + before);
  check('undo is disabled once the stack is empty',
    await page.isDisabled('#sculptUndoBtn'));

  console.log('\n4. Clear removes all sculpting');
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(600);
  check('sculpted again', (await airCount()) > before + 50);
  await page.click('#sculptClearBtn'); await page.waitForTimeout(600);
  check('clear restores everything', (await airCount()) === before);
  check('and the viewer reports nothing cut',
    !(await page.evaluate(() => window.__ctConsole.cutActive())));
  await UI.pickTool(page, 'none');

  console.log('\n5. Sculpting reaches the 3D view');
  await UI.pickLayout(page, 'quad');
  check('switching back to 2×2 still has a 3D pane',
    await page.evaluate(() => window.__ctConsole.state.cells.some(c => c.plane === 'vr')),
    await page.evaluate(() => window.__ctConsole.state.cells.map(c => c.plane).join(',')));
  const lit = () => page.evaluate(() => {
    const C = window.__ctConsole;
    const i = C.state.cells.findIndex(c => c.plane === 'vr');
    if (i < 0) return -1;
    const cv = C.cellEl(i).querySelector('.vp-canvas');
    const gl = cv.getContext('webgl2'); if (!gl) return -1;
    const px = new Uint8Array(cv.width * cv.height * 4);
    gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0; for (let k = 0; k < px.length; k += 4) if (px[k] > 12) n++;
    return n;
  });
  const lit0 = await lit();
  // Sculpt with the real gesture, so the texture invalidation is exercised
  // too — calling the function directly would skip it.
  await page.evaluate(() => { window.__ctConsole.state.sculptRadius = 25; });
  await UI.pickTool(page, 'sculpt');
  const qBox = await page.evaluate(() => {
    const r = window.__ctConsole.cellEl(0).querySelector('.vp-canvas').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width };
  });
  await page.mouse.move(qBox.x - qBox.w * 0.15, qBox.y); await page.mouse.down();
  for (let k = 1; k <= 8; k++) {
    await page.mouse.move(qBox.x - qBox.w * 0.15 + qBox.w * 0.3 * k / 8, qBox.y);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await page.waitForTimeout(2200);
  const lit1 = await lit();
  check('the 3D render changes after a cut', lit1 !== lit0, lit0 + ' → ' + lit1 + ' lit pixels');
  await UI.pickTool(page, 'none');
  await page.evaluate(() => window.__ctConsole.clearSculpt());
  await page.waitForTimeout(1200);

  console.log('\n6. Cine plays through the stack');
  await UI.pickLayout(page, 'axial');
  await page.evaluate(() => window.__ctConsole.setCellIndex(0, 2));
  await page.waitForTimeout(300);
  const startIdx = await page.evaluate(() => window.__ctConsole.state.index.axial);
  await page.click('#cineBtn'); await page.waitForTimeout(900);
  const midIdx = await page.evaluate(() => window.__ctConsole.state.index.axial);
  check('the slice advances while playing', midIdx > startIdx, startIdx + ' → ' + midIdx);
  check('the button shows it is playing',
    (await page.textContent('#cineBtn')) === '⏸');
  await page.click('#cineBtn'); await page.waitForTimeout(500);
  const stopped = await page.evaluate(() => window.__ctConsole.state.index.axial);
  await page.waitForTimeout(700);
  check('pausing stops it',
    (await page.evaluate(() => window.__ctConsole.state.index.axial)) === stopped);

  console.log('\n7. Reverse and loop');
  await page.click('#cineDirBtn'); await page.waitForTimeout(150);
  const beforeRev = await page.evaluate(() => window.__ctConsole.state.index.axial);
  await page.click('#cineBtn'); await page.waitForTimeout(800);
  await page.click('#cineBtn'); await page.waitForTimeout(300);
  const afterRev = await page.evaluate(() => window.__ctConsole.state.index.axial);
  check('reverse plays backwards', afterRev < beforeRev, beforeRev + ' → ' + afterRev);
  await page.click('#cineDirBtn');
  await page.click('#cineLoopBtn'); await page.waitForTimeout(150);
  await page.evaluate(() => window.__ctConsole.setCellIndex(0, 22));
  await page.waitForTimeout(300);
  await page.click('#cineBtn'); await page.waitForTimeout(1200);
  check('with loop off it stops at the end and resets the button',
    (await page.textContent('#cineBtn')) === '▶' &&
    (await page.evaluate(() => window.__ctConsole.state.index.axial)) === 23,
    'index ' + (await page.evaluate(() => window.__ctConsole.state.index.axial)));
  await page.click('#cineLoopBtn');

  console.log('\n8. No page errors');
  check('clean console', errors.length === 0, errors.slice(0, 4).join(' ;; ') || 'none');

  await browser.close();
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'All sculpt / cine checks passed') + '\n');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
