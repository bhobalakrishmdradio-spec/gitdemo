/* Report drafting, and the rule that a report never follows you to another study. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const SP = process.env.CT_FIXTURES || require('path').join(__dirname, 'fixtures');
let fails = 0;
const check = (n, ok, x) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (x ? '   [' + x + ']' : '')); if (!ok) fails++; };

const load = async (page, dir) => {
  const files = fs.readdirSync(path.join(SP, dir)).filter(f => f.endsWith('.dcm')).sort()
    .map(f => path.join(SP, dir, f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForTimeout(2600);
};
const pickSeries = async (page, needle) => page.evaluate((needle) => {
  const C = window.__ctConsole;
  const uid = C.state.seriesOrder.find(u => (C.state.seriesMap[u].description || '').includes(needle));
  if (!uid) return null;
  document.querySelectorAll('.series-head, .thumb-grid').length;
  C.selectSeries(uid);
  return uid;
}, needle);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });

  console.log('\n1. The panel opens and fills in the study identity');
  await load(page, 'series-raw');
  await page.click('#reportToggleBtn'); await page.waitForTimeout(400);
  check('panel is visible', await page.isVisible('#reportFindings'));
  const header = (await page.textContent('#reportHeader')).replace(/\s+/g, ' ');
  check('header carries patient, ID and modality',
    /CODEC/.test(header) && /COD001/.test(header) && /CT/.test(header), header.slice(0, 90));

  console.log('\n2. Typing a draft saves it');
  await page.fill('#reportHistory', '58M, fall, headache.');
  await page.fill('#reportFindings', 'No acute intracranial haemorrhage.');
  await page.fill('#reportImpression', 'Normal study.');
  await page.waitForTimeout(1200);
  const stored = await page.evaluate(() => {
    const C = window.__ctConsole;
    return JSON.parse(localStorage.getItem('ctconsole.report.' + C.state.reportStudyUid) || 'null');
  });
  check('the draft is in local storage',
    stored && stored.findings === 'No acute intracranial haemorrhage.' &&
    stored.impression === 'Normal study.', stored ? Object.keys(stored).join(',') : 'null');
  check('the status line says it saved',
    /saved/.test(await page.textContent('#reportStatus')), await page.textContent('#reportStatus'));

  console.log('\n3. A report never follows you to another study');
  const ctUid = await page.evaluate(() => window.__ctConsole.state.reportStudyUid);
  await load(page, 'series-mr');
  await page.waitForTimeout(800);
  const afterSwitch = await page.evaluate(() => ({
    uid: window.__ctConsole.state.reportStudyUid,
    findings: document.getElementById('reportFindings').value,
    history: document.getElementById('reportHistory').value,
    header: document.getElementById('reportHeader').textContent.replace(/\s+/g, ' '),
  }));
  check('the report is now bound to the new study', afterSwitch.uid !== ctUid && !!afterSwitch.uid,
    afterSwitch.uid === ctUid ? 'still the old study!' : 'rebound');
  check('the new study starts with an empty report',
    afterSwitch.findings === '' && afterSwitch.history === '',
    JSON.stringify([afterSwitch.history, afterSwitch.findings]));
  check('the header shows the new patient', /MR\^PHANTOM|MR PHANTOM/.test(afterSwitch.header),
    afterSwitch.header.slice(0, 80));

  console.log('\n4. Going back restores that study\'s own draft');
  await page.evaluate((uid) => {
    const C = window.__ctConsole;
    const target = C.state.seriesOrder.find(u =>
      C.state.seriesMap[u].slices[0].instance.studyUID === uid);
    C.selectSeries(target);
  }, ctUid);
  await page.waitForTimeout(1500);
  const back = await page.evaluate(() => ({
    uid: window.__ctConsole.state.reportStudyUid,
    findings: document.getElementById('reportFindings').value,
    history: document.getElementById('reportHistory').value,
  }));
  check('the CT study is current again', back.uid === ctUid);
  check('its draft came back intact',
    back.findings === 'No acute intracranial haemorrhage.' && back.history === '58M, fall, headache.',
    JSON.stringify(back.findings));

  console.log('\n5. Templates');
  await page.selectOption('#reportTemplate', 'ctHead');
  await page.waitForTimeout(600);
  const tpl = await page.evaluate(() => ({
    technique: document.getElementById('reportTechnique').value,
    findings: document.getElementById('reportFindings').value,
    history: document.getElementById('reportHistory').value,
  }));
  check('a template fills technique, findings and impression',
    /Non-contrast/.test(tpl.technique) && /Brain parenchyma/.test(tpl.findings),
    tpl.technique);
  check('but leaves the clinical history alone', tpl.history === '58M, fall, headache.',
    tpl.history);

  console.log('\n6. Key images');
  await page.click('#reportGrabBtn'); await page.waitForTimeout(600);
  const keys = await page.evaluate(() => {
    const k = window.__ctConsole.state.report.keyImages;
    return { n: k.length, caption: k[0] && k[0].caption, isImage: !!(k[0] && /^data:image\//.test(k[0].thumb)) };
  });
  check('a key image is attached with a caption', keys.n === 1 && keys.isImage, keys.caption);
  check('the caption names the plane and slice', /Axial slice \d+ \/ \d+/.test(keys.caption || ''),
    keys.caption);
  check('and it shows in the panel', (await page.locator('.key-thumb').count()) === 1);

  console.log('\n7. The exported text reads as a report');
  const text = await page.evaluate(() => {
    const C = window.__ctConsole, R = window.CTReport;
    return R.format([['Patient', 'CODEC^PHANTOM'], ['Patient ID', 'COD001'], ['Modality', 'CT']],
      C.state.report);
  });
  check('it has the study header', /Patient: CODEC\^PHANTOM/.test(text));
  check('sections appear in reading order',
    text.indexOf('CLINICAL HISTORY') < text.indexOf('TECHNIQUE') &&
    text.indexOf('TECHNIQUE') < text.indexOf('FINDINGS') &&
    text.indexOf('FINDINGS') < text.indexOf('IMPRESSION'));
  check('key images are listed', /KEY IMAGES/.test(text) && /Axial slice/.test(text));
  check('an unfinalised report says so', /\[Draft — not finalised\]/.test(text),
    text.split('\n').slice(-2).join(' | '));

  console.log('\n8. Finalise locks it, reopening unlocks');
  await page.click('#reportFinalBtn'); await page.waitForTimeout(500);
  check('status reads Final', (await page.textContent('#reportStatus')).includes('Final'));
  check('the fields are read-only',
    await page.evaluate(() => document.getElementById('reportFindings').readOnly));
  check('the button offers to reopen',
    (await page.textContent('#reportFinalBtn')).includes('Reopen'));
  await page.click('#reportFinalBtn'); await page.waitForTimeout(500);
  check('reopening makes it editable again',
    !(await page.evaluate(() => document.getElementById('reportFindings').readOnly)));

  console.log('\n9. A draft survives a reload, and can be deleted');
  await page.reload({ waitUntil: 'networkidle' });
  const survived = await page.evaluate((uid) =>
    JSON.parse(localStorage.getItem('ctconsole.report.' + uid) || 'null'), ctUid);
  // Step 5 replaced the findings with the CT head template, so that is what
  // should have survived — along with the history the template left alone.
  check('the draft is still stored after a reload',
    survived && /Brain parenchyma/.test(survived.findings) &&
    survived.history === '58M, fall, headache.',
    survived ? survived.findings.split('\n')[0] : 'gone');
  await load(page, 'series-raw');
  await page.click('#reportToggleBtn'); await page.waitForTimeout(400);
  await page.click('#reportClearBtn'); await page.waitForTimeout(600);
  const gone = await page.evaluate((uid) => localStorage.getItem('ctconsole.report.' + uid), ctUid);
  check('deleting removes it from storage', gone === null, String(gone));
  check('and clears the fields',
    (await page.inputValue('#reportFindings')) === '');

  console.log('\n10. Measurements go into Findings as text, appended');
  // A fresh study, a real measurement, then the button a reader presses.
  await page.evaluate(() => { window.__ctConsole.setLayout('axial'); });
  await page.waitForTimeout(500);
  const placed = await page.evaluate(() => {
    const C = window.__ctConsole, M = window.CTMeasure;
    const g = C.cellGeom(0);
    const m = M.createMeasurement(M.TOOLS.distance, g.plane,
      g.index, [{ x: 20, y: 40 }, { x: 60, y: 40 }], { seriesUid: g.uid });
    C.state.measurements.push(m);
    C.renderAll();
    return M.evaluate(m, g.slab, C.calibrationFor(m.plane, g.slab)).primary;
  });
  await page.fill('#reportFindings', 'No acute intracranial abnormality.');
  await page.waitForTimeout(250);
  await page.click('#reportMeasureBtn');
  await page.waitForTimeout(500);
  const findings = await page.inputValue('#reportFindings');
  check('the reader\'s own sentence is still there',
    /No acute intracranial abnormality\./.test(findings), findings.slice(0, 60));
  check('the measurement was appended with its value',
    findings.indexOf(placed) > findings.indexOf('No acute'),
    placed + ' in: ' + findings.replace(/\n/g, ' | ').slice(0, 140));
  check('each line says which plane, slice and series it came from',
    /\(axial slice \d+, .+\)$/.test(findings.split('\n').pop()),
    findings.split('\n').pop());
  check('annotations are left out', !/Arrow|Text/.test(findings));

  const before = findings;
  await page.click('#reportFinalBtn'); await page.waitForTimeout(400);
  await page.click('#reportMeasureBtn'); await page.waitForTimeout(300);
  check('a finalised report refuses the insert rather than editing itself',
    (await page.inputValue('#reportFindings')) === before);
  await page.click('#reportFinalBtn'); await page.waitForTimeout(400);

  await page.evaluate(() => window.__ctConsole.clearMeasurements());
  await page.waitForTimeout(200);
  const beforeEmpty = await page.inputValue('#reportFindings');
  await page.click('#reportMeasureBtn'); await page.waitForTimeout(300);
  check('with nothing to insert it says so and writes nothing',
    (await page.inputValue('#reportFindings')) === beforeEmpty);

  console.log('\n11. No page errors');
  check('clean console', errors.length === 0, errors.slice(0, 4).join(' ;; ') || 'none');

  await page.screenshot({ path: path.join(SP, 'shot-report.png') });
  await browser.close();
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'All report checks passed') + '\n');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
