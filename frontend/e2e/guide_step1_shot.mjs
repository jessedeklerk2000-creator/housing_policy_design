// Guided tour step 1: open the market, open Households to the breadboard, then click its Utility equation.
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/');
await page.getByRole('button', { name: 'Take the full guided tour' }).first().click(); await page.waitForTimeout(6000);
const heads = [];
for (let i = 0; i < 3; i++) { heads.push(await page.locator('.coach-head b').textContent()); await page.locator('.coach').getByRole('button', { name: 'Show me' }).click(); await page.waitForTimeout(3500); }
heads.push(await page.locator('.coach-head b').textContent());
const r = { heads, ring: await page.locator('.coach-ring').count(), hl: await page.locator('.eq.on').count() };
await page.screenshot({ path: out + '/guide_step1.png' });
console.log(JSON.stringify({ r, errors })); process.exit(0);
