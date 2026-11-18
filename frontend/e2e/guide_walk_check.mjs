// Guided tour (all steps, counted from the bar): the welcome card offers it; every sub-step is done with "Show me" (or Continue) and must move on;
// a screenshot at the end of each step. Usage: node e2e/guide_walk_check.mjs outdir
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/');
const log = { welcome: await page.getByRole('button', { name: 'Take the full guided tour' }).first().isVisible({ timeout: 60000 }).catch(() => false), steps: [] };
await page.getByRole('button', { name: 'Take the full guided tour' }).first().click();
const head = () => page.locator('.coach-head b').textContent({ timeout: 120000 });
await page.locator('.guide-bar').waitFor({ timeout: 120000 }); const N = await page.locator('.guide-bar .tour-steps button').count();
for (let step = 1; step <= N; step++) {
  const rec = { step, subs: [] };
  await page.waitForFunction(n => document.querySelector('.coach-head b')?.textContent?.startsWith(`Step ${n} `), step, { timeout: 120000 });
  await page.waitForTimeout(2500);
  for (let i = 0; i < 12; i++) {
    const h = await head(); if (h.endsWith('done') || !h.startsWith(`Step ${step} `)) break;  // a step without a closing line moves on by itself
    const ring = await page.locator('.coach-ring').count();
    const show = page.locator('.coach').getByRole('button', { name: 'Show me' }), cont = page.locator('.coach').getByRole('button', { name: 'Continue' });
    const how = await show.count() ? 'show' : 'continue';
    await page.waitForFunction(() => !document.querySelector('.coach button[disabled]'), null, { timeout: 120000 });
    if (how === 'show') await show.click(); else await cont.click();
    const ok = await page.waitForFunction(prev => document.querySelector('.coach-head b')?.textContent !== prev, h, { timeout: 60000 }).then(() => true).catch(() => false);
    if (how === 'show') await page.screenshot({ path: `${out}/guide_${step}_${i + 1}.png` });
    rec.subs.push(`${h} [${how}${ring ? ', ring' : ', no ring'}] ${ok ? 'ok' : 'STUCK'}`);
    if (!ok) { await page.screenshot({ path: `${out}/guide_stuck_${step}.png` }); break; }
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${out}/guide_${String(step).padStart(2, '0')}.png` });
  rec.end = await page.locator('.coach p').textContent({ timeout: 2000 }).catch(() => null);  // most steps end on a bare Next step
  log.steps.push(rec);
  const next = page.locator('.coach').getByRole('button', { name: /Next step/ });
  const moved = !(await head()).startsWith(`Step ${step} `);
  if (step < N && !moved) { if (!(await next.count())) { rec.noNext = true; await page.getByRole('button', { name: `Guide step ${step + 1}:`, exact: false }).first().click(); } else await next.click(); }
}
console.log(JSON.stringify({ log, errors }, null, 1)); process.exit(0);
