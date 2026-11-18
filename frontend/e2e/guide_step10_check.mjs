// Guided tour, last step (H-inf): every sub-step with Show me; screenshot and drawn blocks after each.
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 600))); page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
await page.goto('http://127.0.0.1:8001/');
await page.getByRole('button', { name: 'Take the full guided tour' }).first().click();
await page.getByRole('button', { name: /Guide step \d+: A robust rule/ }).click(); await page.waitForTimeout(10000);
const nodes = () => page.locator('.react-flow__node').evaluateAll(ns => ns.filter(n => getComputedStyle(n).visibility !== 'hidden' && n.getBoundingClientRect().width > 2).length);
const log = [`start: nodes ${await nodes()}, cards ${await page.locator('.pin-card').count()}`];
await page.screenshot({ path: `${out}/guide10_0.png` });
for (let i = 0; i < 4; i++) {
  const h = await page.locator('.coach-head b').textContent().catch(() => '?');
  const b = page.locator('.coach').getByRole('button', { name: 'Show me' }); if (!(await b.count())) break;
  await b.click(); await page.waitForTimeout(i === 1 ? 20000 : 5000);
  log.push(`${h}: nodes ${await nodes()}, cards ${await page.locator('.pin-card').count()}`);
  await page.screenshot({ path: `${out}/guide10_${i + 1}.png` });
}
console.log(JSON.stringify({ log, errors })); process.exit(0);
