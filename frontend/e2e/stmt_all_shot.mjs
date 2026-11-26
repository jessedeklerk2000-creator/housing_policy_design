// Bank bus view: all four statement boxes open, no plots: widths fit their content (25 Nov 2026)
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1050 } }); const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/?mode=bank'); await page.waitForSelector('.bus-diagram', { timeout: 60000 }); await page.waitForTimeout(2000);
const click = async name => { await page.getByRole('button', { name, exact: true }).dispatchEvent('click'); await page.waitForTimeout(700); };
await click('Expand My Bank'); await click('Expand Treasury'); await click('Expand Accounting');
for (const b of ['Income statement', 'Cash flow statement', 'Balance sheet', 'Metrics']) await click('Expand ' + b);
await page.locator('.react-flow__controls-fitview').dispatchEvent('click'); await page.waitForTimeout(900);
const r = await page.evaluate(() => [...document.querySelectorAll('.bus-stmt-body')].map(b => { const rows = [...b.querySelectorAll('.stmt-row')].map(x => x.getBoundingClientRect().width), z = new DOMMatrix(getComputedStyle(document.querySelector('.bus-canvas .react-flow__viewport')).transform).a;
  return { box: Math.round(b.clientWidth / 1), maxRow: Math.round(Math.max(...rows) / z), scroll: b.scrollWidth > b.clientWidth + 2 }; }));
await page.locator('.bus-canvas').screenshot({ path: out + '/stmt_all.png' });
console.log(JSON.stringify({ r, errors })); process.exit(0);
