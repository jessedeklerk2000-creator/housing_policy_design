// Bank bus view: a statement box (Key figures) grows when its corner grip is dragged (25 Nov 2026). Usage: node e2e/stmt_resize_check.mjs outdir
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1050 } }); const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/?mode=bank'); await page.waitForSelector('.bus-diagram', { timeout: 60000 }); await page.waitForTimeout(2000);
const click = async name => { await page.getByRole('button', { name, exact: true }).dispatchEvent('click'); await page.waitForTimeout(900); };
await click('Expand My Bank'); await click('Expand Treasury (treasurer)'); await click('Expand Accounting'); await click('Expand Metrics'); await page.waitForTimeout(800);
await page.locator('.bus-canvas .react-flow__controls-fitview').dispatchEvent('click'); await page.waitForTimeout(900);  // no auto-zoom on Accounting
const box = () => page.locator('.map-node', { has: page.locator('strong', { hasText: /^Metrics$/ }) }).boundingBox();
const b0 = await box(), g = await page.getByLabel('Resize Metrics').boundingBox();
await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down(); await page.mouse.move(g.x + 160, g.y + 220, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(600);
const b1 = await box();
await page.locator('.bus-canvas').screenshot({ path: out + '/stmt_resize.png' });
const grew = b1.width > b0.width + 50 && b1.height > b0.height + 50;
console.log(JSON.stringify({ grew, b0: [b0.width, b0.height].map(Math.round), b1: [b1.width, b1.height].map(Math.round), errors })); process.exit(0);
