// Save a DOM element as a high-resolution PNG (3x by default; 4x for thesis figures), capped at the browser's canvas limits.
// Elements with a data-no-shot attribute, and the canvas zoom buttons, are made invisible during the capture.
// They are hidden, not removed: some are columns of a CSS grid (the collapsed dock tabs), and removing them
// would shift the other columns (the right dock then lands on top of the canvas).
export async function savePng(el: HTMLElement, name: string, maxRatio = 3, crop?: { x: number; y: number; w: number; h: number }): Promise<void> {
  const { toPng } = await import('html-to-image');
  const w = el.scrollWidth, h = el.scrollHeight;
  const ratio = Math.min(maxRatio, 32000 / w, 32000 / h, Math.sqrt(2.5e8 / (w * h)));
  let bg = getComputedStyle(el).backgroundColor;
  if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') bg = getComputedStyle(document.body).backgroundColor || '#ffffff';
  const hidden = [...document.querySelectorAll<HTMLElement>('[data-no-shot], .react-flow__controls, .dock-toggle')];
  // The copy that is drawn starts every scroll box at the top; shift the content of scrolled boxes (the docks) up by
  // their scroll offset, so the image shows what is on screen.
  const scrolled = [el, ...el.querySelectorAll<HTMLElement>('*')].filter(n => n.scrollTop > 0 && n !== el);
  const shifted = scrolled.flatMap(n => { const st = n.scrollTop; n.scrollTop = 0;
    return [...n.children].map(c => { const k = c as HTMLElement, t = k.style.transform; k.style.transform = `translateY(${-st}px)`; return { k, t, n, st }; }); });
  document.documentElement.classList.add('shooting');  // no scrollbars in the image (style.css)
  const before = hidden.map(n => n.style.visibility);
  hidden.forEach(n => { n.style.visibility = 'hidden'; });
  try {
    let url = await toPng(el, { pixelRatio: ratio, width: w, height: h, backgroundColor: bg });
    if (crop) {  // figure mode: cut the image to the drawn content (CSS px of el)
      const img = new Image(); img.src = url; await img.decode();
      const cv = document.createElement('canvas'); cv.width = Math.round(crop.w * ratio); cv.height = Math.round(crop.h * ratio);
      cv.getContext('2d')!.drawImage(img, crop.x * ratio, crop.y * ratio, crop.w * ratio, crop.h * ratio, 0, 0, cv.width, cv.height);
      url = cv.toDataURL('image/png');
    }
    const a = document.createElement('a');
    a.href = url; a.download = `${name}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`; a.click();
  } finally {
    hidden.forEach((n, i) => { n.style.visibility = before[i]; });
    shifted.forEach(({ k, t }) => { k.style.transform = t; });
    shifted.forEach(({ n, st }) => { n.scrollTop = st; });
    document.documentElement.classList.remove('shooting');
  }
}
