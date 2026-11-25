// Handoff FIGURE_LABELS_NAMING (25 Nov 2026): figure export cropped to content, faded parts hidden, formula symbols as
// labels, display names instead of raw netlist ids. Usage: node e2e/figure_labels_check.mjs outdir
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { openPanels } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
const errors = [], fail = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page); await page.waitForTimeout(2500);
const b = page.getByRole('button', { name: 'CPB formulas' }); if (await b.getAttribute('aria-pressed') !== 'true') await b.click(); await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Expand Households' }).first().dispatchEvent('click'); await page.waitForTimeout(1500);
// names: no raw ids such as R12 / L11 as visible label text (the <title> debug tooltip may keep them)
const raw = await page.evaluate(() => [...document.querySelectorAll('.circuit .element text')].map(t => [...t.childNodes].filter(n => n.nodeName !== 'title').map(n => n.textContent).join('')).filter(s => /^[RLCVIB]\d+$/.test(s)));
if (raw.length) fail.push({ raw });
// figure mode, Utility and budget highlighted, symbols as labels
await page.getByRole('button', { name: 'Figure mode' }).click(); await page.waitForTimeout(600);
await page.getByLabel('hide faded').check(); await page.waitForTimeout(300);
await page.getByLabel('Highlight formula').selectOption('utility'); await page.getByLabel('Element labels').selectOption('symbols'); await page.waitForTimeout(1200);
const r = await page.evaluate(() => {
  const vis = el => { for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.visibility === 'hidden' || s.display === 'none') return false; } return true; };
  const hh = document.querySelector('.react-flow__node[data-id="households"]');
  const labels = [...hh.querySelectorAll('.el-sym .katex')].map(k => k.textContent);
  const shown = name => [...hh.querySelectorAll('.element')].some(g => g.getAttribute('aria-label')?.startsWith(name + ',') && vis(g));
  return { labels, node: !!hh.querySelector('.formula-node'), C6: shown('C6'), R2: shown('R2'), R18: shown('R18'), Rent: shown('L§Rent') };
});
if (r.labels.length < 6 || !r.node || r.C6 || r.R2 || r.R18 || !r.Rent) fail.push({ r });
await page.locator('.react-flow__controls-fitview').dispatchEvent('click'); await page.waitForTimeout(1200);
await page.locator('.map-canvas').screenshot({ path: out + '/figure_symbols.png' });
// the saved figure is cropped: smaller than the whole canvas at 4x
const box = await page.locator('.map-canvas').boundingBox();
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save figure' }).click()]);
const f = await dl.path(), png = readFileSync(f), W = png.readUInt32BE(16), H = png.readUInt32BE(20);
const cropped = W < box.width * 4 - 40 || H < box.height * 4 - 40;
if (!cropped) fail.push({ png: [W, H], canvas: [box.width * 4, box.height * 4] });
console.log(JSON.stringify({ fail, r, png: [W, H], canvas4x: [Math.round(box.width * 4), Math.round(box.height * 4)], errors })); process.exit(0);
