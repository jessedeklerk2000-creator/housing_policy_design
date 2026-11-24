// Bank controls: open the y1 and y2 cards and screenshot them (ratio explanation under the plot).
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 2200, height: 1300 } }); const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/?mode=bank');
await page.waitForSelector('.map-canvas .react-flow__node', { timeout: 40000 }); await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(1500);
const marks = page.locator('.map-canvas svg text').filter({ hasText: /^(x₁|x₂|y₁|y₂)$/ }); const nm = await marks.count();
for (let i = 0; i < nm; i++) { await marks.nth(i).click({ force: true }).catch(() => {}); await page.waitForTimeout(400); }
await page.getByRole('button', { name: 'Play through time' }).click(); await page.waitForTimeout(9000);
const cards = page.locator('.pin-card').filter({ hasText: /Assets|Liabilities|Tier 1 capital ratio|Net Stable/ }); const n = await cards.count();
for (let i = 0; i < n; i++) { const c = cards.nth(i); const b = await c.boundingBox(); const sh = await c.evaluate(el => [el.scrollHeight, el.clientHeight]); console.log(JSON.stringify({ i, b, sh })); await c.screenshot({ path: `${out}/bank_note_${i}.png` }); }
console.log(JSON.stringify({ n, errors }));
process.exit(0);
