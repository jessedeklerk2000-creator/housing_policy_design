// Welcome on every new visit (18 Nov 2026): shown in a new tab after it was closed in another, not after a reload.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true }); const ctx = await browser.newContext(); const errors = [];
const page = await ctx.newPage(); page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await page.waitForSelector('.modal.welcome', { timeout: 120000 });
await page.getByRole('button', { name: 'Explore on my own', exact: true }).click();
await page.reload(); await page.waitForTimeout(4000); const afterReload = await page.locator('.modal.welcome').count();
const tab2 = await ctx.newPage(); await tab2.goto('http://127.0.0.1:8001/'); await tab2.waitForTimeout(4000); const newTab = await tab2.locator('.modal.welcome').count();
console.log(JSON.stringify({ afterReload, newTab, errors })); process.exit(0);
