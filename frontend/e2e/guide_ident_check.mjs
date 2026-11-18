// Guided tour: Identify system can be pressed in any step without breaking the page.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 600))); page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
await page.goto('http://127.0.0.1:8001/');
await page.getByRole('button', { name: 'Take the full guided tour' }).first().click();
const res = {};
for (const n of [1, 2, 3, 4, 5, 8]) {
  await page.getByRole('button', { name: `Guide step ${n}:` }).click(); await page.waitForTimeout(7000);
  await page.getByRole('button', { name: 'Identify system' }).click(); await page.waitForTimeout(6000);
  res[n] = { canvas: await page.locator('.map-canvas').count(), coach: await page.locator('.coach').count(), errs: errors.length };
  await page.getByRole('button', { name: 'Identify system' }).click().catch(() => {}); await page.waitForTimeout(1000);
}
console.log(JSON.stringify({ res, errors })); process.exit(0);
