// Bank mode fills the window: no page scroll, tools in the top bar, results panel on the right (25 Nov 2026)
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } }); const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/?mode=bank'); await page.waitForSelector('.bus-diagram', { timeout: 60000 }); await page.waitForTimeout(2000);
const r = await page.evaluate(() => ({ pageScroll: document.documentElement.scrollHeight > innerHeight + 2, toolsInHeader: !!document.querySelector('.topbar .bus-time'), side: !!document.querySelector('.bank-side .bank-grid3'),
  canvas: (() => { const c = document.querySelector('.bus-canvas').getBoundingClientRect(); return [Math.round(c.top), Math.round(c.bottom), innerHeight]; })() }));
await page.getByRole('button', { name: 'Open scenario panel' }).click(); await page.waitForTimeout(600); r.scenario = await page.locator('.bank-scen .bank-left').count();
await page.screenshot({ path: out + '/bank_full.png' });
await page.getByRole('tab', { name: 'Control-loop view' }).click(); await page.waitForTimeout(2500); await page.screenshot({ path: out + '/bank_full_loop.png' });
console.log(JSON.stringify({ ...r, errors })); process.exit(0);
