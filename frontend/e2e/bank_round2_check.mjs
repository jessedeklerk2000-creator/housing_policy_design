// Feedback round 2 (26 Nov 2026): DNB block with threshold signal, yield curve, competitor bank (switched on in the
// Scenario panel, Other banks), ALM desk on. Usage: node e2e/bank_round2_check.mjs outdir
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1050 } }); const errors = [], fail = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/?mode=bank');
await page.waitForSelector('.bus-diagram', { timeout: 60000 }); await page.waitForTimeout(2000);
const click = async name => { await page.getByRole('button', { name }).first().dispatchEvent('click'); await page.waitForTimeout(600); };
const off = await page.locator('.bus-comp').innerText().catch(() => '');
// the knob lives in the Other banks panel of the scenario dock
for (const n of ['Open scenario panel']) { const b = page.getByRole('button', { name: n, exact: true }); if (await b.count()) await b.first().click(); }
await page.waitForTimeout(800);
let knob = page.locator('input[aria-label="Competitor bank"]');
if (!(await knob.count())) { const t = page.getByText('Other banks', { exact: false }).first(); await t.click().catch(() => {}); await page.waitForTimeout(800); knob = page.locator('input[aria-label="Competitor bank"]'); }
const found = await knob.count();
if (found) { await knob.first().evaluate(el => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, '1'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(9000); }
await click('Expand Financial sector'); await page.waitForTimeout(800);
await page.locator('.react-flow__controls-fitview').dispatchEvent('click'); await page.waitForTimeout(1000);
const on = await page.locator('.bus-comp').innerText().catch(() => '');
const yc = await page.locator('.bus-yield').count(), dnb = await page.locator('.bus-diagram').innerText().then(t => t.includes('DNB / central bank'));
await page.locator('.bus-canvas').screenshot({ path: `${out}/round2_top.png` });
if (!yc || !dnb || !/Market share/.test(on)) fail.push({ yc, dnb, found, on });
console.log(JSON.stringify({ fail, off, on, errors })); process.exit(0);
