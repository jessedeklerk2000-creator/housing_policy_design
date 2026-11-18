// Guided tour: a page reload resumes the tour at the same step (no welcome card).
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/');
await page.getByRole('button', { name: 'Take the full guided tour' }).first().click();
await page.getByRole('button', { name: 'Guide step 3:' }).click(); await page.waitForTimeout(6000);
await page.reload(); await page.waitForTimeout(9000);
const r = { bar: await page.locator('.guide-bar .tour-text strong').textContent().catch(() => null), welcome: await page.getByRole('button', { name: 'Take the full guided tour' }).first().count() };
await page.getByRole('button', { name: 'Identify system' }).click(); await page.waitForTimeout(4000);
r.afterIdent = await page.locator('.guide-bar .tour-text strong').textContent().catch(() => null);
console.log(JSON.stringify({ r, errors })); process.exit(0);
