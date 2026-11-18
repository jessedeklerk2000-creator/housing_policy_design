// Guided tour step 5: choosing a setting does not run; ▶ runs, then plays; each sub-step moves on.
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
let runs = 0; page.on('request', r => { if (r.url().includes('/api/runs') && r.method() === 'POST') runs++; });
await page.goto('http://127.0.0.1:8001/');
await page.getByRole('button', { name: 'Take the full guided tour' }).first().click();
await page.getByRole('button', { name: /Guide step \d+: Phase out/ }).click(); await page.waitForTimeout(7000);
const log = [], head = () => page.locator('.coach-head b').textContent();
for (let i = 0; i < 4; i++) {
  const h = await head(), r0 = runs;
  await page.locator('.coach').getByRole('button', { name: 'Show me' }).click(); await page.waitForTimeout(2500);
  const r1 = runs;
  await page.waitForFunction(p => document.querySelector('.coach-head b')?.textContent !== p, h, { timeout: 30000 }).catch(() => {});
  log.push(`${h}: runs during ${r1 - r0}, now ${await head()}`);
}
await page.screenshot({ path: out + '/guide_play_runs.png' });
console.log(JSON.stringify({ log, errors })); process.exit(0);
