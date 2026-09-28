const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  for (const w of [900, 1100, 1280, 1440, 1680, 1920, 2560]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    await p.goto('http://localhost:8412/index.html', { waitUntil: 'networkidle' });
    const r = await p.evaluate(() => {
      const bar = document.querySelector('.toolbar');
      const kids = [...bar.children].map(c => c.getBoundingClientRect());
      // Real wrapping shows as groups on genuinely different lines, not as
      // a pixel of difference between a select and a button.
      const lines = new Set(kids.map(k => Math.round(k.top / 12)));
      // Every toolbar button must be clickable by a real cursor.
      const unreachable = [...bar.querySelectorAll('button')].filter(btn => {
        const q = btn.getBoundingClientRect();
        if (q.width === 0) return false;
        const hit = document.elementFromPoint(q.left + q.width/2, q.top + q.height/2);
        return !(hit && (btn.contains(hit) || btn === hit));
      }).map(btn => btn.id || btn.textContent.trim());
      return { rows: lines.size, h: Math.round(bar.getBoundingClientRect().height),
               scrollW: bar.scrollWidth, clientW: bar.clientWidth, unreachable };
    });
    console.log(`${w}px  rows=${r.rows}  height=${r.h}px  scroll=${r.scrollW}/${r.clientW}` +
      (r.unreachable.length ? `  UNREACHABLE: ${r.unreachable.join(',')}` : ''));
    await p.close();
  }
  await b.close();
})();
