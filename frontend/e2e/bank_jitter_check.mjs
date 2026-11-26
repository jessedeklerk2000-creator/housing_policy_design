// Feedback round 2, A1/A10 (26 Nov 2026): Play with Accounting and every statement open. No block or box may move
// (positions and sizes of every .map-node and frame stay the same) and the account bars must follow the cursor.
// Usage: node e2e/bank_jitter_check.mjs outdir
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1050 } }); const errors = [], fail = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/?mode=bank');
await page.waitForSelector('.bus-diagram', { timeout: 60000 }); await page.waitForTimeout(2000);
const click = async name => { await page.getByRole('button', { name }).first().dispatchEvent('click'); await page.waitForTimeout(500); };
await click('Expand My Bank'); await click('Expand Treasury (treasurer)'); await click('Expand Accounting');
for (const b of ['Income statement', 'Cash flow statement', 'Balance sheet', 'Metrics']) await click('Expand ' + b);
await page.waitForTimeout(1200);
const snap = () => page.evaluate(() => ({
  boxes: [...document.querySelectorAll('.bus-diagram .map-node, .bus-org-frame')].map(n => { const s = n.style; return [s.left, s.top, s.width, s.height].join(','); }).join('|'),
  vp: document.querySelector('.bus-canvas .react-flow__viewport').style.transform,
  bars: [...document.querySelectorAll('.bus-stmt-body .stmt-bar i')].map(i => i.style.width).join(','),
  year: document.querySelector('.bus-time span')?.textContent }));
await page.locator('.bus-time input[type=range]').evaluate(el => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, '0'); el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(800);
const s0 = await snap(); const play = page.getByRole('button', { name: 'Play through time' }); await play.dispatchEvent('click');
const seen = []; for (let i = 0; i < 24; i++) { await page.waitForTimeout(400); seen.push(await snap()); }
const diff = (a, b) => a.split("|").map((x, i) => x === b.split("|")[i] ? null : i + ":" + b.split("|")[i] + "->" + x).filter(Boolean); seen.forEach((s, i) => { if (s.boxes !== s0.boxes) console.error(i, s.year, diff(s.boxes, s0.boxes).join(" ")); });
const moved = seen.filter(s => s.boxes !== s0.boxes || s.vp !== s0.vp).length, barsChanged = new Set(seen.map(s => s.bars)).size;
if (moved) fail.push({ moved, of: seen.length });
if (barsChanged < 5) fail.push({ barsChanged });
await page.locator('.bus-canvas').screenshot({ path: `${out}/jitter_end.png` });
console.log(JSON.stringify({ fail, moved, barsChanged, years: seen.map(s => s.year).join(' '), errors })); process.exit(0);
