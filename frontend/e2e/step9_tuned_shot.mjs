// Step 9 (17-18 Nov 2026): tune P, keep the original Ziegler–Nichols rule dotted, compare on the W crisis.
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/?tour=9'); await page.waitForSelector('.coach', { timeout: 120000 }); await page.waitForTimeout(6000);
const coach = () => page.locator('.coach-head b').textContent();
const show = async () => { await page.locator('.coach').getByRole('button', { name: /Show me|Continue/ }).click(); };
const waitPlay = async () => { await page.waitForFunction(() => !document.querySelector('.map-canvas.playing'), null, { timeout: 120000 }); await page.waitForTimeout(2500); };
const log = [];
for (let i = 0; i < 8; i++) { log.push(await coach()); await show(); await page.waitForTimeout(3000); await waitPlay(); }
log.push(await coach());
await page.screenshot({ path: `${out}/step9_tuned.png` });
const notes = await page.locator('.pin-card small').allTextContents();
console.log(JSON.stringify({ log, notes, errors })); process.exit(0);
