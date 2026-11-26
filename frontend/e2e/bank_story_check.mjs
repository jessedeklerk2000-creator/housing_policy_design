// The demo story (26 Nov 2026): three steps in the top bar; each sets the scenario, opens its blocks and shows a caption.
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } }); const errors = [], fail = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/?mode=bank'); await page.waitForSelector('.bus-diagram', { timeout: 60000 }); await page.waitForTimeout(2500);
const res = {};
for (const [k, name] of [[1, 'Crises'], [2, 'Competitor'], [3, 'SOT']]) {
  await page.getByRole('group', { name: 'Story' }).getByRole('button', { name: `${k} ${name}` }).click(); await page.waitForTimeout(9000);
  res[k] = { caption: (await page.locator('.story-caption').innerText()).slice(0, 40), stmts: await page.locator('.bus-stmt-body').count(), comp: await page.locator('.comp-stmt').count(), sot: await page.locator('.sot-card').count(), bankCurve: await page.locator('.bank-curve').count() };
  await page.locator('.bus-canvas').screenshot({ path: `${out}/story_${k}.png` });
}
if (!res[1].stmts || !res[2].comp || !res[3].sot || !res[1].bankCurve) fail.push(res);
console.log(JSON.stringify({ fail, res, errors })); process.exit(0);
