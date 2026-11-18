// Guided tour step 2: after the plots, the Housing Market opens again and the rental housing services flow is the target.
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/');
await page.getByRole('button', { name: 'Take the full guided tour' }).first().click();
await page.getByRole('button', { name: 'Guide step 2:' }).click(); await page.waitForTimeout(7000);
for (let i = 0; i < 4; i++) { await page.locator('.coach').getByRole('button', { name: 'Show me' }).click(); await page.waitForTimeout(3500); } await page.waitForTimeout(1500);
const r = { head: await page.locator('.coach-head b').textContent(), ring: await page.locator('.coach-ring').boundingBox(), rail: await page.locator('.react-flow__edge[data-id="rental_services"] .rail-hit').first().boundingBox(), n: await page.locator('.react-flow__edge[data-id="rental_services"] .rail-hit').count() };
await page.screenshot({ path: out + '/guide_step2_rental.png' });
await page.locator('.coach').getByRole('button', { name: 'Show me' }).click(); await page.waitForTimeout(3000);
r.after = await page.locator('.coach p').textContent(); r.cards = await page.locator('.pin-card').count();
console.log(JSON.stringify({ r, errors })); process.exit(0);
