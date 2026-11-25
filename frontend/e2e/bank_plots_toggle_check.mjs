// Bank mode: the result plots below the diagram are closed until "Show plots" (25 Nov 2026)
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }); const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/?mode=bank'); await page.waitForSelector('.bus-diagram', { timeout: 60000 }); await page.waitForTimeout(1500);
const before = await page.locator('.bank-grid3').count();
await page.getByRole('button', { name: 'Show plots' }).click(); await page.waitForTimeout(800);
const after = await page.locator('.bank-grid3').count();
console.log(JSON.stringify({ before, after, ok: before === 0 && after === 1, errors })); process.exit(0);
