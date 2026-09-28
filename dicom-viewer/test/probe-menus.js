/* Every toolbar menu must open where it can be clicked, and every item in
   it must be hit-testable by a real cursor — the failure mode that made the
   Reset menu unreachable once already. */
const { chromium } = require('playwright');
let fails = 0;
const check = (n, ok, x) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (x ? '   [' + x + ']' : '')); if (!ok) fails++; };
const MENUS = [
  ['openBtn', 'openMenu'], ['layoutBtn', 'layoutMenu'], ['windowBtn', 'windowMenu'],
  ['toolMoreBtn', 'toolMenu'], ['orientBtn', 'orientMenu'], ['moreBtn', 'moreMenu'],
  ['resetBtn', 'resetMenu'],
];
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  for (const w of [1100, 1440, 1920]) {
    console.log(`\n--- ${w}px ---`);
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    await p.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });
    for (const [btn, menu] of MENUS) {
      await p.click('#' + btn);
      await p.waitForTimeout(120);
      const r = await p.evaluate(([m]) => {
        const el = document.getElementById(m);
        if (el.hidden) return { open: false };
        const box = el.getBoundingClientRect();
        const items = [...el.querySelectorAll('button')];
        const bad = items.filter(i => {
          const q = i.getBoundingClientRect();
          if (!q.width || !q.height) return true;
          const hit = document.elementFromPoint(q.left + q.width/2, q.top + q.height/2);
          return !(hit && (i === hit || i.contains(hit)));
        }).map(i => i.textContent.trim().slice(0, 16));
        return { open: true, items: items.length, bad,
                 offscreen: box.right > innerWidth + 1 || box.bottom > innerHeight + 1 ||
                            box.left < -1 || box.top < -1 };
      }, [menu]);
      check(`${menu} opens`, r.open);
      if (r.open) {
        check(`${menu}: stays on screen`, !r.offscreen);
        check(`${menu}: all ${r.items} items are clickable`, r.bad.length === 0, r.bad.join(', '));
      }
      await p.keyboard.press('Escape');
      await p.waitForTimeout(80);
      check(`${menu}: Escape closes it`,
        await p.evaluate(m => document.getElementById(m).hidden, menu));
    }
    await p.close();
  }
  await b.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nAll menu checks passed');
  process.exit(fails ? 1 : 0);
})();
