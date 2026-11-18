// ?tour=N opens the guided tour at step N (landing-page links, 17 Nov 2026); the parameter is then removed.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true }); const r = {}; const errors = [];
for (const n of [1, 8, 12]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:8001/?tour=${n}`); await page.waitForSelector('.coach', { timeout: 120000 }); await page.waitForTimeout(1500);
  r[n] = { coach: (await page.locator('.coach-head b').textContent()), welcome: await page.locator('.modal.welcome').count(), url: page.url() }; await page.close();
}
console.log(JSON.stringify({ r, errors })); process.exit(0);
