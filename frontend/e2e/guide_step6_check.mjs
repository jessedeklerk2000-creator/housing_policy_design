// Guided tour step 6 (bank and shocks): every sub-step with Show me; screenshot after each; count drawn blocks.
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 500))); page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
await page.goto('http://127.0.0.1:8001/');
await page.getByRole('button', { name: 'Take the full guided tour' }).first().click();
await page.getByRole('button', { name: /Guide step \d+: The real world/ }).click(); await page.waitForTimeout(8000);
const log = [];
for (let i = 0; i < 9; i++) { if (!(await page.locator(".coach").getByRole("button", { name: "Show me" }).count())) { await page.locator(".coach").getByRole("button", { name: "Continue" }).click(); await page.waitForTimeout(3000); await page.screenshot({ path: `${out}/guide6_${i + 1}.png` }); log.push("continue"); continue; }
  const h = await page.locator('.coach-head b').textContent();
  await page.locator('.coach').getByRole('button', { name: 'Show me' }).click(); await page.waitForTimeout(i === 8 ? 15000 : 4000);
  const vis = await page.locator('.react-flow__node').evaluateAll(ns => ns.filter(n => getComputedStyle(n).visibility !== 'hidden' && n.getBoundingClientRect().width > 2).length);
  log.push(`${h}: visible nodes ${vis}`);
  await page.screenshot({ path: `${out}/guide6_${i + 1}.png` });
}
console.log(JSON.stringify({ log, errors })); process.exit(0);
