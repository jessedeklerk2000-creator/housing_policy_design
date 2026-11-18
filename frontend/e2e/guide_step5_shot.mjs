// Guided tour step 5: the phase-out steps slider sits next to the subsidy picker; the open menu stays on screen.
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:8001/');
await page.getByRole('button', { name: 'Take the full guided tour' }).first().click();
await page.getByRole('button', { name: 'Guide step 5:' }).click(); await page.waitForTimeout(7000);
await page.locator('.coach').getByRole('button', { name: 'Show me' }).click(); await page.waitForTimeout(6000);
await page.locator('[data-guide="chip-subsidy"] button.chip').click(); await page.waitForTimeout(800);
await page.screenshot({ path: out + '/guide_step5.png' }); process.exit(0);
