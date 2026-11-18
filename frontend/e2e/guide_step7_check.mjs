// Guided tour step 7: close the loop, the disturbance arrow opens all six disturbances, Play, then the zoom on the year-on-year card.
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 500)));
await page.goto('http://127.0.0.1:8001/');
await page.getByRole('button', { name: 'Take the full guided tour' }).first().click();
await page.getByRole('button', { name: /Guide step \d+: Close the loop/ }).click(); await page.waitForTimeout(8000);
const log = [];
for (let i = 0; i < 3; i++) { const h = await page.locator('.coach-head b').textContent(); await page.locator('.coach').getByRole('button', { name: 'Show me' }).click(); await page.waitForTimeout(i === 2 ? 20000 : 4000); log.push(`${h} -> cards ${await page.locator('.pin-card').count()}`); await page.screenshot({ path: `${out}/guide7_${i + 1}.png` }); }
log.push(await page.locator('.coach-head b').textContent());
console.log(JSON.stringify({ log, errors })); process.exit(0);
