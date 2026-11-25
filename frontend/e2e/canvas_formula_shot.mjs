// Budget highlighted with Investors and Households open (Jesse's view, 25 Nov 2026). Usage: node e2e/budget_open_shot.mjs outdir [formula]
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots', which = process.argv[3] ?? 'Budget';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page); await page.waitForTimeout(2500);
const b = page.getByRole('button', { name: 'CPB formulas' }); if (await b.getAttribute('aria-pressed') !== 'true') await b.click(); await page.waitForTimeout(1500);
for (const a of (process.argv[4] ?? 'Investors,Households').split(',')) { await page.getByRole('button', { name: 'Expand ' + a }).first().dispatchEvent('click'); await page.waitForTimeout(1500); }
await page.locator('.formulas .eq', { hasText: which }).first().dispatchEvent('click'); await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Figure mode' }).click(); await page.waitForTimeout(800);
await page.locator('.react-flow__controls-fitview').dispatchEvent('click'); await page.waitForTimeout(1200);
await page.locator('.map-canvas').screenshot({ path: `${out}/canvas_${which.toLowerCase()}.png` });
console.log(JSON.stringify({ errors })); process.exit(0);
