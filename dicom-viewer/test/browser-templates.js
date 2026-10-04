/* Templates, placeholders, and the controls asked for on the toolbar. */
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
  page.on('dialog', d => d.accept());          // confirms are answered "yes"
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });
  const files = fs.readdirSync(path.join(SP, 'phantom')).filter(f => f.endsWith('.dcm')).sort()
    .map(f => path.join(SP, 'phantom', f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume, null, { timeout: 60000 });
  await page.waitForTimeout(900);
  await page.click('#reportToggleBtn');
  await page.waitForTimeout(400);

  /* =================================================================== */
  console.log('\n1. The collection is offered, grouped by modality');
  const picker = await page.evaluate(() => {
    const sel = document.getElementById('reportTemplate');
    return {
      groups: [...sel.querySelectorAll('optgroup')].map(g => g.label),
      count: sel.querySelectorAll('option[value]:not([value=""])').length,
      labels: [...sel.querySelectorAll('option')].map(o => o.textContent),
    };
  });
  check('19 templates are listed', picker.count === 19, picker.count);
  check('grouped Any / CT / MRI',
    JSON.stringify(picker.groups) === JSON.stringify(['Any', 'CT', 'MRI']),
    picker.groups.join(','));
  check('both CTPA variants are listed separately, not merged',
    picker.labels.filter(l => /pulmonary angiogram/i.test(l)).length === 2,
    picker.labels.filter(l => /pulmonary angiogram/i.test(l)).join(' | '));
  check('the MSK pelvis template is labelled as musculoskeletal',
    picker.labels.some(l => /pelvis \(musculoskeletal\)/i.test(l)),
    picker.labels.find(l => /pelvis/i.test(l)));

  /* =================================================================== */
  console.log('\n1b. Every template in the list actually inserts');
  /* Driven one at a time through the real picker, with the fields cleared
     between each so what lands is this template's own text and not the
     previous one's left behind. */
  const all = await page.evaluate(() => window.CTTemplates.ORDER.slice());
  const inserted = [];
  for (const key of all) {
    await page.evaluate(() => {
      const C = window.__ctConsole;
      ['technique', 'comparison', 'findings', 'impression'].forEach(k => {
        C.state.report[k] = '';
      });
      // Credits accumulate by design, one per template inserted; clear them
      // so each pass through this loop is isolated and so the draft is back
      // to a clean slate for the checks that follow.
      C.state.report.credits = [];
      C.renderReport();
    });
    await page.selectOption('#reportTemplate', key);
    await page.waitForTimeout(140);
    const got = await page.evaluate(() => {
      const C = window.__ctConsole;
      return ['technique', 'comparison', 'findings', 'impression']
        .map(k => (C.state.report[k] || '').trim().length).reduce((a, b) => a + b, 0);
    });
    inserted.push({ key: key, chars: got });
  }
  const blankOnes = inserted.filter(r => r.chars === 0 && r.key !== 'blank');
  check(`all ${all.length} templates insert text`, blankOnes.length === 0,
    blankOnes.map(r => r.key).join(', ') ||
      inserted.map(r => r.key + ':' + r.chars).slice(0, 3).join(' '));
  check('and "blank" is the one that deliberately does not',
    inserted.find(r => r.key === 'blank').chars === 0);
  const distinct = new Set(inserted.filter(r => r.chars).map(r => r.chars)).size;
  check('each one inserts its own text, not a copy of the last',
    distinct >= all.length - 4, distinct + ' distinct lengths of ' + (all.length - 1));

  /* =================================================================== */
  console.log('\n1c. A control that cannot act says so instead of going quiet');
  // An empty report refuses to be finalised, and rightly, so give it a line
  // with no placeholders in it first.
  await page.evaluate(() => {
    const C = window.__ctConsole;
    ['technique', 'comparison', 'impression'].forEach(k => { C.state.report[k] = ''; });
    C.state.report.findings = 'Normal study.';
    C.state.report.credits = [];
    C.renderReport();
  });
  await page.click('#reportFinalBtn'); await page.waitForTimeout(400);
  check('it really is final now',
    (await page.evaluate(() => window.__ctConsole.state.report.status)) === 'final',
    await page.evaluate(() => window.__ctConsole.state.report.status));
  const whenFinal = await page.evaluate(() => ({
    disabled: document.getElementById('reportTemplate').disabled,
    title: document.getElementById('reportTemplate').title,
  }));
  check('a finalised report disables the picker rather than refusing silently',
    whenFinal.disabled && /reopen/i.test(whenFinal.title), JSON.stringify(whenFinal));
  await page.click('#reportFinalBtn'); await page.waitForTimeout(400);
  check('reopening enables it again',
    !(await page.evaluate(() => document.getElementById('reportTemplate').disabled)));

  /* =================================================================== */
  console.log('\n2. Inserting a template fills the sections, verbatim');
  await page.selectOption('#reportTemplate', 'mtCspine');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    technique: document.getElementById('reportTechnique').value,
    comparison: document.getElementById('reportComparison').value,
    findings: document.getElementById('reportFindings').value,
    impression: document.getElementById('reportImpression').value,
    credits: window.__ctConsole.state.report.credits,
  }));
  check('technique came through word for word',
    after.technique === 'Sagittal T1 and [T2|STIR]. Axial T2 from [C2-T1].', after.technique);
  check('comparison landed in its own section',
    after.comparison === '[No previous relevant imaging is available for comparison].',
    after.comparison);
  check('the disc levels are all there',
    ['C2/3', 'C3/4', 'C4/5', 'C5/6', 'C6/7', 'C7/T1'].every(l => after.findings.includes(l + ': []')),
    after.findings.split('\n').length + ' lines');
  check('the template credit was recorded',
    after.credits.length === 1 && /Mark Thurston/.test(after.credits[0]) &&
    /Apache-2.0/.test(after.credits[0]), after.credits[0]);

  /* =================================================================== */
  console.log('\n3. Unfilled placeholders are counted and shown');
  const warn = await page.evaluate(() => {
    // Count them straight out of the template, rather than hardcoding a
    // number this test would then be asserting against itself.
    const t = window.CTTemplates.TEMPLATES.mtCspine;
    const inTemplate = ['technique', 'comparison', 'findings', 'impression']
      .reduce((n, k) => n + window.CTTemplates.placeholdersIn(t[k]).length, 0);
    return {
      shown: !document.getElementById('placeholderWarn').hidden,
      text: document.getElementById('placeholderWarn').textContent,
      n: window.__ctConsole.openPlaceholders().length,
      inTemplate,
      techniqueHas: window.CTTemplates.placeholdersIn(t.technique).length,
    };
  });
  check('the warning is showing', warn.shown);
  check(`it counts every placeholder the template carries (${warn.inTemplate})`,
    warn.n === warn.inTemplate, warn.n + ' vs ' + warn.inTemplate);
  check('it names the sections they are in',
    /Technique/.test(warn.text) && /Findings/.test(warn.text), warn.text.slice(0, 90));

  const text = await page.evaluate(() => window.__ctConsole.reportText());
  check('the exported text lists them under a heading',
    new RegExp('UNFILLED PLACEHOLDERS \\(' + warn.inTemplate + '\\)').test(text),
    (text.match(/UNFILLED.*/) || [])[0]);
  check('the exported text carries the attribution',
    /Mark Thurston/.test(text) && /Apache-2\.0/.test(text));
  check('the exported text is still marked a draft', /\[Draft — not finalised\]/.test(text));

  /* Filling one in must drop the count. */
  await page.fill('#reportTechnique', 'Sagittal T1 and STIR. Axial T2 from C2 to T1.');
  await page.waitForTimeout(300);
  const after2 = await page.evaluate(() => window.__ctConsole.openPlaceholders().length);
  const want2 = warn.inTemplate - warn.techniqueHas;
  check(`rewriting the technique drops the count to ${want2}`, after2 === want2,
    after2 + ' vs ' + want2);

  /* =================================================================== */
  console.log('\n4. A report holding placeholders is not signed by accident');
  // Refuse the confirm this time.
  page.removeAllListeners('dialog');
  let asked = null;
  page.on('dialog', d => { asked = d.message(); d.dismiss(); });
  await page.click('#reportFinalBtn');
  await page.waitForTimeout(400);
  check('finalising asks first', !!asked && /placeholder/i.test(asked),
    (asked || '').split('\n')[0]);
  check('and names what is outstanding', /Findings: \[\]/.test(asked || ''));
  check('declining leaves it a draft',
    await page.evaluate(() => window.__ctConsole.state.report.status) === 'draft');

  // Now clear them and finalise cleanly.
  page.removeAllListeners('dialog');
  page.on('dialog', d => d.accept());
  await page.fill('#reportComparison', 'No prior imaging.');
  await page.fill('#reportFindings', 'Normal cervical spine.');
  await page.fill('#reportImpression', 'Normal study.');
  await page.waitForTimeout(350);
  check('no placeholders remain',
    await page.evaluate(() => window.__ctConsole.openPlaceholders().length) === 0);
  let unasked = true;
  page.removeAllListeners('dialog');
  page.on('dialog', d => { unasked = false; d.accept(); });
  await page.click('#reportFinalBtn');
  await page.waitForTimeout(400);
  check('a clean report finalises without being questioned', unasked);
  check('and is marked final',
    await page.evaluate(() => window.__ctConsole.state.report.status) === 'final');
  page.removeAllListeners('dialog');
  page.on('dialog', d => d.accept());
  await page.click('#reportFinalBtn');        // reopen
  await page.waitForTimeout(300);

  /* =================================================================== */
  console.log('\n5. Inserting never overwrites silently, nor finalises');
  // Type into the field, as a reader would: setting state alone would be
  // overwritten by the next read of the textareas, and would not be testing
  // what the reader can actually lose.
  await page.evaluate(() => { window.__ctConsole.state.report.status = 'draft'; });
  await page.fill('#reportFindings', 'MY OWN WORDS');
  await page.waitForTimeout(250);
  let confirmed = null;
  page.removeAllListeners('dialog');
  page.on('dialog', d => { confirmed = d.message(); d.dismiss(); });
  await page.selectOption('#reportTemplate', 'mtKnee');
  await page.waitForTimeout(400);
  check('it asks before replacing existing text', !!confirmed && /Replace/.test(confirmed),
    confirmed);
  check('declining keeps what was written',
    (await page.inputValue('#reportFindings')) === 'MY OWN WORDS',
    await page.inputValue('#reportFindings'));
  page.removeAllListeners('dialog');
  page.on('dialog', d => d.accept());

  /* =================================================================== */
  console.log('\n6. Axial / coronal / sagittal are their own buttons');
  await UI.pickLayout(page, '2x3');
  for (const fill of ['axial', 'coronal', 'sagittal']) {
    await page.click(`#planeSeg [data-fill="${fill}"]`);
    await page.waitForTimeout(700);
    const planes = await page.evaluate(() => window.__ctConsole.state.cells.map(c => c.plane));
    check(`${fill}: every pane shows it`,
      planes.length === 6 && planes.every(p => p === fill), planes.join(','));
    check(`${fill}: its button is the active one`,
      await page.evaluate(f => {
        const on = document.querySelector('#planeSeg .seg-btn.active');
        return on && on.dataset.fill === f;
      }, fill));
  }
  await page.click('#planeSeg [data-fill="mix"]');
  await page.waitForTimeout(700);
  const mixed = await page.evaluate(() => window.__ctConsole.state.cells.map(c => c.plane));
  check('Mix restores the layout\'s own arrangement', new Set(mixed).size > 1, mixed.join(','));

  await UI.pickLayout(page, 'mpr');
  check('the plane buttons are disabled where the layout defines its planes',
    await page.isDisabled('#planeSeg [data-fill="axial"]'));
  await UI.pickLayout(page, '2x3');

  /* =================================================================== */
  console.log('\n7. Stack and Sync are separate controls');
  check('the stack button says where it is', /Stack 1/.test(
    await page.textContent('#stackBtn')), await page.textContent('#stackBtn'));
  await page.click('#stackBtn');
  await page.waitForSelector('#stackMenu:not([hidden])');
  await page.click('#stackMenu [data-step="5"]');
  await page.waitForTimeout(500);
  check('choosing 5 changes the step',
    await page.evaluate(() => window.__ctConsole.state.stackStep) === 5);
  check('and the button says so', /Stack 5/.test(await page.textContent('#stackBtn')),
    await page.textContent('#stackBtn'));

  check('Sync is a button of its own', await page.isVisible('#linkBtn'));
  const syncBefore = await page.evaluate(() => window.__ctConsole.state.link);
  await page.click('#linkBtn');
  await page.waitForTimeout(250);
  const syncAfter = await page.evaluate(() => window.__ctConsole.state.link);
  check('Sync toggles independently of Stack', syncAfter === !syncBefore &&
    (await page.evaluate(() => window.__ctConsole.state.stackStep)) === 5,
    syncBefore + ' -> ' + syncAfter);
  await page.click('#linkBtn');
  await page.click('#stackBtn');
  await page.waitForSelector('#stackMenu:not([hidden])');
  await page.click('#stackMenu [data-step="1"]');
  await page.waitForTimeout(400);

  /* =================================================================== */
  console.log('\n8. The crosshair can be dragged with the cursor');
  await UI.pickLayout(page, 'mpr');
  await page.click('#planeSeg [data-fill="mix"]').catch(() => {});
  await page.waitForTimeout(600);
  const where = await page.evaluate(() => {
    const C = window.__ctConsole;
    if (!C.state.crosshair) document.getElementById('crosshairBtn').click();
    const g = C.cellGeom(0);
    const idx = C.indexRecord(C.state.currentSeriesUID);
    const w = C.crosshairWorld(g.vol, idx);
    const pp = C.worldToPlane(g.plane, g.slab, w, g.index, g.vol);
    const c = C.planeToCanvas(g.t, pp.x, pp.y);
    const r = C.cellEl(0).querySelector('canvas').getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { sx: r.left + c.x / dpr, sy: r.top + c.y / dpr,
             cor: idx.coronal, sag: idx.sagittal,
             plane: g.plane, pp, dpr,
             rl: r.left, rt: r.top, rw: r.width, rh: r.height };
  });
  check('pane 0 is axial and the crosshair is on', where.plane === 'axial');
  check('the cursor is offered as grabbable over the crosshair',
    await page.evaluate(([x, y]) =>
      !!window.__ctConsole.hitTestCrosshair(0, x, y), [where.sx, where.sy]));
  check('and not out in the corner',
    await page.evaluate(([x, y]) =>
      !window.__ctConsole.hitTestCrosshair(0, x, y), [where.rl + 6, where.rt + 6]));

  // Drag it down-right and watch the other two planes follow, continuously.
  await page.mouse.move(where.sx, where.sy);
  await page.mouse.down();
  const seen = [];
  for (const d of [12, 24, 36]) {
    await page.mouse.move(where.sx + d, where.sy + d);
    await page.waitForTimeout(90);
    seen.push(await page.evaluate(() => {
      const r = window.__ctConsole.indexRecord(window.__ctConsole.state.currentSeriesUID);
      return { cor: r.coronal, sag: r.sagittal };
    }));
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
  check('the other planes move while the button is still held',
    seen.some(s => s.cor !== where.cor) && seen.some(s => s.sag !== where.sag),
    JSON.stringify(seen));
  check('it tracks the drag rather than jumping once',
    new Set(seen.map(s => s.cor + ',' + s.sag)).size > 1, JSON.stringify(seen));
  const ended = await page.evaluate(() => {
    const r = window.__ctConsole.indexRecord(window.__ctConsole.state.currentSeriesUID);
    return { cor: r.coronal, sag: r.sagittal };
  });
  check('and it stays where it was dropped',
    ended.cor !== where.cor && ended.sag !== where.sag,
    `${where.cor},${where.sag} -> ${ended.cor},${ended.sag}`);

  // A plain drag away from the crosshair must still be window/level.
  const ww0 = await page.evaluate(() => window.__ctConsole.state.windowWidth);
  const corner = { x: where.rl + where.rw * 0.12, y: where.rt + where.rh * 0.12 };
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 60, corner.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  check('a drag away from the crosshair is still window/level',
    (await page.evaluate(() => window.__ctConsole.state.windowWidth)) !== ww0,
    ww0 + ' -> ' + (await page.evaluate(() => window.__ctConsole.state.windowWidth)));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nAll template and control checks passed');
  process.exit(fails ? 1 : 0);
})();
