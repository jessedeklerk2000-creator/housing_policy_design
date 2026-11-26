// Round 2 follow-up (26 Nov 2026): during Play nothing outside the numbers may move: the time slider, the top bar,
// the canvas and the panel keep their boxes, in the bus view and in the control-loop view.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }); const errors = [], fail = []; page.on('pageerror', e => errors.push(String(e)));
const boxes = () => page.evaluate(() => {
  const sel = ['input[type=range]', '.bus-canvas', '.map-canvas', '.react-flow__viewport', '.top-bar', 'header', '.map-panel', '.bus-time', '.year-slider', '.react-flow__node', '.react-flow__edgelabel-renderer > *', '.pin-card', '.map-head', '.left-dock', '.right-dock'];
  const o = {}; for (const s of sel) document.querySelectorAll(s).forEach((el, i) => { const r = el.getBoundingClientRect(); if (r.width) o[s + i] = [r.x, r.y, r.width, r.height].map(v => Math.round(v * 10) / 10).join(',') + (s === '.react-flow__viewport' ? el.style.transform : ''); });
  return o; });
async function watch(name) {
  const play = page.getByRole('button', { name: /Play/ }).first(); await play.click(); const seen = [];
  for (let i = 0; i < 25; i++) { await page.waitForTimeout(150); seen.push(await boxes()); }
  await page.getByRole('button', { name: /Pause/ }).first().click().catch(() => {});
  const moved = {}; for (const k of Object.keys(seen[0])) { const vals = new Set(seen.map(s => s[k])); if (vals.size > 1) moved[k] = [...vals].slice(0, 3); }
  if (Object.keys(moved).length) fail.push({ name, moved });
}
await page.goto('http://127.0.0.1:8001/?mode=bank'); await page.waitForSelector('.bus-diagram', { timeout: 60000 }); await page.waitForTimeout(2500);
await watch('bus');
// the diagram node must never be hidden during Play (a hidden node lets the mouse fall through to the pane: cursor flicker)
{ await page.getByRole('button', { name: /Play/ }).first().click();
  const hidden = await page.evaluate(async () => { let n = 0; const el = document.querySelector('.bus-canvas .react-flow__node');
    for (let i = 0; i < 150; i++) { if (getComputedStyle(el).visibility === 'hidden') n++; await new Promise(r => setTimeout(r, 20)); } return n; });
  await page.getByRole('button', { name: /Pause/ }).first().click().catch(() => {});
  if (hidden) fail.push({ hiddenSamples: hidden }); console.error('hidden samples', hidden); }
await page.goto('http://127.0.0.1:8001/?mode=bank&view=loop'); await page.waitForSelector('.map-canvas .react-flow__node', { timeout: 60000 }); await page.waitForTimeout(3000);
const loopPlay = await page.getByRole('button', { name: /Play/ }).count();
await watch('loop');
console.error('loop play buttons', loopPlay);
console.log(JSON.stringify({ fail, errors }, null, 1)); process.exit(0);
