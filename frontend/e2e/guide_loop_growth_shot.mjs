// Guided tour, close-the-loop step: no inflation added, the target grows 2.5% a year; screenshot after closing and Play.
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/');
await page.getByRole('button', { name: 'Take the full guided tour' }).first().click();
await page.getByRole('button', { name: /Guide step \d+: Close the loop/ }).click(); await page.waitForTimeout(8000);
await page.locator('.coach').getByRole('button', { name: 'Show me' }).click(); await page.waitForTimeout(3000);
await page.locator('.coach').getByRole('button', { name: 'Continue' }).click(); await page.waitForTimeout(1500);
await page.locator('.coach').getByRole('button', { name: 'Show me' }).click(); await page.waitForTimeout(20000);
await page.screenshot({ path: out + '/guide_loop_growth.png' });
console.log(JSON.stringify({ errors })); process.exit(0);
