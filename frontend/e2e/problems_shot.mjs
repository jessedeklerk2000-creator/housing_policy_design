// Problem-first welcome card, step 1 bubbles with figures, and the housing-ladder step (17 Nov 2026).
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
for (const [w, h, tag] of [[1440, 900, ''], [390, 844, '_m']]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } }); page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8001/'); await page.waitForSelector('.problem-cards'); await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/welcome${tag}.png` }); await page.close();
}
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/');
await page.getByRole('button', { name: 'Take the full guided tour' }).first().click(); await page.waitForSelector('.coach'); await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/step0a.png` });
await page.locator('.coach').getByRole('button', { name: 'Continue' }).click(); await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/step0b.png` });
// ladder step: last step via the bar
await page.locator('.tour-steps button').last().click(); await page.waitForTimeout(9000);
await page.screenshot({ path: `${out}/ladder1.png` });
await page.locator('.coach').getByRole('button', { name: 'Show me' }).click(); await page.waitForTimeout(3000);
await page.locator('.coach').getByRole('button', { name: 'Show me' }).click(); await page.waitForTimeout(25000);
await page.screenshot({ path: `${out}/ladder2.png` });
const coach = await page.locator('.coach p').first().textContent();
console.log(JSON.stringify({ coach, errors })); process.exit(0);
