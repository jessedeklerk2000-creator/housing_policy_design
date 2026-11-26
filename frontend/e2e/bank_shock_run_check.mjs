// Rate shock as a full netlist run (26 Nov 2026): picking a scenario reruns the bank netlist; the shock arrow opens its
// pattern; the interbank rate (effort e on the interbank link) jumps at the shock year; ALM desk switch in the top bar.
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1050 } }); const errors = [], fail = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/?mode=bank'); await page.waitForSelector('.bus-diagram', { timeout: 60000 }); await page.waitForTimeout(2500);
const desk = await page.getByRole('group', { name: 'ALM desk' }).count();
await page.getByLabel('Rate shock (SOT)').selectOption('parallel_up'); await page.waitForTimeout(8000);
await page.locator('.bus-wires polyline', { has: page.locator('title', { hasText: 'Rate shock' }) }).first().dispatchEvent('click'); await page.waitForTimeout(600);
const pattern = await page.locator('.bus-pick svg[aria-label="Rate shock per maturity"]').count();
await page.locator('.react-flow__controls-fitview').dispatchEvent('click'); await page.waitForTimeout(1000);
await page.locator('.bus-canvas').screenshot({ path: `${out}/shock_run.png` });
// the interbank rate at year index before and after the shock (meter title holds the value)
const at = async i => { await page.locator('.bus-time input[type=range]').evaluate((el, v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); }, i); await page.waitForTimeout(500);
  return page.evaluate(() => [...document.querySelectorAll('.bus-over g')].map(g => g.querySelectorAll('title')).filter(t => t.length === 2 && t[0].textContent.startsWith('Effort')).map(t => t[1].textContent)); };
const before = await at(20), after = await at(50);
if (!desk || !pattern) fail.push({ desk, pattern });
console.log(JSON.stringify({ fail, before: before.slice(-3), after: after.slice(-3), errors })); process.exit(0);
