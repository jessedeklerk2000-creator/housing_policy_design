// Guided tour: Identify system pressed while Play is running keeps the tour (step 3).
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 800))); page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
let loads = 0; page.on('load', () => loads++);
await page.goto('http://127.0.0.1:8001/');
await page.getByRole('button', { name: 'Take the full guided tour' }).first().click();
await page.getByRole('button', { name: 'Guide step 3:' }).click(); await page.waitForTimeout(7000);
await page.locator('.coach').getByRole('button', { name: 'Show me' }).click(); await page.waitForTimeout(6000);
const r = {};
for (const wait of [300, 1500]) {
  await page.getByRole('button', { name: 'Play through time' }).click(); await page.waitForTimeout(wait);
  await page.getByRole('button', { name: 'Identify system' }).click(); await page.waitForTimeout(5000);
  r[wait] = { guide: await page.locator('.guide-bar').count(), coach: await page.locator('.coach-head b').textContent().catch(() => null), loads };
  await page.getByRole('button', { name: 'Identify system' }).click(); await page.waitForTimeout(1500);
}
console.log(JSON.stringify({ r, errors })); process.exit(0);
