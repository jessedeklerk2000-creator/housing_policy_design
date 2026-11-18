// Guided tour, CPB-history step: after choosing Compare with CPB and clicking CBS, the cards do not overlap.
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:8001/');
await page.getByRole('button', { name: 'Take the full guided tour' }).first().click();
await page.getByRole('button', { name: /Guide step \d+: The CPB/ }).click(); await page.waitForTimeout(7000);
for (let i = 0; i < 3; i++) { await page.locator('.coach').getByRole('button', { name: 'Show me' }).click(); await page.waitForTimeout(i === 2 ? 16000 : 3500); }
const boxes = await page.locator('.pin-card').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }));
await page.screenshot({ path: out + '/guide_cpb_step.png' });
console.log(JSON.stringify({ boxes })); process.exit(0);
