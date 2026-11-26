// SOT on the canvas (26 Nov 2026): pick a rate shock in the top bar; the shock arrow, the shocked yield curve and the SOT
// card appear; clicking a bar selects another scenario. Usage: node e2e/bank_sot_check.mjs outdir
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1050 } }); const errors = [], fail = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/?mode=bank'); await page.waitForSelector('.bus-diagram', { timeout: 60000 }); await page.waitForTimeout(2500);
await page.getByLabel('Rate shock (SOT)').selectOption('parallel_down'); await page.waitForTimeout(2500);
await page.locator('.react-flow__controls-fitview').dispatchEvent('click'); await page.waitForTimeout(1200);
const card = await page.locator('.sot-card').innerText().catch(() => '');
const arrow = await page.locator('.bus-diagram text').filter({ hasText: 'rate shock' }).count();
await page.locator('.bus-canvas').screenshot({ path: `${out}/sot_canvas.png` });
await page.locator('.sot-card').screenshot({ path: `${out}/sot_card.png` });
await page.locator('.sot-card svg g[style*="pointer"]').nth(3).dispatchEvent('click'); await page.waitForTimeout(800);
const sel = await page.locator('.sot-sel').innerText().catch(() => '');
if (!/Parallel down/.test(card) || !arrow || !/Flattener/.test(sel)) fail.push({ card: card.slice(0, 120), arrow, sel });
console.log(JSON.stringify({ fail, sel, errors })); process.exit(0);
