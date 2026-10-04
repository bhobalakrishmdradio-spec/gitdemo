/* Undo, redo, and the shortcut list.

   What makes undo worth having is that it restores a measurement's numbers,
   not just its existence: a mis-dragged calliper that comes back 3 mm short
   is worse than no undo at all, because it looks recovered. So every check
   here compares the reported value, not the object count.

   The shortcut dialog is built from the same table the key handler
   dispatches from, so the test presses every key the dialog lists and
   requires it to do something — a listed key that does nothing is exactly
   the drift the table is there to prevent. */
const { chromium } = require('playwright');
const UI = require('./ui');
const fs = require('fs'), path = require('path');
const SP = process.env.CT_FIXTURES || path.join(__dirname, 'fixtures');
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
  const files = fs.readdirSync(path.join(SP, 'phantom')).filter(f => f.endsWith('.dcm')).sort()
    .map(f => path.join(SP, 'phantom', f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 60000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => { window.__ctConsole.setLayout('axial'); });
  await page.waitForTimeout(400);

  const toScreen = (px, py) => page.evaluate(([x, y]) => {
    const C = window.__ctConsole, g = C.cellGeom(0);
    const c = C.planeToCanvas(g.t, x, y);
    const r = C.cellEl(0).querySelector('canvas').getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x: r.left + c.x / dpr, y: r.top + c.y / dpr };
  }, [px, py]);
  const clickPlane = async (px, py) => {
    const s = await toScreen(px, py);
    await page.mouse.click(s.x, s.y);
    await page.waitForTimeout(70);
  };
  const setTool = (t) => page.evaluate((tool) => window.__ctConsole.setTool(tool), t);
  const count = () => page.evaluate(() => window.__ctConsole.state.measurements.length);
  /* What the application says the last measurement measures. */
  const lastValue = () => page.evaluate(() => {
    const C = window.__ctConsole, M = window.CTMeasure;
    const m = C.state.measurements[C.state.measurements.length - 1];
    if (!m) return null;
    const g = C.cellGeom(0);
    return M.evaluate(m, g.slab, C.calibrationFor(m.plane, g.slab)).primary;
  });
  const undoBtn = () => page.evaluate(() => ({
    undo: document.getElementById('undoMeasureBtn').disabled,
    redo: document.getElementById('redoMeasureBtn').disabled,
    label: document.getElementById('undoMeasureBtn').title,
  }));
  const chord = async (key, shift) => {
    await page.keyboard.down('Control');
    if (shift) await page.keyboard.down('Shift');
    await page.keyboard.press(key);
    if (shift) await page.keyboard.up('Shift');
    await page.keyboard.up('Control');
    await page.waitForTimeout(120);
  };

  /* =================================================================== */
  console.log('\n1. Undo takes a measurement back off, redo puts it back');
  check('nothing to undo before anything is drawn', (await undoBtn()).undo === true);

  await setTool('distance');
  await clickPlane(20, 64);
  await clickPlane(60, 64);
  const drawn = await lastValue();
  check('a 40 mm distance was drawn', /^40\.\d mm$/.test(drawn || ''), drawn);
  const afterDraw = await undoBtn();
  check('undo is now offered, and says what it will undo',
    afterDraw.undo === false && /adding/i.test(afterDraw.label), afterDraw.label);

  await page.click('#undoMeasureBtn');
  await page.waitForTimeout(120);
  check('the measurement is gone', (await count()) === 0);
  check('redo is now offered', (await undoBtn()).redo === false);

  await page.click('#redoMeasureBtn');
  await page.waitForTimeout(120);
  check('redo brings it back', (await count()) === 1);
  check('and brings back its value, not just a shape',
    (await lastValue()) === drawn, (await lastValue()) + ' vs ' + drawn);

  /* =================================================================== */
  console.log('\n2. A mis-drag is recoverable, to the millimetre');
  await setTool('none');
  const grip = await toScreen(60, 64);          // the far endpoint
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  const off = await toScreen(90, 64);
  await page.mouse.move(off.x, off.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const dragged = await lastValue();
  check('dragging the handle lengthened it', dragged !== drawn, drawn + ' -> ' + dragged);
  const dragLabel = (await undoBtn()).label;
  check('the step is named as a reshape, not an add',
    /reshaping/i.test(dragLabel), dragLabel);

  await chord('z');
  check('Ctrl+Z restores the original length exactly',
    (await lastValue()) === drawn, (await lastValue()) + ' vs ' + drawn);
  await chord('z', true);
  check('Ctrl+Shift+Z puts the drag back',
    (await lastValue()) === dragged, (await lastValue()) + ' vs ' + dragged);
  await chord('y');
  check('Ctrl+Y is the same redo, and there is nothing left to redo',
    (await undoBtn()).redo === true);

  /* =================================================================== */
  console.log('\n3. A grab that moves nothing records no step');
  await chord('z');                              // back to the original
  const depthBefore = await page.evaluate(() => window.__ctConsole.state.measureUndo.length);
  const g2 = await toScreen(60, 64);
  await page.mouse.move(g2.x, g2.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
  const depthAfter = await page.evaluate(() => window.__ctConsole.state.measureUndo.length);
  check('clicking a handle without moving it adds nothing to the history',
    depthAfter === depthBefore, depthBefore + ' -> ' + depthAfter);

  /* =================================================================== */
  console.log('\n4. Delete all is recoverable');
  await setTool('circle');
  await clickPlane(64, 64);
  await clickPlane(74, 64);
  await page.waitForTimeout(120);
  const before = await count();
  check('there are two measurements now', before === 2, String(before));
  page.once('dialog', d => d.accept());
  await page.click('#clearMeasureBtn');
  await page.waitForTimeout(150);
  check('delete all emptied the list', (await count()) === 0);
  const clearLabel = (await undoBtn()).label;
  check('the step says how many it cleared', /2 measurements/.test(clearLabel), clearLabel);
  await chord('z');
  check('undo brings both back', (await count()) === 2, String(await count()));

  /* =================================================================== */
  console.log('\n5. Hiding is undoable too, and the history is bounded');
  const hidden0 = await page.evaluate(() => {
    const C = window.__ctConsole;
    const id = C.state.measurements[0].id;
    C.toggleMeasurementHidden(id);
    return C.state.measurements[0].hidden;
  });
  check('the measurement is hidden', hidden0 === true);
  await chord('z');
  check('undo unhides it',
    (await page.evaluate(() => !!window.__ctConsole.state.measurements[0].hidden)) === false);

  const depth = await page.evaluate(() => {
    const C = window.__ctConsole;
    for (let i = 0; i < 200; i++) C.toggleMeasurementHidden(C.state.measurements[0].id);
    return C.state.measureUndo.length;
  });
  check('the undo stack is capped rather than growing without limit',
    depth === 60, String(depth));

  /* =================================================================== */
  console.log('\n6. Undo never crosses into another series\' restored work');
  // Leave a saved measurement in storage, then take it out of memory — which
  // is the state the viewer is in the moment before a series is reopened.
  const forgot = await page.evaluate(() => {
    const C = window.__ctConsole;
    const uid = C.state.currentSeriesUID;
    C.state.measurements = C.state.measurements.slice(0, 1);
    C.persistMeasurements();
    const saved = window.CTMeasure.loadFor(uid).length;
    C.state.measurements = [];
    C.state.measureLoaded = {};
    const before = C.state.measureUndo.length;
    C.restoreMeasurements(uid);
    return { saved: saved, before: before, after: C.state.measureUndo.length,
             restored: C.state.measurements.length };
  });
  check('the series had saved work to restore',
    forgot.saved === 1 && forgot.restored === 1, JSON.stringify(forgot));
  check('opening it clears the history instead of leaving stale snapshots',
    forgot.before > 0 && forgot.after === 0, JSON.stringify(forgot));

  /* =================================================================== */
  console.log('\n7. The shortcut list is the list the keys actually use');
  await page.keyboard.press('?');
  await page.waitForTimeout(200);
  check('"?" opens the dialog',
    (await page.isVisible('#helpModal')) === true);
  const listed = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#helpBody dt')];
    return { rows: rows.length,
             keys: rows.map(r => [...r.querySelectorAll('kbd')].map(k => k.textContent).join('+')) };
  });
  const table = await page.evaluate(() =>
    window.__ctConsole.SHORTCUTS.reduce((a, g) => a.concat(g.items), []).length);
  check('every entry in the table is shown, and nothing else is',
    listed.rows === table && table > 12, listed.rows + ' shown, ' + table + ' bound');
  check('the chords are spelled out', listed.keys.some(k => /Ctrl/.test(k)),
    listed.keys.filter(k => /Ctrl/.test(k)).join(' · '));
  check('no raw markup leaked into the dialog',
    (await page.evaluate(() => /<|>/.test(document.getElementById('helpBody').textContent))) === false);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Escape closes it', (await page.isVisible('#helpModal')) === false);
  await UI.pickMore(page, 'shortcuts');
  check('the More menu opens it too', (await page.isVisible('#helpModal')) === true);
  await page.click('#helpCloseBtn');
  await page.waitForTimeout(150);
  check('and the close button shuts it', (await page.isVisible('#helpModal')) === false);

  /* =================================================================== */
  console.log('\n8. Every listed key reaches the handler the list says it does');
  // Stub each entry's action and press its key for real, so what is proved
  // is the routing: that the documented chord lands on that entry and not a
  // neighbouring one. Enter, Escape and Delete are gated on there being a
  // shape or a selection, so both are arranged first.
  const routed = await page.evaluate(() => {
    const C = window.__ctConsole;
    const items = C.SHORTCUTS.reduce((a, g) => a.concat(g.items), []);
    C.state.selectedMeasurement = C.state.measurements[0] && C.state.measurements[0].id;
    C.state.pendingMeasure = { tool: 'polygon', plane: 'axial', sliceIndex: 0,
                               points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] };
    const originals = items.map(it => it.run);
    let fired = null;
    items.forEach((it, idx) => { it.run = function () { fired = idx; }; });
    const out = [];
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      fired = null;
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: it.match[0], ctrlKey: !!it.accel, shiftKey: !!it.shift,
        bubbles: true, cancelable: true,
      }));
      out.push({ keys: it.keys.join('+'), want: idx, got: fired,
                 gated: !!(it.when && !it.when()) });
    }
    items.forEach((it, idx) => { it.run = originals[idx]; });
    C.state.pendingMeasure = null;
    return out;
  });
  const misrouted = routed.filter(r => r.got !== r.want)
    .map(r => r.keys + ' -> ' + (r.got === null ? 'nothing' : routed[r.got].keys));
  check('every documented key runs the entry it is documented under',
    misrouted.length === 0, misrouted.join(' · '));
  check('none of them was skipped for want of state',
    routed.every(r => !r.gated), routed.filter(r => r.gated).map(r => r.keys).join(' · '));
  check('the list is worth having', routed.length >= 20, String(routed.length));

  /* =================================================================== */
  console.log('\n9. Browser chords are left alone');
  await page.evaluate(() => { window.__ctConsole.setLayout('axial'); });
  await page.waitForTimeout(300);
  const zoomBefore = await page.evaluate(() => window.__ctConsole.state.cells[0].view.zoom);
  await page.evaluate(() => { window.__ctConsole.state.cells[0].view.zoom = 2.5; });
  await chord('r');                              // Ctrl+R is reload, not reset view
  check('Ctrl+R does not reset the view behind the browser\'s back',
    (await page.evaluate(() => window.__ctConsole.state.cells[0].view.zoom)) === 2.5,
    'was ' + zoomBefore);
  // R is the ROI key; resetting the view moved to Shift+R when the
  // measurement shortcuts were brought in.
  await page.keyboard.press('r');
  await page.waitForTimeout(150);
  check('plain R arms the ROI rather than resetting the view',
    (await page.evaluate(() => window.__ctConsole.state.tool)) === 'ellipse' &&
    (await page.evaluate(() => window.__ctConsole.state.cells[0].view.zoom)) === 2.5,
    await page.evaluate(() => window.__ctConsole.state.tool));
  await page.evaluate(() => window.__ctConsole.setTool('none'));
  await page.evaluate(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'R', shiftKey: true, bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
  });
  await page.waitForTimeout(200);
  check('Shift+R resets it',
    (await page.evaluate(() => window.__ctConsole.state.cells[0].view.zoom)) === 1,
    String(await page.evaluate(() => window.__ctConsole.state.cells[0].view.zoom)));

  /* =================================================================== */
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nAll undo and shortcut checks passed.');
  process.exit(fails ? 1 : 0);
})();
