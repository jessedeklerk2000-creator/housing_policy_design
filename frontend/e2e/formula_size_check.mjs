// CPB formulas grow with the label-size slider and still fit their boxes. Usage: node e2e/formula_size_check.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page); await page.waitForTimeout(3000);
await page.getByRole('button', { name: 'CPB formulas' }).click(); await page.waitForTimeout(1500);
const measure = () => page.evaluate(() => ({ font: getComputedStyle(document.querySelector('.formulas .eq .eq-body')).fontSize,
  overflow: [...document.querySelectorAll('.formulas')].map(f => { const box = f.parentElement; return box.scrollHeight - box.clientHeight > 2 || box.scrollWidth - box.clientWidth > 2; }) }));
const r = {};
for (const v of ['1', '1.3', '2.5']) { await page.getByRole('slider', { name: 'Label size' }).fill(v); await page.waitForTimeout(1200); r[v] = await measure(); }
await page.locator('.react-flow__node[data-id="households"] button').first().dispatchEvent('click'); await page.waitForTimeout(2000);
r.openHouseholds = await measure();
await page.locator('.react-flow__controls-fitview').click(); await page.waitForTimeout(1500);
await page.locator('.map-body').screenshot({ path: out + '/formula_size.png', timeout: 60000 });
// Firms opened at the largest labels: its header band sits above the circuit
await page.locator('.react-flow__node[data-id="firms"] button').first().dispatchEvent('click'); await page.waitForTimeout(2000);
const fn = page.locator('.react-flow__node[data-id="firms"]'); const fb = await fn.boundingBox();
await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2); for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(250); } await page.waitForTimeout(1200);
r.firms = await page.evaluate(() => { const n = document.querySelector('.react-flow__node[data-id="firms"]'), c = n.querySelector('svg.circuit').getBoundingClientRect(), b = n.getBoundingClientRect();
  const heads = [...document.querySelectorAll('.sticky-head')].map(h => h.getBoundingClientRect()).filter(h => h.left < c.right && h.right > c.left && Math.abs(h.top - b.top) < 4);
  return { circuitTop: Math.round(c.top - b.top), header: heads.length ? Math.round(heads[0].height) : null }; });
await page.locator('.map-body').screenshot({ path: out + '/firms_band.png', timeout: 60000 });
await page.getByRole('slider', { name: 'Label size' }).fill('1.3');

// One formula scale (handoff 25 Nov 2026): every card has the same formula font size, no formula is wider than its
// card, at label sizes 1, 1.3 and 2.5, with all agents closed, Households open, and Constructors + Investors open.
const cards = () => page.evaluate(() => { const b = [...document.querySelectorAll('.formulas .eq .eq-body')];
  return { n: b.length, fonts: [...new Set(b.map(x => getComputedStyle(x).fontSize))],
    wide: b.filter(x => { const k = x.querySelector('.katex'), c = x.closest('.eq').getBoundingClientRect(); return k && k.getBoundingClientRect().width > c.width - 2; }).map(x => x.closest('.eq').querySelector('.eq-title').textContent) }; });
const nodeBtn = id => page.getByRole('button', { name: new RegExp(`^(Expand|Collapse) ${id}$`, 'i') }).first().dispatchEvent('click');
const fail = [];
const cpbOn = async () => { const b = page.getByRole('button', { name: 'CPB formulas' }); if (await b.getAttribute('aria-pressed') === 'true') { await b.click(); await page.waitForTimeout(500); }
  const ca = page.getByRole('button', { name: 'Collapse all' }); if (await ca.isEnabled()) { await ca.click(); await page.waitForTimeout(500); } await b.click(); await page.waitForTimeout(1500);
};
const sizes = async state => { for (const v of ['1', '1.3', '2.5']) { await page.getByRole('slider', { name: 'Label size' }).fill(v); await page.waitForTimeout(900);
  const c = await cards(); if (c.fonts.length !== 1 || c.wide.length || !c.n) fail.push({ state, v, ...c }); r[`${state}@${v}`] = c; } };
await page.goto('http://127.0.0.1:8001/'); await openPanels(page); await page.waitForTimeout(2500);
await cpbOn();
await sizes('closed');
await nodeBtn('households'); await page.waitForTimeout(1500); await sizes('households');
await nodeBtn('households'); await page.waitForTimeout(800); await nodeBtn('constructors'); await page.waitForTimeout(800); await nodeBtn('investors'); await page.waitForTimeout(1500);
await sizes('constructors+investors');
await page.getByRole('slider', { name: 'Label size' }).fill('1.3'); await page.waitForTimeout(800);
// the clicked card keeps its width
const util = page.locator('.formulas .eq', { hasText: 'Utility' }).first();
await page.reload(); await openPanels(page); await page.waitForTimeout(2500); await cpbOn();
const w0 = (await util.boundingBox()).width; await util.dispatchEvent('click'); await page.waitForTimeout(800); const w1 = (await util.boundingBox()).width;
r.utilityWidth = [w0, w1]; if (Math.abs(w0 - w1) > 0.5) fail.push({ utilityWidth: [w0, w1] });
// figure mode
await page.goto('http://127.0.0.1:8001/'); await openPanels(page); await page.waitForTimeout(2500);
await cpbOn();
await nodeBtn('households'); await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Figure mode' }).click(); await page.waitForTimeout(800);
r.url = page.url();
await page.locator('.formulas .eq', { hasText: 'Utility' }).first().dispatchEvent('click'); await page.waitForTimeout(800);
r.figure = await page.evaluate(() => { const on = document.querySelector('.formulas .eq.on'), vis = el => !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  return { canvas: document.querySelector('.map-canvas').className, explain: vis(document.querySelector('.map-canvas .eq-explain')),
    onBorder: on && getComputedStyle(on).borderTopColor, key: vis(document.querySelector('.map-key')), toggles: [...document.querySelectorAll('.map-canvas .block-head .toggle')].filter(vis).length }; });
if (!r.figure.canvas.includes('figure-mode') || r.figure.explain || r.figure.onBorder !== 'rgb(217, 201, 163)' || r.figure.key || r.figure.toggles) fail.push({ figure: r.figure });
await page.locator('.react-flow__controls-fitview').dispatchEvent('click'); await page.waitForTimeout(1200);
await page.locator('.map-canvas').screenshot({ path: out + '/figure_households.png', timeout: 60000 });
console.log(JSON.stringify({ fail, utilityWidth: r.utilityWidth, figure: r.figure, url: r.url, sample: { closed: r['closed@1.3'], households: r['households@2.5'], side: r['constructors+investors@2.5'] }, errors })); process.exit(0);
