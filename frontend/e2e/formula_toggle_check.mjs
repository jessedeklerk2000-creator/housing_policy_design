// Outside the tour: the CPB formulas button shows the equations on the agents, a click lights its flows, a second
// click hides them. Usage: node e2e/formula_toggle_check.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page); await page.waitForTimeout(3000);
const btn = page.getByRole('button', { name: 'CPB formulas' });
await btn.click(); await page.waitForTimeout(2000);
await page.locator('.react-flow__controls-fitview').dispatchEvent('click'); await page.waitForTimeout(1500);
const on = await page.locator('.eq').count();
await page.locator('.eq', { hasText: 'Budget' }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
const lit = await page.locator('.react-flow__edge.lit').evaluateAll(es => [...new Set(es.map(e => e.getAttribute('data-id')))]);
await page.locator('.map-body').screenshot({ path: out + '/formula_toggle.png', timeout: 60000 });
await btn.click(); await page.waitForTimeout(1500);
console.log(JSON.stringify({ on, lit, off: await page.locator('.eq').count(), litAfter: await page.locator('.react-flow__edge.lit').count(), errors })); process.exit(0);
