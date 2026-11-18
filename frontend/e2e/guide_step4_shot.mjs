// Guided tour step 4: plot cards near their lines (income above the market, subsidy above the Tax Authority, price right).
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:8001/');
await page.getByRole('button', { name: 'Take the full guided tour' }).first().click();
await page.getByRole('button', { name: 'Guide step 4:' }).click(); await page.waitForTimeout(8000);
await page.screenshot({ path: out + '/guide_step4.png' }); process.exit(0);
