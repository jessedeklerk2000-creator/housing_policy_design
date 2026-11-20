// Bank controls: pin every loop and disturbance card and list the card titles (no housing names may appear).
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 2200, height: 1300 } }); const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/?mode=bank');
await page.waitForSelector('.map-canvas .react-flow__node', { timeout: 40000 }); await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(1500);
const marks = page.locator('.map-canvas svg text').filter({ hasText: /^(u1|u2|d|x₁|x₂|y|r|e)$/ }); const nm = await marks.count();
for (let i = 0; i < nm; i++) { await marks.nth(i).click({ force: true }).catch(() => {}); await page.waitForTimeout(400); }
await page.getByRole('button', { name: 'Play through time' }).click(); await page.waitForTimeout(9000);
await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(1500);
const heads = await page.locator('.pin-head strong').allTextContents();
const text = (await page.locator('.map-panel').innerText()).replace(/\s+/g, ' ');
const ctx = ['housing', 'subsid'].flatMap(w => [...text.matchAll(new RegExp('.{0,50}' + w + '.{0,40}', 'gi'))].map(m => m[0])); console.log(JSON.stringify(ctx));
const bad = ['house', 'housing', 'subsid', 'construction', 'CBS', 'renters', 'Parliament', 'Tax Authority'].filter(w => text.toLowerCase().includes(w.toLowerCase()));
await page.locator('.map-panel').screenshot({ path: `${out}/bank_cards.png` });
console.log(JSON.stringify({ n: nm, heads, bad, errors }));
process.exit(0);
