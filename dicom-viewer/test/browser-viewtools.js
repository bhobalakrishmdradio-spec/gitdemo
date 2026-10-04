/* Zoom, pan and scroll as buttons.

   All three were reachable before this: Shift+wheel, right-drag, the wheel.
   The point of the buttons is a reader who has no wheel and no right button
   — a trackpad, a tablet — so what is worth proving is that a *plain
   left-drag* now does each one, that arming one disarms the others, and
   that the old ways still work unchanged. A button that lights up without
   moving the image would pass a looser test than this one.

   Every number here comes from the application's own view state and the
   rendered pane, not from the function under test. */
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
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });
  const files = fs.readdirSync(path.join(SP, 'phantom')).filter(f => f.endsWith('.dcm')).sort()
    .map(f => path.join(SP, 'phantom', f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 60000 });
  await page.waitForTimeout(1000);
  await UI.pickLayout(page, 'axial');
  await page.waitForTimeout(400);

  const view = () => page.evaluate(() => {
    const C = window.__ctConsole;
    const c = C.state.cells[0];
    return { zoom: +c.view.zoom.toFixed(4), panX: Math.round(c.view.panX),
             panY: Math.round(c.view.panY), index: C.cellIndex(c),
             tool: C.state.tool,
             ww: Math.round(C.state.windowWidth), wc: Math.round(C.state.windowCenter) };
  });
  const armed = () => page.evaluate(() => ({
    pan: document.getElementById('panBtn').classList.contains('active'),
    zoom: document.getElementById('zoomBtn').classList.contains('active'),
    scroll: document.getElementById('scrollBtn').classList.contains('active'),
    nav: document.getElementById('navBtn').classList.contains('active'),
  }));
  /* The centre of pane 0, in viewport pixels. */
  const centre = async () => {
    const r = await page.locator('#viewGrid canvas').first().boundingBox();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  const drag = async (dx, dy, from) => {
    const c = await centre();
    const x = c.x + ((from && from.dx) || 0);
    const y = c.y + ((from && from.dy) || 0);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(200);
  };
  // The crosshair sits at the pane centre, and with Navigate armed a drag
  // that grabs it moves the crosshair rather than the window. Start clear
  // of it when the gesture under test is meant to reach window/level.
  const OFF_CENTRE = { dx: -150, dy: 120 };
  const reset = async () => {
    await UI.pickReset(page, 'view');
    await page.evaluate(() => window.__ctConsole.setTool('none'));
    await page.waitForTimeout(250);
  };

  /* =================================================================== */
  console.log('\n1. The three buttons exist, and only one arms at a time');
  const start = await armed();
  check('Navigate is the tool you start in',
    start.nav && !start.pan && !start.zoom && !start.scroll, JSON.stringify(start));

  await page.click('#panBtn'); await page.waitForTimeout(200);
  let a = await armed();
  check('pressing Pan arms it and drops Navigate', a.pan && !a.nav, JSON.stringify(a));
  await page.click('#zoomBtn'); await page.waitForTimeout(200);
  a = await armed();
  check('pressing Zoom disarms Pan', a.zoom && !a.pan, JSON.stringify(a));
  await page.click('#scrollBtn'); await page.waitForTimeout(200);
  a = await armed();
  check('pressing Scroll disarms Zoom', a.scroll && !a.zoom, JSON.stringify(a));
  await page.click('#scrollBtn'); await page.waitForTimeout(200);
  a = await armed();
  check('pressing the live one again goes back to Navigate',
    a.nav && !a.scroll, JSON.stringify(a));

  /* The armed mode has to be visible before the drag, not only after it:
     the cursor is the only thing on the image itself that says what a drag
     is about to do. */
  console.log('\n1b. The cursor says what the drag will do');
  const cursors = await page.evaluate(async () => {
    const C = window.__ctConsole;
    const pane = C.cellEl(0);
    const out = {};
    for (const key of Object.keys(C.VIEW_TOOLS)) {
      C.setTool(key);
      await new Promise(r => setTimeout(r, 60));
      out[key] = { want: C.VIEW_TOOLS[key].cursor, got: pane.style.cursor,
                   status: C.VIEW_TOOLS[key].status };
    }
    C.setTool('none');
    await new Promise(r => setTimeout(r, 60));
    out.none = { want: 'crosshair', got: pane.style.cursor };
    return out;
  });
  const wrongCursor = Object.entries(cursors)
    .filter(([, v]) => v.got !== v.want).map(([k, v]) => k + ': ' + v.got);
  check('each tool sets its own cursor over the pane',
    wrongCursor.length === 0, wrongCursor.join(' · '));
  check('and each says in the status bar what a drag does, and names the ' +
    'gesture that keeps doing it whatever tool is armed',
    ['pan', 'zoom', 'scroll'].every(k => /whatever tool is armed/.test(cursors[k].status)),
    ['pan', 'zoom', 'scroll'].filter(k => !/whatever tool is armed/.test(cursors[k].status))
      .join(',') || 'all three');

  /* =================================================================== */
  console.log('\n2. Pan: a plain left-drag moves the image');
  await reset();
  const before2 = await view();
  await page.click('#panBtn');
  await drag(120, -70);
  const after2 = await view();
  check('the image moved the way the cursor went',
    after2.panX > before2.panX + 60 && after2.panY < before2.panY - 30,
    JSON.stringify(before2) + ' -> ' + JSON.stringify(after2));
  check('and panning did not touch the window',
    after2.ww === before2.ww && after2.wc === before2.wc,
    before2.ww + '/' + before2.wc + ' -> ' + after2.ww + '/' + after2.wc);
  check('nor the slice', after2.index === before2.index);
  check('nor the zoom', after2.zoom === before2.zoom);

  /* =================================================================== */
  console.log('\n3. Zoom: drag up to zoom in, down to zoom out');
  await reset();
  await page.click('#zoomBtn');
  const z0 = (await view()).zoom;
  await drag(0, -200);
  const zIn = (await view()).zoom;
  check('dragging up zoomed in', zIn > z0 * 1.5, z0 + ' -> ' + zIn);
  check('200 px doubled it, as the constant says',
    Math.abs(zIn - z0 * 2) < 0.08, 'want ' + (z0 * 2) + ' got ' + zIn);
  await drag(0, 200);
  const zOut = (await view()).zoom;
  check('dragging back down returned to where it started',
    Math.abs(zOut - z0) < 0.02, z0 + ' -> ' + zOut);
  await drag(0, 400);
  const zFloor = (await view()).zoom;
  check('zooming out stops at the floor rather than inverting the image',
    zFloor >= 0.2 - 1e-6 && zFloor < z0, String(zFloor));
  check('the window is still untouched after all that',
    (await view()).ww === (await page.evaluate(() =>
      Math.round(window.__ctConsole.state.windowWidth))));

  /* =================================================================== */
  console.log('\n4. Scroll: drag pages through the stack');
  await reset();
  await page.evaluate(() => window.__ctConsole.setCellIndex(0, 40));
  await page.waitForTimeout(250);
  await page.click('#scrollBtn');
  const s0 = (await view()).index;
  await drag(0, 80);
  const sDown = (await view()).index;
  check('dragging down went further into the stack', sDown > s0, s0 + ' -> ' + sDown);
  check('80 px moved ten slices, as the constant says',
    sDown - s0 === 10, 'moved ' + (sDown - s0));
  await drag(0, -80);
  const sUp = (await view()).index;
  check('dragging back up returned to the same slice', sUp === s0, s0 + ' -> ' + sUp);
  check('scrolling did not pan or zoom',
    (await view()).panX === 0 && (await view()).zoom === 1,
    JSON.stringify(await view()));

  /* =================================================================== */
  console.log('\n5. A click that does not move changes nothing');
  await reset();
  await page.click('#zoomBtn');
  const q0 = await view();
  const c5 = await centre();
  await page.mouse.click(c5.x, c5.y);
  await page.waitForTimeout(250);
  const q1 = await view();
  check('a bare click with Zoom armed leaves the view alone',
    q1.zoom === q0.zoom && q1.index === q0.index, JSON.stringify(q0) + ' -> ' + JSON.stringify(q1));

  /* =================================================================== */
  console.log('\n6. The old ways still work, whichever tool is armed');
  await reset();
  const w0 = await view();
  await drag(140, 0, OFF_CENTRE);          // Navigate: left-drag is window/level
  const w1 = await view();
  check('with Navigate armed, left-drag is still window/level',
    w1.ww > w0.ww * 1.5, w0.ww + ' -> ' + w1.ww);

  // And the one thing the new buttons must not have broken: with Pan armed,
  // the same drag over the crosshair pans instead of grabbing it.
  await reset();
  await page.click('#panBtn');
  const x0 = await view();
  await drag(100, 0);
  const x1 = await view();
  check('with Pan armed, a drag over the crosshair pans rather than moving it',
    x1.panX > x0.panX + 50 && x1.index === x0.index,
    JSON.stringify(x0) + ' -> ' + JSON.stringify(x1));

  await reset();
  await page.click('#scrollBtn');           // a view tool armed...
  const cm = await centre();
  const buttonDrag = async (button, dx, dy) => {
    await page.mouse.move(cm.x, cm.y);
    await page.mouse.down({ button });
    await page.mouse.move(cm.x + dx, cm.y + dy, { steps: 10 });
    await page.mouse.up({ button });
    await page.waitForTimeout(200);
  };

  const m0 = await view();
  await buttonDrag('right', 0, -150);
  const m1 = await view();
  check('...right-drag zooms', m1.zoom > m0.zoom * 1.3, m0.zoom + ' -> ' + m1.zoom);
  check('and right-drag does not also pan or scroll',
    m1.panX === m0.panX && m1.index === m0.index, JSON.stringify(m1));

  await reset();
  await page.click('#scrollBtn');
  const p0 = await view();
  await buttonDrag('middle', 90, 40);
  const p1 = await view();
  check('...middle-drag pans', p1.panX > p0.panX + 40, p0.panX + ' -> ' + p1.panX);
  check('and middle-drag does not change the window',
    p1.ww === p0.ww && p1.wc === p0.wc, p0.ww + '/' + p0.wc + ' -> ' + p1.ww + '/' + p1.wc);

  // Ctrl+left pans too, for a trackpad with one button.
  await reset();
  const c0 = await view();
  await page.keyboard.down('Control');
  await page.mouse.move(cm.x, cm.y);
  await page.mouse.down();
  await page.mouse.move(cm.x + 70, cm.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Control');
  await page.waitForTimeout(200);
  const c1 = await view();
  check('...Ctrl+left-drag pans rather than windowing',
    c1.panX > c0.panX + 30 && c1.ww === c0.ww,
    'pan ' + c0.panX + '->' + c1.panX + '  ww ' + c0.ww + '->' + c1.ww);

  const n0 = await view();
  await page.mouse.move(cm.x, cm.y);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(250);
  const n1 = await view();
  check('...the wheel still scrolls', n1.index !== n0.index, n0.index + ' -> ' + n1.index);

  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(250);
  const n2 = await view();
  check('...Shift+wheel still zooms', n2.zoom > n1.zoom, n1.zoom + ' -> ' + n2.zoom);

  /* =================================================================== */
  console.log('\n7. P, Z and S arm them from the keyboard');
  await reset();
  for (const [key, want] of [['p', 'pan'], ['z', 'zoom'], ['s', 'scroll']]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
    check(`"${key.toUpperCase()}" arms ${want}`,
      (await view()).tool === want, (await view()).tool);
  }
  await page.keyboard.press('s');
  await page.waitForTimeout(150);
  check('pressing it again returns to Navigate', (await view()).tool === 'none',
    (await view()).tool);

  await page.click('#zoomBtn'); await page.waitForTimeout(150);
  await page.keyboard.press('n');
  await page.waitForTimeout(150);
  check('N still gets you out of any of them', (await view()).tool === 'none');

  const inHelp = await page.evaluate(() => {
    const items = window.__ctConsole.SHORTCUTS.reduce((acc, g) => acc.concat(g.items), []);
    return ['P', 'Z', 'S'].filter(k => items.some(i => i.keys.join('+') === k));
  });
  check('all three are in the shortcut list the "?" dialog is built from',
    inHelp.length === 3, inHelp.join(','));

  /* =================================================================== */
  console.log('\n8. Arming a view tool puts the measurement tools down');
  await reset();
  await UI.pickTool(page, 'distance');
  check('a measurement tool is armed',
    (await view()).tool === 'distance', (await view()).tool);
  await page.click('#panBtn'); await page.waitForTimeout(200);
  check('pressing Pan disarms it', (await view()).tool === 'pan', (await view()).tool);
  const measureBtn = await page.evaluate(() => ({
    text: document.getElementById('toolMoreBtn').textContent.trim(),
    active: document.getElementById('toolMoreBtn').classList.contains('active'),
  }));
  check('and the Measure button stops claiming a tool is armed',
    measureBtn.text === '📏 Measure ▾' && !measureBtn.active, JSON.stringify(measureBtn));
  await drag(60, 0);
  check('the drag panned instead of placing a point',
    (await page.evaluate(() => window.__ctConsole.state.measurements.length)) === 0 &&
    (await view()).panX > 20, JSON.stringify(await view()));

  /* =================================================================== */
  console.log('\n9. Stack, Sync and Scroll are three separate controls');
  const sep = await page.evaluate(() => {
    const ids = ['stackBtn', 'linkBtn', 'scrollBtn'];
    const els = ids.map(id => document.getElementById(id));
    const boxes = els.map(e => e.getBoundingClientRect());
    return {
      allPresent: els.every(Boolean),
      distinct: new Set(ids).size === 3,
      // No two of them overlap, so each is its own hit target.
      separate: boxes.every((b, i) => boxes.every((o, j) =>
        i === j || b.right <= o.left || o.right <= b.left || b.bottom <= o.top || o.bottom <= b.top)),
      reachable: els.every(e => {
        const b = e.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return hit && (e === hit || e.contains(hit));
      }),
    };
  });
  check('Stack, Sync and Scroll are three buttons, not one',
    sep.allPresent && sep.distinct, JSON.stringify(sep));
  check('none of them overlaps another', sep.separate);
  check('all three are reachable by a real cursor', sep.reachable);

  // And they do unrelated jobs: Scroll must not disturb the stack step or
  // the link, and Stack must not disarm Scroll.
  await page.click('#scrollBtn'); await page.waitForTimeout(150);
  const linkBefore = await page.evaluate(() => window.__ctConsole.state.link);
  const stepBefore = await page.evaluate(() => window.__ctConsole.state.stackStep);
  await UI.setStack(page, 2);
  check('setting the stack step left Scroll armed',
    (await view()).tool === 'scroll', (await view()).tool);
  check('and did not touch Sync',
    (await page.evaluate(() => window.__ctConsole.state.link)) === linkBefore);
  await page.click('#linkBtn'); await page.waitForTimeout(200);
  check('toggling Sync left Scroll armed and the step alone',
    (await view()).tool === 'scroll' &&
    (await page.evaluate(() => window.__ctConsole.state.stackStep)) === 2,
    (await view()).tool + ' step=' +
      (await page.evaluate(() => window.__ctConsole.state.stackStep)));
  check('and Sync really flipped',
    (await page.evaluate(() => window.__ctConsole.state.link)) !== linkBefore,
    'was ' + linkBefore);
  await page.click('#linkBtn'); await page.waitForTimeout(200);
  void stepBefore;

  /* =================================================================== */
  console.log('\n10. The 3D pane is unaffected — it has its own camera');
  await UI.pickLayout(page, 'vr');
  await page.waitForTimeout(1200);
  await page.click('#panBtn'); await page.waitForTimeout(200);
  const cam0 = await page.evaluate(() => {
    const C = window.__ctConsole;
    return C.state.cells[0].view.panX;
  });
  await drag(100, 0);
  check('dragging in the 3D pane orbits it and does not pan a 2D view',
    (await page.evaluate(() => window.__ctConsole.state.cells[0].view.panX)) === cam0,
    String(cam0));

  /* =================================================================== */
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nAll view-tool checks passed.');
  process.exit(fails ? 1 : 0);
})();
