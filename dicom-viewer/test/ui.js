/* Shared UI drivers for the browser suite.

   Tests should press what a reader presses. Keeping the click paths in one
   place means a control moving to a menu costs one edit here rather than
   twenty scattered through the suite — and, more to the point, that every
   test keeps exercising the real path instead of quietly falling back to
   calling the function underneath. */

/** Choose a layout from the layout menu. */
async function pickLayout(page, key) {
  await page.click('#layoutBtn');
  await page.waitForSelector('#layoutMenu:not([hidden])');
  await page.click(`#layoutMenu [data-layout="${key}"]`);
  await page.waitForTimeout(700);
}

/** Choose which plane fills the grid: Ax / Cor / Sag / Mix on the toolbar. */
async function pickFill(page, fill) {
  await page.click(`#planeSeg [data-fill="${fill}"]`);
  await page.waitForTimeout(900);
}

/** True when the whole-grid plane choice is offered for this layout. */
async function fillEnabled(page, fill) {
  return !(await page.isDisabled(`#planeSeg [data-fill="${fill || 'axial'}"]`));
}

/** Which plane button is currently the active one. */
async function currentFill(page) {
  return page.evaluate(() => {
    const on = document.querySelector('#planeSeg .seg-btn.active');
    return on ? on.dataset.fill : null;
  });
}

/** Which layout the menu currently shows as chosen. */
async function currentLayout(page) {
  return page.evaluate(() => {
    const on = document.querySelector('#layoutMenu [data-layout].on');
    return on ? on.dataset.layout : null;
  });
}

/** Choose a tool, from the toolbar if it is there and the menu if not. */
async function pickTool(page, tool) {
  // Sculpting is segmentation, not measurement, so it is armed from the
  // Segmentation section rather than the Measure menu.
  if (tool === 'sculpt') {
    await pickMore(page, 'segment');
    await page.waitForTimeout(200);
    await page.click('#sculptBtn');
    await page.waitForTimeout(220);
    return;
  }
  // Navigate has its own toolbar button, since it is the one you come back
  // to after every measurement; the rest live in the Measure menu.
  if (tool === 'none') {
    await page.click('#navBtn');
  } else {
    await page.click('#toolMoreBtn');
    await page.waitForSelector('#toolMenu:not([hidden])');
    await page.click(`#toolMenu [data-tool="${tool}"]`);
  }
  await page.waitForTimeout(220);
}

/** Set the slice step between repeated panes, from the Stack menu. */
async function setStack(page, step) {
  await page.click('#stackBtn');
  await page.waitForSelector('#stackMenu:not([hidden])');
  await page.click(`#stackMenu [data-step="${step}"]`);
  await page.waitForTimeout(500);
}


/** Apply a window preset from the Window menu. */
async function pickWindow(page, key) {
  await page.click('#windowBtn');
  await page.waitForSelector('#windowMenu:not([hidden])');
  await page.click(`#windowMenu [data-window="${key}"]`);
  await page.waitForTimeout(280);
}

/** Which window presets the menu is currently offering. */
async function windowPresets(page) {
  return page.evaluate(() => [...document.querySelectorAll('#windowPresets [data-window]')]
    .map(b => b.dataset.window));
}

/** Which preset the menu shows as in force, or null for a custom window. */
async function currentWindow(page) {
  return page.evaluate(() => {
    const on = document.querySelector('#windowPresets [data-window].on');
    return on ? on.dataset.window : null;
  });
}

/** Choose an item from the "More" menu. */
async function pickMore(page, key) {
  await page.click('#moreBtn');
  await page.waitForSelector('#moreMenu:not([hidden])');
  await page.click(`#moreMenu [data-more="${key}"]`);
  await page.waitForTimeout(220);
}

/** Whether a "More" menu toggle is currently on. */
async function moreOn(page, key) {
  return page.evaluate((k) => {
    const b = document.querySelector(`#moreMenu [data-more="${k}"]`);
    return !!(b && b.classList.contains('on'));
  }, key);
}

/**
 * Pin every Tools-panel section on screen.
 *
 * The panel follows the armed tool, so a control belonging to another
 * context is hidden and cannot be clicked — by a test or by a person. Any
 * suite that reaches straight for a panel control calls this first, which
 * is the same button a reader presses when they want everything at once.
 */
async function showAllTools(page) {
  const already = await page.evaluate(() => window.__ctConsole.state.toolsShowAll);
  if (!already) {
    await page.click('#toolsAllBtn');
    await page.waitForTimeout(200);
  }
}

/**
 * Flip one of the Sync menu's switches.
 *
 * Sync holds three independent links — position, zoom/pan and window/level —
 * so it opens a menu rather than toggling. The menu stays open as switches
 * are thrown, which is why this closes it afterwards.
 */
async function pickSync(page, which) {
  await page.click('#linkBtn');
  await page.waitForSelector('#syncMenu:not([hidden])');
  await page.click(`#syncMenu [data-sync="${which}"]`);
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
}

/** Choose an item from the Reset menu. */
async function pickReset(page, key) {
  await page.click('#resetBtn');
  await page.waitForSelector('#resetMenu:not([hidden])');
  await page.click(`#resetMenu [data-reset="${key}"]`);
  await page.waitForTimeout(400);
}

/** Choose an item from the Open menu. */
async function pickOpen(page, key) {
  await page.click('#openBtn');
  await page.waitForSelector('#openMenu:not([hidden])');
  await page.click(`#openMenu [data-open="${key}"]`);
  await page.waitForTimeout(220);
}

module.exports = { pickLayout, pickFill, fillEnabled, currentFill, currentLayout,
                   pickTool, setStack, pickWindow, windowPresets, currentWindow,
                   pickMore, moreOn, pickOpen, pickReset, showAllTools, pickSync };
