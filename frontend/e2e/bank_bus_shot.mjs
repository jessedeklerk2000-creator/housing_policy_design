// Bank controls, bus view (25 Nov 2026): agents by name; Households' breadboard; bank level 1 (ALCO, Accounting,
// ALM Desk); level 2 (desk breadboard; accounting: bank breadboard + statements).
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1050 } }); const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/?mode=bank');
await page.waitForSelector('.bus-diagram', { timeout: 60000 }); await page.waitForTimeout(2000);
const shot = async n => { await page.waitForTimeout(1000); await page.locator('.bus-canvas').screenshot({ path: `${out}/${n}.png` }); };
const click = async name => { await page.getByRole('button', { name }).dispatchEvent('click'); };
const titles = await page.locator('.bus-diagram .block-head strong').allTextContents();
await shot('bus_0');
await click('Expand Housing Market'); await shot('bus_hm');
// click a flow, a bus and a shock: a card with plots
const clickHit = async t => { await page.locator('.bus-wires polyline', { has: page.locator('title', { hasText: t }) }).first().dispatchEvent('click'); await page.waitForTimeout(500);
  const n = await page.locator('.bus-pick svg').count(), title = await page.locator('.bus-pick b').first().textContent(); return { t, title, plots: n }; };
const picks = [await clickHit('Houses:'), await clickHit('Covid'), await clickHit('Financial crisis')];
await page.getByRole('button', { name: 'Buses' }).click(); await page.waitForTimeout(800); await shot('bus_buses');
picks.push(await clickHit('Rent bus')); await page.getByRole('button', { name: 'Ports' }).click(); await page.waitForTimeout(500);
await shot('bus_pick'); await page.getByRole('button', { name: 'Close', exact: true }).first().dispatchEvent('click');
await click('Expand Households'); await shot('bus_hh');
await click('Collapse Households'); await page.waitForTimeout(600);
await click('Expand Bank'); await shot('bus_1');
await click('Expand ALM Desk'); await shot('bus_2_desk');
await click('Collapse ALM Desk'); await page.waitForTimeout(600);
await click('Expand Operations'); await shot('bus_2_bs');
await click('Collapse Operations'); await page.waitForTimeout(600);
await click('Expand Accounting'); await shot('bus_2_acc');
for (const b of ['Income statement', 'Equity statement', 'Cash flow statement', 'Balance sheet', 'Metrics']) await click('Expand ' + b);
await page.waitForTimeout(600); await click('Collapse Metrics'); await click('Expand Metrics'); await shot('bus_3_stmts');
await page.locator('.bus-stmt-body .stmt-val').first().dispatchEvent('click'); await page.waitForTimeout(400);
const plotted = await page.locator('.bus-stmt-body .stmt-plot').count();
// drag-to-pan while the pointer starts on the opened Accounting block
const vp = () => page.locator('.bus-canvas .react-flow__viewport').getAttribute('style');
const before = await vp(); const b = await page.locator('.bus-stmt-body').nth(3).boundingBox();
await page.mouse.move(b.x + 20, b.y + b.height - 30); await page.mouse.down(); await page.mouse.move(b.x - 300, b.y + b.height - 130, { steps: 12 }); await page.mouse.up();
await page.waitForTimeout(500); const panned = before !== await vp();
await page.getByRole('tab', { name: 'Control-loop view' }).click(); await page.waitForTimeout(3000);
const loop = await page.locator('.map-canvas .react-flow__node').count();
console.log(JSON.stringify({ titles, picks, plotted, panned, loop, errors })); process.exit(0);
