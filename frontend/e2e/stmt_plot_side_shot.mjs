// Bank bus view: a clicked statement value plots to the right of its line (25 Nov 2026). Usage: node e2e/stmt_plot_side_shot.mjs outdir
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1050 }, deviceScaleFactor: 2 }); const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/?mode=bank'); await page.waitForSelector('.bus-diagram', { timeout: 60000 }); await page.waitForTimeout(2000);
const click = async name => { await page.getByRole('button', { name, exact: true }).dispatchEvent('click'); await page.waitForTimeout(900); };
await click('Expand My Bank'); await click('Expand Treasury (treasurer)'); await click('Expand Accounting'); await click('Expand Metrics'); await page.waitForTimeout(600);
await page.locator('.bus-canvas .react-flow__controls-fitview').dispatchEvent('click'); await page.waitForTimeout(900);  // no auto-zoom on Accounting any more
const kf = page.locator('.bus-stmt-body').last();
await kf.locator('.stmt-row', { hasText: 'Tier 1 capital ratio' }).locator('.stmt-val').dispatchEvent('click'); await page.waitForTimeout(600);
const r = await page.evaluate(() => { const line = document.querySelector('.stmt-line.plotted'), row = line?.querySelector('.stmt-row')?.getBoundingClientRect(), plot = line?.querySelector('.stmt-plot-card')?.getBoundingClientRect();
  return { right: !!(row && plot && plot.left >= row.right - 1 && Math.abs(plot.top - row.top) < 60) }; });
const card = page.locator('.stmt-plot-card').first(), c0 = await card.boundingBox(), h = await page.locator('.stmt-plot-head').first().boundingBox();
await page.mouse.move(h.x + 40, h.y + h.height / 2); await page.mouse.down(); await page.mouse.move(h.x + 160, h.y + 90, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300);
const c1 = await card.boundingBox(); r.moved = Math.abs(c1.x - c0.x) > 60 && Math.abs(c1.y - c0.y) > 40; r.head = await page.locator('.stmt-plot-head b').first().textContent();
await page.locator('.bus-canvas').screenshot({ path: out + '/stmt_plot_side.png' });
console.log(JSON.stringify({ ...r, errors })); process.exit(0);
