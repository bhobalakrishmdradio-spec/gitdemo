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

  const slices = () => page.evaluate(() => window.__ctConsole.state.cells
    .map(c => c.plane === 'vr' ? null : window.__ctConsole.cellIndex(c)));
  const planes = () => page.evaluate(() => window.__ctConsole.state.cells.map(c => c.plane));
  const scroll = (i, n, dir) => page.evaluate(([i, n, dir]) => {
    for (let k = 0; k < n; k++) window.__ctConsole.cellEl(i).dispatchEvent(
      new WheelEvent('wheel', { deltaY: dir * 120, bubbles: true, cancelable: true }));
  }, [i, n, dir || 1]);
  const distinctImages = () => page.evaluate(() => {
    const C = window.__ctConsole;
    const hashes = new Set();
    for (let i = 0; i < C.cellCount(); i++) {
      if (C.state.cells[i].plane === 'vr') continue;
      const cv = C.cellEl(i).querySelector('.vp-canvas');
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let h = 0; for (let k = 0; k < d.length; k += 4) h = (Math.imul(h, 31) + d[k]) | 0;
      hashes.add(h);
    }
    return hashes.size;
  });

  console.log('\n1. A grid shows a run of slices, not one image repeated');
  await UI.pickLayout(page, '2x3');
  const p = await planes();
  const s0 = await slices();
  const axialPanes = p.map((x, i) => x === 'axial' ? i : -1).filter(i => i >= 0);
  check(`the ${axialPanes.length} axial panes sit on consecutive slices`,
    new Set(axialPanes.map(i => s0[i])).size === axialPanes.length &&
    axialPanes.every((v, k) => s0[v] === s0[axialPanes[0]] + k),
    axialPanes.map(i => s0[i]).join(', '));
  const mprPanes = p.filter(x => x !== 'vr').length;
  const distinct = await distinctImages();
  check(`all ${mprPanes} image panes render distinct images`, distinct === mprPanes,
    distinct + ' distinct of ' + mprPanes);

  console.log('\n2. Scrolling any pane moves the whole layout together');
  const before = await slices();
  await scroll(0, 4);
  await page.waitForTimeout(600);
  const after = await slices();
  const deltas = before.map((b, i) => b === null ? null : after[i] - b);
  const mprDeltas = deltas.filter(d => d !== null);
  check('every pane on the scrolled plane advanced by 4',
    axialPanes.every(i => deltas[i] === 4), axialPanes.map(i => deltas[i]).join(', '));
  check('panes on other planes held still',
    p.every((pl, i) => pl === 'vr' || pl === 'axial' || deltas[i] === 0),
    JSON.stringify(deltas));
  check('the offsets between panes are preserved',
    axialPanes.every((i, k) => after[i] - after[axialPanes[0]] === k),
    axialPanes.map(i => after[i]).join(', '));

  console.log('\n3. Scrolling from a different pane drives the same stack');
  const mid = axialPanes[axialPanes.length - 1];
  await scroll(mid, 3, -1);
  await page.waitForTimeout(600);
  const back = await slices();
  check('scrolling pane ' + mid + ' moved all axial panes back by 3',
    axialPanes.every(i => back[i] === after[i] - 3), axialPanes.map(i => back[i]).join(', '));

  console.log('\n4. Coronal and sagittal stacks are independent');
  const coronalPanes = p.map((x, i) => x === 'coronal' ? i : -1).filter(i => i >= 0);
  const preC = await slices();
  await scroll(coronalPanes[0], 5);
  await page.waitForTimeout(600);
  const postC = await slices();
  check('scrolling a coronal pane moved only the coronal panes',
    coronalPanes.every(i => postC[i] === preC[i] + 5) &&
    axialPanes.every(i => postC[i] === preC[i]),
    'coronal ' + coronalPanes.map(i => postC[i]).join(',') +
    ' | axial ' + axialPanes.map(i => postC[i]).join(','));

  console.log('\n5. Crosshairs on the other planes follow the scroll');
  const crossMoved = await page.evaluate(() => {
    const C = window.__ctConsole;
    const hash = (i) => {
      const cv = C.cellEl(i).querySelector('.vp-cross');
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let h = 0; for (let k = 3; k < d.length; k += 4) h = (Math.imul(h, 31) + d[k]) | 0;
      return h;
    };
    const sag = C.state.cells.findIndex(c => c.plane === 'sagittal');
    const b = hash(sag);
    for (let k = 0; k < 8; k++) C.cellEl(0).dispatchEvent(
      new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
    return { before: b, after: hash(sag) };
  });
  check('the sagittal crosshair moved when the axial stack scrolled',
    crossMoved.before !== crossMoved.after);

  console.log('\n6. The stack step is adjustable');
  await UI.setStack(page, 5);
  await page.waitForTimeout(700);
  const stepped = await slices();
  check('axial panes now step 5 slices apart',
    axialPanes.every((i, k) => stepped[i] - stepped[axialPanes[0]] === k * 5),
    axialPanes.map(i => stepped[i]).join(', '));
  check('the note explains the span',
    /5 slices apart/.test(await page.textContent('#stackNote')),
    (await page.textContent('#stackNote')).slice(0, 90));

  await UI.setStack(page, 0);
  await page.waitForTimeout(700);
  const flat = await slices();
  check('"Same slice" collapses the stack again',
    axialPanes.every(i => flat[i] === flat[axialPanes[0]]), axialPanes.map(i => flat[i]).join(', '));
  await UI.setStack(page, 1);
  await page.waitForTimeout(700);

  console.log('\n7. A pinned pane holds while the rest scroll');
  // Needs more than one pane on the same plane, so fill the grid with axial.
  await UI.pickFill(page, 'axial');
  const axialAll = await page.evaluate(() => window.__ctConsole.state.cells
    .map((c, i) => c.plane === 'axial' ? i : -1).filter(i => i >= 0));
  await page.evaluate(() => {
    const C = window.__ctConsole;
    const i = C.state.cells.findIndex((c, k) => c.plane === 'axial' && k > 0);
    C.cellEl(i).querySelector('.vp-link').click();
    return i;
  });
  await page.waitForTimeout(400);
  const pinnedIdx = await page.evaluate(() => window.__ctConsole.state.cells
    .findIndex(c => c.pinned));
  const prePin = await slices();
  await scroll(0, 6);
  await page.waitForTimeout(600);
  const postPin = await slices();
  check('the pinned pane did not move', postPin[pinnedIdx] === prePin[pinnedIdx],
    'pane ' + pinnedIdx + ': ' + prePin[pinnedIdx] + ' -> ' + postPin[pinnedIdx]);
  check('the unpinned ones still advanced by 6',
    axialAll.filter(i => i !== pinnedIdx).every(i => postPin[i] === prePin[i] + 6),
    axialAll.map(i => prePin[i] + '->' + postPin[i]).join(' '));
  await page.evaluate(() => {
    const C = window.__ctConsole;
    const i = C.state.cells.findIndex(c => c.pinned);
    C.cellEl(i).querySelector('.vp-link').click();
  });
  await page.waitForTimeout(400);
  const rejoined = await slices();
  check('unpinning leaves it where it was, back on the stack',
    rejoined[pinnedIdx] === postPin[pinnedIdx],
    postPin[pinnedIdx] + ' -> ' + rejoined[pinnedIdx]);
  await scroll(0, 2);
  await page.waitForTimeout(500);
  const moved = await slices();
  check('and it now scrolls with the rest again', moved[pinnedIdx] === rejoined[pinnedIdx] + 2);

  await page.screenshot({ path: path.join(SP, 'shot-sync-4x4.png') });

  console.log('\n8. A pane slider drives the whole stack');
  const planesNow = await planes();
  const sliderDrive = await page.evaluate(() => {
    const C = window.__ctConsole;
    const i = C.state.cells.findIndex((c, k) => c.plane === 'axial' && k > 0);
    const sl = C.cellEl(i).querySelector('.vp-slider');
    const before = C.state.cells.map(c => c.plane === 'vr' ? null : C.cellIndex(c));
    sl.value = '40';
    sl.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      i, before,
      after: C.state.cells.map(c => c.plane === 'vr' ? null : C.cellIndex(c)),
      offsets: C.state.cells.map(c => c.plane === 'vr' ? null : c.offset),
      shared: C.state.index.axial,
    };
  });
  await page.waitForTimeout(400);
  check('dragging a pane slider lands that pane on the slice asked for',
    sliderDrive.after[sliderDrive.i] === 40,
    'pane ' + sliderDrive.i + ' -> ' + sliderDrive.after[sliderDrive.i]);
  // Every unpinned axial pane must sit at the shared cut plus its own offset.
  const axialOk = sliderDrive.after.every((v, k) =>
    v === null || planesNow[k] !== 'axial' ||
    v === sliderDrive.shared + sliderDrive.offsets[k]);
  check('and every other pane followed, each keeping its offset', axialOk,
    'shared=' + sliderDrive.shared + ' panes=' +
    sliderDrive.after.map((v, k) => planesNow[k] === 'axial' ? v + '(' + sliderDrive.offsets[k] + ')' : null)
      .filter(x => x).join(' '));

  await UI.pickFill(page, 'mix');

  console.log('\n9. Smaller layouts are unaffected');
  for (const [key, n] of [['quad', 4], ['mpr', 3], ['1x2', 2]]) {
    await UI.pickLayout(page, key);
    const offs = await page.evaluate(() => window.__ctConsole.state.cells.map(c => c.offset));
    check(`${key}: no plane repeats, so every offset is 0`,
      offs.every(o => o === 0), JSON.stringify(offs));
  }

  console.log('\n10. No page errors');
  check('clean console', errors.length === 0, errors.slice(0, 4).join(' ;; ') || 'none');

  await browser.close();
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'All sync checks passed') + '\n');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
