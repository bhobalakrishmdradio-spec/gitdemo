/* Press everything.

   The suites test features. This presses every control the application has,
   with a study loaded, and fails on any page error — the class of breakage
   that survives a green suite because no test happened to click that one
   button after that one change. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const SP = process.env.CT_FIXTURES || require('path').join(__dirname, 'fixtures');
let fails = 0;
const check = (n, ok, x) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (x ? '   [' + x + ']' : '')); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 },
    acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });

  /* ---- 1. Every control, with nothing loaded. Nothing may throw. ---- */
  console.log('\n1. With no study open, nothing throws');
  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll('.toolbar button')].map(b => b.id).filter(Boolean));
  check('the toolbar has its full set of buttons', buttons.length >= 12, buttons.join(','));
  for (const id of buttons) {
    await page.click('#' + id).catch(() => {});
    await page.waitForTimeout(80);
    await page.keyboard.press('Escape');
  }
  check('no errors from pressing every toolbar button empty',
    errors.length === 0, errors.slice(0, 2).join(' | '));
  errors.length = 0;

  /* ---- 2. Load a study, then press everything again ---- */
  console.log('\n2. With a study open, every toolbar button and menu item');
  const files = fs.readdirSync(path.join(SP, 'phantom')).filter(f => f.endsWith('.dcm')).sort()
    .map(f => path.join(SP, 'phantom', f));
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  errors.length = 0;

  /* Every menu, every item inside it. */
  const MENUS = [['openBtn', 'openMenu'], ['layoutBtn', 'layoutMenu'],
                 ['windowBtn', 'windowMenu'], ['toolMoreBtn', 'toolMenu'],
                 ['stackBtn', 'stackMenu'], ['orientBtn', 'orientMenu'],
                 ['moreBtn', 'moreMenu'], ['resetBtn', 'resetMenu']];
  let pressed = 0;
  for (const [btn, menu] of MENUS) {
    const items = await page.evaluate((m) =>
      [...document.querySelectorAll('#' + m + ' button')]
        .map((b, i) => ({ i, label: b.textContent.trim().slice(0, 22), disabled: b.disabled })),
      menu);
    for (const item of items) {
      if (item.disabled) continue;
      // "Open files"/"Open folder" pop a native file dialog that would hang
      // the sweep, and "Clear" throws the study away mid-run.
      if (menu === 'openMenu') continue;
      await page.click('#' + btn).catch(() => {});
      await page.waitForSelector('#' + menu + ':not([hidden])', { timeout: 3000 }).catch(() => {});
      const sel = `#${menu} button:nth-of-type(${item.i + 1})`;
      await page.locator(`#${menu} button`).nth(item.i).click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(260);
      await page.keyboard.press('Escape');
      pressed++;
      if (errors.length) {
        check(`${menu} → "${item.label}"`, false, errors.join(' | '));
        errors.length = 0;
      }
    }
  }
  check(`every enabled menu item pressed (${pressed}) without an error`, errors.length === 0,
    errors.slice(0, 3).join(' | '));
  errors.length = 0;

  /* Reload: the sweep above will have toggled things into odd states. */
  await page.reload({ waitUntil: 'networkidle' });
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => window.__ctConsole && window.__ctConsole.state.volume,
    null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  errors.length = 0;

  /* ---- 3. Every tool, used for real in a pane ---- */
  console.log('\n3. Every tool, used on a pane');
  await page.click('#layoutBtn');
  await page.waitForSelector('#layoutMenu:not([hidden])');
  await page.click('#layoutMenu [data-layout="axial"]');
  await page.waitForTimeout(700);

  const at = (fx, fy) => page.evaluate(([a, b]) => {
    const r = window.__ctConsole.cellEl(0).querySelector('canvas').getBoundingClientRect();
    return { x: r.left + r.width * a, y: r.top + r.height * b };
  }, [fx, fy]);

  const TOOLS = await page.evaluate(() =>
    [...document.querySelectorAll('#toolMenu [data-tool]')].map(b => b.dataset.tool));
  check('the measure menu offers every tool', TOOLS.length >= 13, TOOLS.join(','));

  for (const tool of TOOLS) {
    await page.evaluate((t) => window.__ctConsole.setTool(t), tool);
    await page.waitForTimeout(120);
    const info = await page.evaluate((t) => {
      const M = window.CTMeasure;
      return { trace: M.isTrace(t), variable: M.isVariable(t), n: M.pointsNeeded(t) };
    }, tool);

    const p1 = await at(0.35, 0.35), p2 = await at(0.55, 0.5), p3 = await at(0.6, 0.62),
          p4 = await at(0.45, 0.68);
    if (tool === 'sculpt' || info.trace) {
      await page.mouse.move(p1.x, p1.y);
      await page.mouse.down();
      await page.mouse.move(p2.x, p2.y, { steps: 6 });
      await page.mouse.move(p3.x, p3.y, { steps: 6 });
      await page.mouse.up();
    } else if (info.variable) {
      await page.mouse.click(p1.x, p1.y); await page.waitForTimeout(60);
      await page.mouse.click(p2.x, p2.y); await page.waitForTimeout(60);
      await page.mouse.click(p3.x, p3.y); await page.waitForTimeout(60);
      await page.keyboard.press('Enter');
    } else {
      for (const p of [p1, p2, p3, p4].slice(0, Math.max(1, info.n))) {
        await page.mouse.click(p.x, p.y);
        await page.waitForTimeout(70);
      }
    }
    await page.waitForTimeout(220);
    // The caption editor opens for the text tool; close it.
    if (await page.isVisible('#annotInput')) {
      await page.fill('#annotField', 'sweep');
      await page.click('#annotOk');
      await page.waitForTimeout(150);
    }
    if (errors.length) { check(`tool "${tool}"`, false, errors.join(' | ')); errors.length = 0; }
  }
  check('every tool used without an error', errors.length === 0, errors.slice(0, 3).join(' | '));

  const made = await page.evaluate(() => {
    const C = window.__ctConsole;
    const byTool = {};
    C.state.measurements.forEach(m => { byTool[m.tool] = (byTool[m.tool] || 0) + 1; });
    return byTool;
  });
  const placing = TOOLS.filter(t => t !== 'sculpt');
  const missed = placing.filter(t => !made[t]);
  check('each placing tool actually created something', missed.length === 0,
    missed.length ? 'nothing placed by: ' + missed.join(', ') : JSON.stringify(made));

  /* ---- 4. Every tools-panel control ---- */
  console.log('\n4. Every control in the Tools panel');
  errors.length = 0;
  await page.evaluate(() => window.__ctConsole.setTool('none'));
  // The Tools panel only shows the sections belonging to the armed tool, so
  // pin every section first — otherwise this loop would quietly stop
  // exercising most of the panel, which is the opposite of its job.
  await page.evaluate(() => {
    if (!window.__ctConsole.state.toolsShowAll) document.getElementById('toolsAllBtn').click();
  });
  await page.waitForTimeout(300);
  const panelIds = await page.evaluate(() =>
    [...document.querySelectorAll('#toolsPanel input, #toolsPanel select, #toolsPanel button')]
      .map(e => ({ id: e.id, tag: e.tagName, type: e.type })).filter(e => e.id));
  for (const el of panelIds) {
    if (el.tag === 'SELECT') {
      const opts = await page.evaluate((id) =>
        [...document.getElementById(id).options].map(o => o.value), el.id);
      for (const v of opts) {
        await page.selectOption('#' + el.id, v).catch(() => {});
        await page.waitForTimeout(220);
      }
    } else if (el.type === 'range') {
      const box = await page.locator('#' + el.id).boundingBox().catch(() => null);
      if (box) {
        await page.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2);
        await page.waitForTimeout(350);
      }
    } else if (el.type === 'checkbox') {
      await page.click('#' + el.id).catch(() => {});
      await page.waitForTimeout(400);
      await page.click('#' + el.id).catch(() => {});
      await page.waitForTimeout(400);
    } else if (el.tag === 'BUTTON') {
      await page.click('#' + el.id).catch(() => {});
      await page.waitForTimeout(250);
    } else if (el.type === 'number') {
      await page.fill('#' + el.id, '300').catch(() => {});
      await page.waitForTimeout(200);
    }
    if (errors.length) { check(`panel control #${el.id}`, false, errors.join(' | ')); errors.length = 0; }
  }
  check(`every Tools-panel control exercised (${panelIds.length}) without an error`,
    errors.length === 0, errors.slice(0, 3).join(' | '));

  /* ---- 5. Every keyboard shortcut ---- */
  console.log('\n5. Every keyboard shortcut');
  errors.length = 0;
  await page.evaluate(() => window.__ctConsole.cellEl(0).focus());
  for (const k of ['1','2','3','4','5','6','i','n','x','f','g','r',
                   'ArrowDown','ArrowUp','ArrowLeft','ArrowRight','PageDown','PageUp',
                   'Enter','Escape','Delete']) {
    await page.keyboard.press(k);
    await page.waitForTimeout(140);
    if (errors.length) { check(`key "${k}"`, false, errors.join(' | ')); errors.length = 0; }
  }
  check('every shortcut pressed without an error', errors.length === 0,
    errors.slice(0, 3).join(' | '));

  /* ---- 6. Still usable at the end ---- */
  console.log('\n6. The viewer still works after all of that');
  await page.click('#layoutBtn');
  await page.waitForSelector('#layoutMenu:not([hidden])');
  await page.click('#layoutMenu [data-layout="quad"]');
  await page.waitForTimeout(1200);
  const alive = await page.evaluate(() => {
    const C = window.__ctConsole;
    let drawn = 0;
    for (let i = 0; i < C.cellCount(); i++) {
      const rec = C.cellEl(i);
      const cv = rec && rec.querySelector('canvas');
      if (!cv) continue;
      const c = document.createElement('canvas');
      c.width = 40; c.height = 40;
      const x = c.getContext('2d');
      x.drawImage(cv, 0, 0, 40, 40);
      const d = x.getImageData(0, 0, 40, 40).data;
      let lit = 0;
      for (let k = 0; k < d.length; k += 4) if (d[k] > 12) lit++;
      if (lit > 40) drawn++;
    }
    return { panes: C.cellCount(), drawn, volume: !!C.state.volume };
  });
  check('the study is still loaded', alive.volume);
  check('every pane is still drawing an image', alive.drawn >= 3,
    alive.drawn + ' of ' + alive.panes + ' panes');
  check('no page errors anywhere in the sweep', errors.length === 0,
    errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nEverything pressed, nothing broke');
  process.exit(fails ? 1 : 0);
})();
