// Bank controls on the model canvas (20 Nov 2026): closed loop, Economy opened (CPB quadrants + financial sector, bank
// agent), ALM desk opened, Reporting opened; the side panel for the desk.
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }); const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/?mode=bank');
await page.waitForSelector('.map-canvas .react-flow__node', { timeout: 40000 }); await page.waitForTimeout(2500);
const shot = async n => page.locator('.map-panel').screenshot({ path: `${out}/${n}.png` });
await shot('map_closed');
const labels = await page.locator('.react-flow__node').allTextContents();
const open = async label => { const n = page.locator('.react-flow__node').filter({ hasText: label }).first(); await n.locator('button.toggle').first().click(); await page.waitForTimeout(2500); };
await open('Economy'); await shot('map_economy');
await open('CPB Four Quadrants'); await open('Financial sector'); await shot('map_quadrants');
await page.locator('.react-flow__node').filter({ hasText: /^Bank/ }).first().locator('button.toggle').first().click(); await page.waitForTimeout(2500); await shot('map_bank');
await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(2000); await shot('map_bank_whole');
await page.getByRole('button', { name: 'Collapse all' }).click(); await page.waitForTimeout(1500);
await open('ALM Desk'); await shot('map_desk');
await page.getByRole('button', { name: 'Collapse all' }).click(); await page.waitForTimeout(1000);
await open('ALM Reporting'); await shot('map_reporting');
await page.reload(); await page.waitForSelector('.map-canvas .react-flow__node', { timeout: 40000 }); await page.waitForTimeout(2500);
await page.locator('.react-flow__node').filter({ hasText: 'ALM Desk' }).first().click(); await page.waitForTimeout(1200);
const panel = await page.locator('aside.inspector').last().textContent().catch(() => '');
await page.getByRole('button', { name: 'Desk off' }).click(); await page.waitForTimeout(4000); await shot('map_deskoff');
console.log(JSON.stringify({ labels: labels.slice(0, 12), panel: (panel || '').slice(0, 160), errors })); process.exit(0);
