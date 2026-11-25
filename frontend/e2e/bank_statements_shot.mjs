// ALM Reporting opened (25 Nov 2026): the bank's financial statements; play to 2010, open the Tier 1 line.
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1050 } }); const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/?mode=bank&view=loop');
await page.waitForSelector('.map-canvas .react-flow__node', { timeout: 40000 }); await page.waitForTimeout(2500);
const n = page.locator('.react-flow__node').filter({ hasText: 'ALM Reporting' }).first(); await n.locator('button.toggle').first().click(); await page.waitForTimeout(3000);
await page.locator('.map-panel').screenshot({ path: `${out}/stmt_open.png` });
const row = page.locator('.stmt-row').filter({ hasText: 'Tier 1 capital ratio' }).first(); await row.click(); await page.waitForTimeout(400);
await page.locator('.stmt-row').filter({ hasText: 'Risk-weighted assets' }).first().click().catch(() => {}); await page.waitForTimeout(400);
await page.locator('.bank-statements').screenshot({ path: `${out}/stmt_detail.png` });
const txt = (await page.locator('.bank-statements').innerText()).slice(0, 300);
console.log(JSON.stringify({ txt, errors })); process.exit(0);
