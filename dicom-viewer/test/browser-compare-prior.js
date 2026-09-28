/* One button, and the prior scan is beside the current one.

   The fixture scans one patient three times with a lesion that grows, and a
   second patient on the same dates. So a comparison that picks the wrong
   study shows the wrong lesion size, and one that picks the wrong patient
   is caught outright — which is the failure that matters. */
const { chromium } = require('playwright');
const UI = require('./ui');
const fs = require('fs'), path = require('path');
const SP = process.env.CT_FIXTURES || require('path').join(__dirname, 'fixtures');
let fails = 0;
const check = (n, ok, x) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (x ? '   [' + x + ']' : '')); if (!ok) fails++; };
const near = (a, b, t) => Math.abs(a - b) <= t;

/* What make_followup.py wrote. */
const LESION = { x: 78.0, y: 54.0, z: 40.0 };
const SIZES = { '20240311': 8.0, '20250602': 14.0, '20260920': 22.0 };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });

  const files = fs.readdirSync(path.join(SP, 'series-followup')).filter(f => f.endsWith('.dcm'))
    .sort().map(f => path.join(SP, 'series-followup', f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 90000 });
  await page.waitForTimeout(2500);

  /* =================================================================== */
  console.log('\n1. Five studies load, two patients');
  const loaded = await page.evaluate(() => {
    const C = window.__ctConsole;
    const seen = {};
    C.state.seriesOrder.forEach(u => {
      const g = C.state.seriesMap[u];
      seen[g.studyUID] = { date: g.studyDate, key: C.patientKeyOf(g) };
    });
    return { studies: Object.keys(seen).length,
             patients: [...new Set(Object.values(seen).map(s => s.key))] };
  });
  check('all five studies are grouped', loaded.studies === 5, loaded.studies);
  check('and two distinct patients are recognised', loaded.patients.length === 2,
    loaded.patients.join(' | '));

  /* Put the 2026 study of FUP001 on screen as the current one. */
  const currentUid = await page.evaluate(() => {
    const C = window.__ctConsole;
    const hit = C.state.seriesOrder.find(u => {
      const g = C.state.seriesMap[u];
      return g.studyDate === '20260920' && /PORTAL/.test(g.description || '') &&
             C.patientKeyOf(g) === 'id:FUP001';
    });
    C.selectSeries(hit);
    return hit;
  });
  await page.waitForTimeout(3000);
  check('the 2026 portal-venous series is current', !!currentUid);

  /* =================================================================== */
  console.log('\n2. Only this patient\'s own studies are offered as priors');
  const priors = await page.evaluate(() => window.__ctConsole.priorStudies()
    .map(p => ({ date: p.date, n: p.series.length })));
  check('two priors are offered', priors.length === 2,
    priors.map(p => p.date).join(', '));
  check('they are this patient\'s 2025 and 2024 studies',
    priors[0].date === '20250602' && priors[1].date === '20240311',
    priors.map(p => p.date).join(', '));
  check('newest prior first', priors[0].date > priors[1].date);

  /* The safety-critical one. The other patient was scanned on the very
     same dates, so a match on date alone would pick them up. */
  const leaked = await page.evaluate(() => {
    const C = window.__ctConsole;
    return C.priorStudies().some(p => p.series.some(g => C.patientKeyOf(g) !== 'id:FUP001'));
  });
  check('the OTHER patient is never offered, despite sharing both dates', !leaked);

  /* =================================================================== */
  console.log('\n3. One press opens the prior beside the current study');
  await page.click('#compareBtn');
  await page.waitForTimeout(4000);

  const laid = await page.evaluate(() => {
    const C = window.__ctConsole;
    const info = (i) => {
      const uid = C.cellSeriesUid(C.state.cells[i]);
      const g = C.state.seriesMap[uid] || {};
      return { uid, date: g.studyDate, desc: g.description, plane: C.state.cells[i].plane,
               depth: (C.cellVolume(C.state.cells[i]) || {}).depth };
    };
    return { panes: C.cellCount(), link: C.state.link, a: info(0), b: info(1) };
  });
  check('two panes', laid.panes === 2, laid.panes);
  check('the left pane is the current 2026 study', laid.a.date === '20260920', laid.a.date);
  check('the right pane is the 2025 prior', laid.b.date === '20250602', laid.b.date);
  check('both are axial', laid.a.plane === 'axial' && laid.b.plane === 'axial',
    laid.a.plane + '/' + laid.b.plane);
  check('sync was turned on', laid.link === true);

  /* The scout is short and useless; picking it would look like it worked. */
  check('it picked each study\'s diagnostic series, not its scout',
    /PORTAL/.test(laid.a.desc) && /PORTAL/.test(laid.b.desc),
    laid.a.desc + ' | ' + laid.b.desc);
  check('so the right pane has a real stack, not three slices',
    laid.b.depth >= 20, laid.b.depth + ' slices');

  /* Two panes of the same patient with the same series description are
     told apart by their date and nothing else. */
  const overlays = await page.evaluate(() => {
    const C = window.__ctConsole;
    return [0, 1].map(i => C.cellEl(i).querySelector('.vp-tr').textContent);
  });
  check('each pane shows its own study date',
    /2026-09-20/.test(overlays[0]) && /2025-06-02/.test(overlays[1]),
    overlays.join(' || ').replace(/\n/g, ' / '));
  check('and the prior pane is marked as the prior',
    /prior/i.test(overlays[1]) && !/prior/i.test(overlays[0]),
    overlays[1].replace(/\n/g, ' / '));

  check('the status line names both studies and their dates',
    /2026/.test(await page.textContent('#statusText')) &&
    /2025/.test(await page.textContent('#statusText')),
    await page.textContent('#statusText'));

  /* =================================================================== */
  console.log('\n4. The two panes show the same anatomy, not the same slice number');
  /* The studies start at different z and use different slice thickness, so
     index-linking lands somewhere else entirely. Drive the crosshair onto
     the lesion in the current study and read both panes. */
  await page.evaluate(([L]) => {
    const C = window.__ctConsole, V = window.CTVolume;
    const g = C.cellGeom(0);
    const local = V.fromPatient(g.vol, [L.x, L.y, L.z]);
    C.setCellIndex(0, C.indicesFromWorld(local, g.vol).axial);
  }, [LESION]);
  await page.waitForTimeout(600);

  const onLesion = await page.evaluate(([L]) => {
    const C = window.__ctConsole, V = window.CTVolume;
    const g0 = C.cellGeom(0);
    const local = V.fromPatient(g0.vol, [L.x, L.y, L.z]);
    const pp = C.worldToPlane(g0.plane, g0.slab, local, g0.index, g0.vol);
    const c = C.planeToCanvas(g0.t, pp.x, pp.y);
    const r = C.cellEl(0).querySelector('canvas').getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x: r.left + c.x / dpr, y: r.top + c.y / dpr };
  }, [LESION]);

  await page.evaluate(() => window.__ctConsole.setTool('crosshair'));
  const start = await page.evaluate(() => {
    const r = window.__ctConsole.cellEl(0).querySelector('canvas').getBoundingClientRect();
    return { x: r.left + r.width * 0.2, y: r.top + r.height * 0.2 };
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(onLesion.x, onLesion.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(700);

  const both = await page.evaluate(([L]) => {
    const C = window.__ctConsole, V = window.CTVolume;
    return [0, 1].map(i => {
      const g = C.cellGeom(i);
      const uid = C.cellSeriesUid(C.state.cells[i]);
      const date = (C.state.seriesMap[uid] || {}).studyDate;
      const world = C.crosshairWorld(g.vol, C.indexRecord(uid));
      const at = V.toPatient(g.vol, world);
      const pp = C.worldToPlane(g.plane, g.slab, world, g.index, g.vol);
      const px = Math.floor(pp.x), py = Math.floor(pp.y);
      const inside = px >= 0 && py >= 0 && px < g.slab.width && py < g.slab.height;
      // Measure the lesion across the row through the crosshair.
      let run = 0;
      if (inside) {
        for (let x = px; x < g.slab.width && g.slab.data[py * g.slab.width + x] > 120; x++) run++;
        for (let x = px - 1; x >= 0 && g.slab.data[py * g.slab.width + x] > 120; x--) run++;
      }
      return { date, index: g.index, depth: g.vol.depth,
               dist: Math.hypot(at[0] - L.x, at[1] - L.y, at[2] - L.z),
               value: inside ? g.slab.data[py * g.slab.width + px] : null,
               widthMm: run * g.slab.spacingX };
    });
  }, [LESION]);

  both.forEach(p => {
    check(`${p.date}: the crosshair is on the lesion, within a slice`,
      p.dist <= 3.0, p.dist.toFixed(2) + ' mm');
    check(`${p.date}: and the pixel under it is lesion, not liver`,
      p.value !== null && p.value > 120, String(p.value));
  });

  /* The slice indices must differ — if they matched, index-linking would
     have worked by accident and this proves nothing. */
  check('the two panes are on different slice numbers, as they must be',
    both[0].index !== both[1].index,
    `${both[0].date} slice ${both[0].index} of ${both[0].depth}, ` +
    `${both[1].date} slice ${both[1].index} of ${both[1].depth}`);

  /* And the lesion really is a different size in each, which is the whole
     point of putting them side by side. */
  check(`the 2026 lesion measures about ${SIZES['20260920']} mm`,
    near(both[0].widthMm, SIZES['20260920'], 3), both[0].widthMm.toFixed(1) + ' mm');
  check(`the 2025 lesion measures about ${SIZES['20250602']} mm`,
    near(both[1].widthMm, SIZES['20250602'], 3), both[1].widthMm.toFixed(1) + ' mm');
  check('so the comparison shows growth, not the same image twice',
    both[0].widthMm > both[1].widthMm + 4,
    both[1].widthMm.toFixed(1) + ' mm -> ' + both[0].widthMm.toFixed(1) + ' mm');

  /* =================================================================== */
  console.log('\n5. The older prior can be chosen instead');
  const older = await page.evaluate(() => window.__ctConsole.priorStudies()[1].uid);
  await page.evaluate((u) => window.__ctConsole.compareWithPrior(u), older);
  await page.waitForTimeout(4000);
  const swapped = await page.evaluate(() => {
    const C = window.__ctConsole;
    const uid = C.cellSeriesUid(C.state.cells[1]);
    return (C.state.seriesMap[uid] || {}).studyDate;
  });
  check('the right pane now holds the 2024 study', swapped === '20240311', swapped);

  /* =================================================================== */
  console.log('\n6. It says so when there is nothing to compare with');
  await page.reload({ waitUntil: 'networkidle' });
  const only = files.filter(f => /FUP001_20260920/.test(f));
  await page.setInputFiles('#fileInput', only);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 60000 });
  await page.waitForTimeout(2000);
  check('with one study open, no priors are offered',
    (await page.evaluate(() => window.__ctConsole.priorStudies().length)) === 0);
  await page.click('#compareBtn');
  await page.waitForTimeout(500);
  check('pressing Compare explains what to do rather than doing nothing',
    /prior/i.test(await page.textContent('#toast')),
    await page.textContent('#toast'));
  check('and the layout was left alone',
    (await page.evaluate(() => window.__ctConsole.cellCount())) !== 2,
    await page.evaluate(() => window.__ctConsole.cellCount()) + ' panes');

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nAll prior-comparison checks passed');
  process.exit(fails ? 1 : 0);
})();
