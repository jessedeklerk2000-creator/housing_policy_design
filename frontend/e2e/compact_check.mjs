// Compact chrome: in the guided tour the canvas fills the window down to the action bar.
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/');
await page.getByRole('button', { name: 'Take the full guided tour' }).first().click(); await page.waitForTimeout(8000);
const c = await page.locator('.map-canvas').boundingBox(), f = await page.locator('.action-bar').boundingBox(), h = await page.locator('.map-head').boundingBox();
await page.screenshot({ path: out + '/compact.png' });
console.log(JSON.stringify({ canvasTop: c.y, canvasBottom: c.y + c.height, footTop: f.y, headHeight: h.height, errors })); process.exit(0);
