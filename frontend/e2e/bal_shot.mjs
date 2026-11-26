// Bank bus view: the Balance sheet box shows both columns at its normal width; a plot opens below its line (25 Nov 2026)
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1050 }, deviceScaleFactor: 2 }); const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/?mode=bank'); await page.waitForSelector('.bus-diagram', { timeout: 60000 }); await page.waitForTimeout(2000);
const click = async name => { await page.getByRole('button', { name, exact: true }).dispatchEvent('click'); await page.waitForTimeout(900); };
await click('Expand My Bank'); await click('Expand Treasury (treasurer)'); await click('Expand Accounting'); await click('Expand Balance sheet'); await page.waitForTimeout(600);
const body = page.locator('.bus-stmt-body').first();
await body.locator('.stmt-row', { hasText: 'Mortgages' }).first().locator('.stmt-val').dispatchEvent('click'); await page.waitForTimeout(600);
const r = await body.evaluate(b => { const box = b.getBoundingClientRect(), side = [...b.querySelectorAll('.stmt-side')].map(s => s.getBoundingClientRect()), plot = b.querySelector('.stmt-plot')?.getBoundingClientRect();
  return { columns: side.length, inside: side.every(s => s.right <= box.right + 1), plotRight: !!plot && plot.left >= box.right }; });
await page.locator('.bus-canvas').screenshot({ path: out + '/bal_box.png' });
console.log(JSON.stringify({ ...r, errors })); process.exit(0);
