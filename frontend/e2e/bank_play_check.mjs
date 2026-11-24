// Bank controls: with the ALM desk selected, pinned cards show the bank run (not step responses) and Play animates them.
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }); const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/?mode=bank');
await page.waitForSelector('.map-canvas .react-flow__node', { timeout: 40000 }); await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(1500);
const marks = page.locator('.map-canvas svg text').filter({ hasText: /^(u1|u2|d|x₁|x₂|y|r|e|r₁|r₂|e₁|e₂|y₁|y₂)$/ }); const nm = await marks.count();
for (let i = 0; i < nm; i++) { await marks.nth(i).click({ force: true }).catch(() => errors.push('pin ' + i)); await page.waitForTimeout(500); }
await page.locator('.react-flow__node').filter({ hasText: 'ALM Desk' }).first().click(); await page.waitForTimeout(2000);
const heads = await page.locator('.pin-head strong').allTextContents();
const play = page.getByRole('button', { name: 'Play through time' }); await play.click(); await page.waitForTimeout(2500);
const y1 = await page.locator('.year-slider output').textContent();
await page.locator('.map-panel').screenshot({ path: `${out}/bank_play_mid.png` });
await page.waitForTimeout(6000); const y2 = await page.locator('.year-slider output').textContent();
await page.locator('.map-panel').screenshot({ path: `${out}/bank_play_end.png` });
console.log(JSON.stringify({ heads, y1, y2, errors })); process.exit(0);
