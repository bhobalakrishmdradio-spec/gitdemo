/* Three claims, on a real multi-sequence MR study:

   · each sequence is laid out in the plane it was acquired in;
   · dragging the + puts every sequence on the same anatomy;
   · the screenshot button produces an image that actually contains the
     pixels on screen.

   The fixture writes one bright marker at a known patient coordinate into
   all four sequences, so "the same anatomy" is a thing that can be measured
   rather than eyeballed. */
const { chromium } = require('playwright');
const UI = require('./ui');
const fs = require('fs'), path = require('path');
const SP = process.env.CT_FIXTURES || require('path').join(__dirname, 'fixtures');
let fails = 0;
const check = (n, ok, x) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (x ? '   [' + x + ']' : '')); if (!ok) fails++; };
const near = (a, b, t) => Math.abs(a - b) <= t;

/* The fixture's own numbers, so the test asserts against the data, not
   against the viewer's opinion of it. */
const MARK = [78.0, 46.0, 62.0];
const MARK_R = 9.0;
const EXPECTED = { 'SAG T1': 'sagittal', 'SAG T2 FS': 'sagittal',
                   'AX T2': 'axial', 'COR STIR': 'coronal' };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 },
    acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });

  const files = fs.readdirSync(path.join(SP, 'series-mrstudy')).filter(f => f.endsWith('.dcm'))
    .sort().map(f => path.join(SP, 'series-mrstudy', f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 90000 });
  await page.waitForTimeout(1500);

  /* =================================================================== */
  console.log('\n1. Four sequences, and the viewer knows how each was taken');
  const series = await page.evaluate(() => {
    const C = window.__ctConsole;
    return C.state.seriesOrder.map(u => ({
      uid: u, desc: C.state.seriesMap[u].description,
      n: C.state.seriesMap[u].slices.length,
    }));
  });
  check('all four series loaded as one study', series.length === 4,
    series.map(s => s.desc + '(' + s.n + ')').join(' | '));

  for (const s of series) {
    const plane = await page.evaluate(async (uid) => {
      const C = window.__ctConsole;
      C.setCellSeries(0, uid);
      await new Promise(r => setTimeout(r, 2200));
      return C.nativePlaneOf(uid);
    }, s.uid);
    const want = EXPECTED[s.desc.trim()];
    check(`${s.desc.trim()}: acquired ${want}`, plane === want, plane);
  }
  await page.evaluate(() => window.__ctConsole.setCellSeries(0, ''));
  await page.waitForTimeout(600);

  /* =================================================================== */
  console.log('\n2. Seq lays the sections out one sequence per pane');
  // Whether Seq is even offered depends on how many series are loaded, so
  // check it came alive on loading the study rather than on the next layout
  // change — it did not, once.
  check('Seq is enabled as soon as a multi-series study is open',
    !(await page.isDisabled('#planeSeg [data-fill="seq"]')));
  await UI.pickLayout(page, 'quad');
  await page.click('#planeSeg [data-fill="seq"]');
  await page.waitForTimeout(9000);          // four volumes get reconstructed
  const laid = await page.evaluate(() => {
    const C = window.__ctConsole;
    return C.state.cells.map((c, i) => {
      const uid = C.cellSeriesUid(c);
      return { plane: c.plane, uid,
               desc: (C.state.seriesMap[uid] || {}).description,
               native: C.nativePlaneOf(uid) };
    });
  });
  check('every pane has a different sequence',
    new Set(laid.map(c => c.uid)).size === 4, laid.map(c => c.desc).join(' | '));
  check('no pane is left on the 3D view', laid.every(c => c.plane !== 'vr'),
    laid.map(c => c.plane).join(','));
  laid.forEach(c => {
    check(`${(c.desc || '?').trim()} is shown ${c.native}, as acquired`,
      c.plane === c.native, c.plane + ' vs ' + c.native);
  });
  check('the Seq button is the active one',
    await page.evaluate(() => {
      const on = document.querySelector('#planeSeg .seg-btn.active');
      return on && on.dataset.fill === 'seq';
    }));

  /* =================================================================== */
  console.log('\n3. Moving the + puts every sequence on the same anatomy');
  // Arm the crosshair tool and drag onto the marker in whichever pane is axial.
  await page.click('#crosshairBtn');
  await page.waitForTimeout(300);
  check('the crosshair button arms the tool',
    await page.evaluate(() => window.__ctConsole.state.tool === 'crosshair'));
  check('the Measure button does not claim to hold it',
    /Measure/.test(await page.textContent('#toolMoreBtn')) &&
    !(await page.evaluate(() => document.getElementById('toolMoreBtn').classList.contains('active'))),
    await page.textContent('#toolMoreBtn'));

  const axialPane = laid.findIndex(c => c.native === 'axial');
  check('one of the panes is the axial sequence', axialPane >= 0, axialPane);

  /* Put the crosshair on the marker: work out where the marker's patient
     coordinate falls in that pane, and drag there. */
  const target = await page.evaluate(([i, mark]) => {
    const C = window.__ctConsole, V = window.CTVolume;
    const g = C.cellGeom(i);
    const local = V.fromPatient(g.vol, mark);
    // Bring that pane to the marker's own slice first.
    const want = C.indicesFromWorld(local, g.vol);
    C.setCellIndex(i, want[g.plane]);
    return { local, plane: g.plane };
  }, [axialPane, MARK]);
  await page.waitForTimeout(700);

  const at = await page.evaluate(([i, mark]) => {
    const C = window.__ctConsole, V = window.CTVolume;
    const g = C.cellGeom(i);
    const local = V.fromPatient(g.vol, mark);
    const pp = C.worldToPlane(g.plane, g.slab, local, g.index, g.vol);
    const c = C.planeToCanvas(g.t, pp.x, pp.y);
    const r = C.cellEl(i).querySelector('canvas').getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x: r.left + c.x / dpr, y: r.top + c.y / dpr };
  }, [axialPane, MARK]);

  // Drag the crosshair there (start elsewhere in the pane, so it is a drag).
  const start = await page.evaluate((i) => {
    const r = window.__ctConsole.cellEl(i).querySelector('canvas').getBoundingClientRect();
    return { x: r.left + r.width * 0.2, y: r.top + r.height * 0.2 };
  }, axialPane);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(at.x, at.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(700);

  /* Now: in every pane, is the crosshair sitting on the marker? Measured by
     reading the pixel value the crosshair points at in each sequence. */
  const hits = await page.evaluate(([mark, r]) => {
    const C = window.__ctConsole, V = window.CTVolume;
    const out = [];
    for (let i = 0; i < C.cellCount(); i++) {
      const g = C.cellGeom(i);
      if (!g || !g.vol) continue;
      const uid = g.uid;
      const idx = C.indexRecord(uid);
      const world = C.crosshairWorld(g.vol, idx);
      const patient = V.toPatient(g.vol, world);
      const dist = Math.hypot(patient[0] - mark[0], patient[1] - mark[1],
                              patient[2] - mark[2]);
      // What the pane is actually showing at the crosshair.
      const pp = C.worldToPlane(g.plane, g.slab, world, g.index, g.vol);
      const px = Math.floor(pp.x), py = Math.floor(pp.y);
      const inside = px >= 0 && py >= 0 && px < g.slab.width && py < g.slab.height;
      out.push({
        desc: (C.state.seriesMap[uid] || {}).description,
        plane: g.plane, dist,
        value: inside ? g.slab.data[py * g.slab.width + px] : null,
      });
    }
    return out;
  }, [MARK, MARK_R]);

  /* With every pane on the same anatomy, no pane should be claiming to be
     outside the series: comparing slice Z alone made a correctly linked
     axial pane read "off by 57.4 mm" whenever the current series was
     sagittal, because a sagittal stack's slices all share one Z. */
  const warned = await page.evaluate(() => {
    const C = window.__ctConsole;
    return C.state.cells.map((c, i) => ({
      desc: (C.state.seriesMap[C.cellSeriesUid(c)] || {}).description,
      gap: C.linkGapFor(c),
    })).filter(x => x.gap);
  });
  check('no pane is wrongly flagged as outside the series',
    warned.length === 0, warned.map(w => w.desc + ': ' + w.gap).join(' | '));

  hits.forEach(h => {
    check(`${(h.desc || '?').trim()} (${h.plane}): crosshair is within a slice of the marker`,
      h.dist <= 6.5, h.dist.toFixed(2) + ' mm');
    check(`${(h.desc || '?').trim()}: and the pixel under it is the marker, not background`,
      h.value !== null && h.value >= 900, String(h.value));
  });

  /* =================================================================== */
  console.log('\n4. The screenshot button produces a real image');
  /* Press the real button for the pane shot, and the real menu item for the
     grid: a screenshot feature reached only from a test hook is not one. */
  const shot = async (scope) => {
    const press = scope === 'pane'
      ? () => page.click('#shotBtn')
      : () => UI.pickMore(page, 'shotGrid');
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      press(),
    ]);
    const to = path.join(SP, 'shot-out-' + scope + '.png');
    await dl.saveAs(to);
    return { name: dl.suggestedFilename(), path: to, size: fs.statSync(to).size };
  };

  check('the screenshot button is on the toolbar', await page.isVisible('#shotBtn'));
  const one = await shot('pane');
  check('pressing it downloads a .png', /\.png$/.test(one.name), one.name);
  /* The name must describe the pane it came from — both halves. Taking the
     plane from the active pane and the description from whichever series is
     merely "current" produces a confidently wrong filename. */
  const activeDesc = await page.evaluate(() => {
    const C = window.__ctConsole;
    const cell = C.state.cells[C.state.activeCell];
    const uid = C.cellSeriesUid(cell);
    return { plane: cell.plane,
             desc: (C.state.seriesMap[uid] || {}).description.trim() };
  });
  check('the filename names the active pane\'s own plane',
    one.name.indexOf('-' + activeDesc.plane + '-') > 0,
    one.name + ' (pane is ' + activeDesc.plane + ')');
  check("the filename names the active pane's own series, not another one",
    one.name.indexOf(activeDesc.desc.replace(/[^\w-]+/g, '_')) > 0,
    one.name + ' (pane shows ' + activeDesc.desc + ')');
  check('the file is a real PNG, not an empty one', one.size > 3000, one.size + ' bytes');

  const all = await shot('grid');
  check('saving all panes downloads a .png', /\.png$/.test(all.name), all.name);
  check('the grid shot is named as the grid', /-grid-/.test(all.name), all.name);
  check('and is bigger than one pane', all.size > one.size,
    all.size + ' vs ' + one.size + ' bytes');

  /* Is the image actually the pixels on screen? Compare the canvas the
     viewer composed against what the pane holds — a black rectangle would
     download happily and pass every check above. */
  const pixels = await page.evaluate(() => {
    const C = window.__ctConsole;
    const read = (canvas) => {
      const c = document.createElement('canvas');
      c.width = 160; c.height = 160;
      const x = c.getContext('2d');
      x.drawImage(canvas, 0, 0, 160, 160);
      const d = x.getImageData(0, 0, 160, 160).data;
      let lit = 0, sum = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i] > 12) lit++; sum += d[i]; }
      return { lit, mean: sum / (d.length / 4) };
    };
    return { pane: read(C.buildScreenshot('pane')), grid: read(C.buildScreenshot('grid')) };
  });
  check('the pane screenshot is not a black rectangle',
    pixels.pane.lit > 1500, pixels.pane.lit + ' lit of 25600, mean ' + pixels.pane.mean.toFixed(1));
  check('the grid screenshot is not a black rectangle',
    pixels.grid.lit > 1500, pixels.grid.lit + ' lit of 25600, mean ' + pixels.grid.mean.toFixed(1));

  /* The overlays must be in the image, since that is the point of capturing
     the view rather than the raw slice. */
  const hasOverlay = await page.evaluate(() => {
    const C = window.__ctConsole;
    const shot = C.buildScreenshot('pane');
    const x = shot.getContext('2d');
    const d = x.getImageData(0, 0, shot.width, shot.height).data;
    // The crosshair is drawn in yellow (r high, g high, b low); the image
    // itself is greyscale, so any such pixel can only be an overlay.
    let coloured = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 120 && d[i + 1] > 90 && d[i + 2] < d[i] - 50) coloured++;
    }
    return coloured;
  });
  check('the overlays are burned into the screenshot', hasOverlay > 50,
    hasOverlay + ' overlay pixels');

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nAll MR-study and screenshot checks passed');
  process.exit(fails ? 1 : 0);
})();
