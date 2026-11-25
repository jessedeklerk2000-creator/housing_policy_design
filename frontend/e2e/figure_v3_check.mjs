// Figure mode follow-up (25 Nov 2026): no highlight boxes, element labels as big as flow labels, no overlapping labels.
// Saves figure_households_v3.png (Save selection, Households) for Jesse. Usage: node e2e/figure_v3_check.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, acceptDownloads: true });
const errors = [], fail = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page); await page.waitForTimeout(2500);
const b = page.getByRole('button', { name: 'CPB formulas' }); if (await b.getAttribute('aria-pressed') !== 'true') await b.click(); await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Expand Households' }).first().dispatchEvent('click'); await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Figure mode' }).click(); await page.waitForTimeout(600);
await page.getByLabel('Highlight formula').selectOption('utility'); await page.waitForTimeout(1200);
const r = await page.evaluate(() => {
  const vis = el => { for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') return false; } return true; };
  const hits = [...document.querySelectorAll('.map-canvas .circuit .element .hit')].filter(h => { const f = getComputedStyle(h).fill; return vis(h) && f !== 'none' && f !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(f); }).length;
  const svg = document.querySelector('.react-flow__node[data-id="households"] svg.circuit'), k = svg.viewBox.baseVal.width / svg.getBoundingClientRect().width;
  const z = new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a;
  const elPx = parseFloat(getComputedStyle(svg.querySelector('.element text')).fontSize) / (k * z), railPx = parseFloat(getComputedStyle(document.querySelector('.rail-name')).fontSize);
  const labels = [...svg.querySelectorAll('.el-label')].filter(vis).map(l => l.getBoundingClientRect()).filter(q => q.width > 1);
  let overlaps = 0; for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) { const a = labels[i], c = labels[j]; if (a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom) overlaps++; }
  return { hits, elPx: +elPx.toFixed(2), railPx, labels: labels.length, overlaps };
});
if (r.hits || Math.abs(r.elPx - r.railPx) > 0.5 || r.overlaps) fail.push(r);
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save selection' }).click()]);
await dl.saveAs(out + '/figure_households_v3.png');
console.log(JSON.stringify({ fail, r, errors })); process.exit(0);
