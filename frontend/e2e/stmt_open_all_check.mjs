// Bank bus view: all five Accounting boxes open at once do not overlap (26 Nov 2026). Usage: node e2e/stmt_open_all_check.mjs outdir
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 }); const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/?mode=bank'); await page.waitForSelector('.bus-diagram', { timeout: 90000 }); await page.waitForTimeout(2000);
const click = async name => { await page.getByRole('button', { name, exact: true }).dispatchEvent('click'); await page.waitForTimeout(600); };
await click('Expand Bank'); await click('Expand Accounting');
for (const b of ['Income statement', 'Equity statement', 'Cash flow statement', 'Balance sheet', 'Metrics']) await click('Expand ' + b);
await page.locator('.bus-canvas .react-flow__controls-fitview').dispatchEvent('click'); await page.waitForTimeout(900);
const r = await page.evaluate(() => { const boxes = [...document.querySelectorAll('.map-node.bus-stmt')].map(n => n.getBoundingClientRect());
  let overlaps = 0; for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps++; }
  return { open: boxes.length, overlaps }; });
await page.locator('.bus-canvas').screenshot({ path: out + '/stmt_open_all.png' });
console.log(JSON.stringify({ ...r, errors })); process.exit(0);
