// Bank bus view: a plot card from the Balance sheet is not covered by the Key figures box (25 Nov 2026)
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } }); const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/?mode=bank'); await page.waitForSelector('.bus-diagram', { timeout: 90000 }); await page.waitForTimeout(2000);
const click = async name => { await page.getByRole('button', { name, exact: true }).dispatchEvent('click'); await page.waitForTimeout(800); };
await click('Expand My Bank'); await click('Expand Accounting'); await click('Expand Balance sheet'); await click('Expand Metrics');
await page.locator('.bus-canvas .react-flow__controls-fitview').dispatchEvent('click'); await page.waitForTimeout(900);
const bal = page.locator('.bus-stmt-body').filter({ has: page.locator('.stmt-balance') });
await bal.locator('.stmt-row', { hasText: 'Savings' }).first().locator('.stmt-val').dispatchEvent('click'); await page.waitForTimeout(600);
// the element on top at the card's centre must belong to the card
const onTop = await page.evaluate(() => { const c = document.querySelector('.stmt-plot-card').getBoundingClientRect(); const el = document.elementFromPoint(c.left + c.width * 0.75, c.top + c.height / 2); return !!el?.closest('.stmt-plot-card'); });
await page.locator('.bus-canvas').screenshot({ path: out + '/stmt_card_top.png' });
console.log(JSON.stringify({ onTop, errors })); process.exit(0);
