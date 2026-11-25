// Bank bus view: a clicked statement value plots to the right of its line (25 Nov 2026). Usage: node e2e/stmt_plot_side_shot.mjs outdir
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1050 }, deviceScaleFactor: 2 }); const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/?mode=bank'); await page.waitForSelector('.bus-diagram', { timeout: 60000 }); await page.waitForTimeout(2000);
const click = async name => { await page.getByRole('button', { name, exact: true }).dispatchEvent('click'); await page.waitForTimeout(900); };
await click('Expand Bank'); await click('Expand Accounting'); await click('Expand Key figures'); await page.waitForTimeout(600);
const kf = page.locator('.bus-stmt-body').last();
await kf.locator('.stmt-row', { hasText: 'Tier 1 capital ratio' }).locator('.stmt-val').dispatchEvent('click'); await page.waitForTimeout(600);
const r = await page.evaluate(() => { const line = document.querySelector('.stmt-line.plotted'), row = line?.querySelector('.stmt-row')?.getBoundingClientRect(), plot = line?.querySelector('.stmt-plot')?.getBoundingClientRect();
  return { right: !!(row && plot && plot.left >= row.right - 1 && Math.abs(plot.top - row.top) < 40) }; });
await page.locator('.map-node', { has: page.locator('strong', { hasText: /^Key figures$/ }) }).screenshot({ path: out + '/stmt_plot_side.png' });
console.log(JSON.stringify({ ...r, errors })); process.exit(0);
