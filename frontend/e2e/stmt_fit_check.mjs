// Bank bus view: a statement box grows with an opened line (+) and shrinks back (25 Nov 2026). Usage: node e2e/stmt_fit_check.mjs outdir
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } }); const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/?mode=bank'); await page.waitForSelector('.bus-diagram', { timeout: 90000 }); await page.waitForTimeout(2000);
const click = async name => { await page.getByRole('button', { name, exact: true }).dispatchEvent('click'); await page.waitForTimeout(900); };
await click('Expand Bank'); await click('Expand Accounting'); await click('Expand Balance sheet');
const box = page.locator('.map-node', { has: page.locator('strong', { hasText: /^Balance sheet$/ }) });
const fits = () => page.evaluate(() => { const b = [...document.querySelectorAll('.bus-stmt-body')].find(x => x.querySelector('.stmt-balance')); const c = b.firstElementChild; return c.offsetHeight <= b.clientHeight + 2; });
const h0 = (await box.boundingBox()).height, f0 = await fits();
await page.locator('.stmt-row', { hasText: /^Equity/ }).first().dispatchEvent('click'); await page.waitForTimeout(800);
const h1 = (await box.boundingBox()).height, f1 = await fits();
await page.locator('.bus-canvas').screenshot({ path: out + '/stmt_fit.png' });
await page.locator('.stmt-row', { hasText: /^Equity/ }).first().dispatchEvent('click'); await page.waitForTimeout(800);
const h2 = (await box.boundingBox()).height;
console.log(JSON.stringify({ h0: Math.round(h0), h1: Math.round(h1), h2: Math.round(h2), grew: h1 > h0 + 10, shrank: h2 < h1 - 10, fits: f0 && f1, errors })); process.exit(0);
