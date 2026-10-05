/* The everyday reading workflow, against the points an external review
   raised: honest labels, segmentation separated from measurement, an empty
   state that leads with the action, independent sync switches, and spatial
   ordering that does not depend on filenames.

   The ordering check is the one with a trap in it. The phantom's files sort
   the same way by name and by position, so shuffling the input order proves
   nothing unless the names are also wrong — so this loads the slices in
   reverse and checks the reconstruction against a value that only comes out
   right when Image Position (Patient) decided the order. */
const { chromium } = require('playwright');
const UI = require('./ui');
const fs = require('fs'), path = require('path');
const SP = process.env.CT_FIXTURES || path.join(__dirname, 'fixtures');
let fails = 0;
const check = (n, ok, x) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (x ? '   [' + x + ']' : '')); if (!ok) fails++; };
const dcm = d => fs.readdirSync(path.join(SP, d)).filter(f => f.endsWith('.dcm')).sort()
  .map(f => path.join(SP, d, f));

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });

  /* =================================================================== */
  console.log('\n1. The empty viewport leads with the action');
  check('Open DICOM folder is a button, not an instruction',
    await page.isVisible('#emptyFolderBtn'));
  check('with file import offered beside it', await page.isVisible('#emptyFilesBtn'));
  check('and the supported inputs are named',
    /JPEG Lossless/i.test(await page.textContent('#viewportEmpty')),
    (await page.textContent('#viewportEmpty')).replace(/\s+/g, ' ').slice(0, 80));

  /* =================================================================== */
  console.log('\n2. Spatial order comes from the geometry, not the filenames');
  // Reversed input order. ImagePositionPatient still says which way is up.
  await page.setInputFiles('#fileInput', dcm('phantom').slice().reverse());
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const ordered = await page.evaluate(() => {
    const C = window.__ctConsole;
    const g = C.state.seriesMap[C.state.currentSeriesUID];
    const z = g.slices.map(s => s.instance.imagePositionZ);
    let rising = true;
    for (let i = 1; i < z.length; i++) if (z[i] < z[i - 1]) rising = false;
    return { n: z.length, first: z[0], last: z[z.length - 1], rising: rising,
             firstFile: g.slices[0].instance.fileName,
             depth: C.state.volume.depth, spacing: C.state.volume.spacingZ };
  });
  check('every slice is in rising patient-Z order',
    ordered.rising && ordered.first < ordered.last,
    `${ordered.first} … ${ordered.last} over ${ordered.n}`);
  check('the volume is the full stack at the stated spacing',
    ordered.depth === 96 && Math.abs(ordered.spacing - 1) < 1e-6,
    ordered.depth + ' @ ' + ordered.spacing + 'mm');
  /* The ground truth, worked out by hand. The phantom's cylinder is tilted
     30 degrees in the Y/Z plane about the centre (47.5, 63.5, 47.5), so on
     slice 20 its axis has shifted to
         y = 63.5 + (20 - 47.5) * tan 30 = 47.6
     and the voxel there is cylinder (300 HU). Assemble the stack back to
     front and the shift goes the other way, putting the axis at y = 79.4
     and leaving 47.6 in plain soft tissue (40 HU). One voxel separates a
     correctly ordered volume from a reversed one. */
  const sample = await page.evaluate(() => {
    const p = window.__ctConsole.getPlaneData('axial', 20);
    const at = (x, y) => p.data[Math.round(y) * p.width + Math.round(x)];
    return { onAxis: at(47.5, 47.6), mirrored: at(47.5, 79.4), width: p.width };
  });
  check('the tilted cylinder sits where a correctly ordered stack puts it',
    Math.abs(sample.onAxis - 300) < 1,
    'HU at the computed axis = ' + sample.onAxis + ' (want 300)');
  check('and not where a reversed stack would put it',
    Math.abs(sample.mirrored - 300) > 100,
    'HU at the mirrored position = ' + sample.mirrored + ' (want ~40)');

  /* =================================================================== */
  console.log('\n3. Labels say what the control does');
  await UI.showAllTools(page);
  const labels = await page.evaluate(() => ({
    slab: document.getElementById('thicknessValue').textContent,
    projection: [...document.querySelectorAll('#toolsScroll label')]
      .map(l => l.textContent.trim()).filter(t => /project/i.test(t))[0] || '',
    threshold: document.querySelector('#boneCutToggle').parentNode.textContent.trim(),
    headings: [...document.querySelectorAll('#toolsScroll h4')].map(h => h.textContent),
    note: document.getElementById('boneCutStatus').textContent.replace(/\s+/g, ' '),
  }));
  check('a slab of zero reads "Single slice", not "Thin"',
    labels.slab === 'Single slice', labels.slab);
  check('the projection control is called Projection',
    labels.projection === 'Projection', labels.projection);
  check('the HU threshold is not called bone removal',
    !/remove bone/i.test(labels.threshold) && /threshold/i.test(labels.headings.join(' ') + labels.note),
    labels.threshold);
  check('and it says what it really hides',
    /contrast|metal|calcification/i.test(labels.note), labels.note.slice(0, 90));
  check('the slab section is named as a reconstruction',
    labels.headings.some(h => /reconstruction slab/i.test(h)), labels.headings.join(' | '));

  await page.evaluate(() => { window.__ctConsole.state.thicknessMm = 7.5;
    document.getElementById('thicknessRange').value = '7.5';
    document.getElementById('thicknessRange').dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(250);
  check('and a slab reads in millimetres',
    /^7\.5 mm$/.test(await page.textContent('#thicknessValue')),
    await page.textContent('#thicknessValue'));
  await page.evaluate(() => { document.getElementById('thicknessRange').value = '0';
    document.getElementById('thicknessRange').dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(250);

  /* =================================================================== */
  console.log('\n4. Sculpting is segmentation, not measurement');
  check('Sculpt is no longer in the Measure menu',
    (await page.evaluate(() => !document.querySelector('#toolMenu [data-tool="sculpt"]'))));
  await UI.pickMore(page, 'segment');
  await page.waitForTimeout(300);
  check('More → Segmentation opens the workflow',
    await page.isVisible('#sculptBtn'));
  await page.click('#sculptBtn'); await page.waitForTimeout(250);
  check('and arms the brush',
    (await page.evaluate(() => window.__ctConsole.state.tool)) === 'sculpt');
  check('with the button showing it is armed',
    await page.evaluate(() => document.getElementById('sculptBtn').classList.contains('active')));
  await page.click('#sculptBtn'); await page.waitForTimeout(250);
  check('pressing it again disarms',
    (await page.evaluate(() => window.__ctConsole.state.tool)) === 'none');
  check('restoring is offered in plain words',
    /Restore all/.test(await page.textContent('#sculptClearBtn')),
    await page.textContent('#sculptClearBtn'));

  /* =================================================================== */
  console.log('\n5. Sync is three switches, not one');
  await page.reload({ waitUntil: 'networkidle' });
  await page.setInputFiles('#fileInput', dcm('series-followup'));
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  const openSync = async () => { await page.click('#linkBtn');
    await page.waitForSelector('#syncMenu:not([hidden])'); };
  const syncState = () => page.evaluate(() => ({
    position: window.__ctConsole.state.link,
    zoom: window.__ctConsole.state.linkZoom,
    window: window.__ctConsole.state.linkWindow,
    label: document.querySelector('#linkBtn .btn-label').textContent.trim(),
  }));
  let st = await syncState();
  check('position is linked by default', st.position === true, JSON.stringify(st));
  check('zoom/pan and window/level are not',
    st.zoom === false && st.window === false, JSON.stringify(st));
  check('and the button says how much is linked', st.label === 'Sync 1/3', st.label);

  await openSync();
  await page.click('#syncMenu [data-sync="zoom"]'); await page.waitForTimeout(250);
  st = await syncState();
  check('turning on zoom/pan leaves the others alone',
    st.zoom === true && st.position === true && st.window === false, JSON.stringify(st));
  await page.click('#syncMenu [data-sync="position"]'); await page.waitForTimeout(250);
  st = await syncState();
  check('and turning off position leaves zoom on',
    st.position === false && st.zoom === true, JSON.stringify(st));
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);

  /* =================================================================== */
  console.log('\n6. A comparison pane keeps its own window unless linked');
  await page.evaluate(() => { window.__ctConsole.state.link = true;
    window.__ctConsole.state.linkZoom = false; window.__ctConsole.syncSyncMenu(); });
  const win = await page.evaluate(async () => {
    const C = window.__ctConsole;
    C.compareWithPrior(null);
    await new Promise(r => setTimeout(r, 3500));
    const pane1 = C.state.cells[1];
    const uid = C.cellSeriesUid(pane1);
    const own = C.state.seriesMap[uid].slices[0].instance;
    // Give the toolbar a window nothing like the prior's own.
    C.state.windowWidth = 1500; C.state.windowCenter = -600;
    C.renderAll();
    const unlinked = C.cellWindow(pane1);
    C.state.linkWindow = true;
    C.renderAll();
    const linked = C.cellWindow(pane1);
    C.state.linkWindow = false;
    C.renderAll();
    return { ownWW: own.fileWW, ownWC: own.fileWC,
             unlinked: unlinked, linked: linked,
             pane0: C.cellWindow(C.state.cells[0]) };
  });
  check('two panes are up', !!win.unlinked && !!win.linked, JSON.stringify(win));
  check('unlinked, the prior pane uses its own series\' window',
    win.unlinked.ww === win.ownWW && win.unlinked.wc === win.ownWC,
    JSON.stringify(win.unlinked) + ' vs own ' + win.ownWW + '/' + win.ownWC);
  check('linked, it follows the toolbar instead',
    win.linked.ww === 1500 && win.linked.wc === -600, JSON.stringify(win.linked));
  check('the pane on the current series always follows the toolbar',
    win.pane0.ww === 1500 && win.pane0.wc === -600, JSON.stringify(win.pane0));

  /* =================================================================== */
  console.log('\n7. Linked zoom moves every pane, unlinked moves one');
  const zoomed = await page.evaluate(async () => {
    const C = window.__ctConsole;
    C.state.linkZoom = false;
    C.state.cells.forEach(c => { c.view.zoom = 1; c.view.panX = 0; });
    C.renderAll();
    C.state.cells[0].view.zoom = 2.2;
    C.applyLinkedView(0);
    const apart = C.state.cells.map(c => c.view.zoom);
    C.state.linkZoom = true;
    C.applyLinkedView(0);
    const together = C.state.cells.map(c => c.view.zoom);
    C.state.linkZoom = false;
    return { apart: apart, together: together };
  });
  check('unlinked, only the pane dragged changes',
    zoomed.apart[0] === 2.2 && zoomed.apart[1] === 1, JSON.stringify(zoomed.apart));
  check('linked, the others follow',
    zoomed.together.every(z => z === 2.2), JSON.stringify(zoomed.together));

  /* =================================================================== */
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nAll reading-workflow checks passed.');
  process.exit(fails ? 1 : 0);
})();
