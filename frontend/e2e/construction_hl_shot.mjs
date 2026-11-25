// New construction (2.14) highlighted with Investors open: the construction payment lights up to R13 and stops there
// (25 Nov 2026, Jesse: "the money flow goes too far"). Usage: node e2e/construction_hl_shot.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page); await page.waitForTimeout(2500);
const b = page.getByRole('button', { name: 'CPB formulas' }); if (await b.getAttribute('aria-pressed') !== 'true') await b.click(); await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Expand Investors' }).first().dispatchEvent('click'); await page.waitForTimeout(1500);
await page.locator('.formulas .eq', { hasText: 'New construction' }).first().dispatchEvent('click'); await page.waitForTimeout(1000);
const inv = page.locator('.react-flow__node[data-id="investors"]');
const lit = await inv.locator('.lit-wires path').count();
await inv.screenshot({ path: out + '/construction_hl.png', timeout: 60000 });
// Budget (2.1) with Households open: each money flow lit up to its own element, not the whole household node
await page.getByRole('button', { name: 'Collapse Investors' }).first().dispatchEvent('click'); await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Expand Households' }).first().dispatchEvent('click'); await page.waitForTimeout(1500);
await page.locator('.formulas .eq', { hasText: 'Budget' }).first().dispatchEvent('click'); await page.waitForTimeout(1000);
const hh = page.locator('.react-flow__node[data-id="households"]');
const litHh = await hh.locator('.lit-wires path').count();
await hh.screenshot({ path: out + '/budget_hl.png', timeout: 60000 });
console.log(JSON.stringify({ lit, litHh, errors })); process.exit(0);
