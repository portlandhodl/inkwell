// Full-screen viewer for Mermaid diagrams: pan, zoom, and a draggable magnifier lens.
import { icon } from './icons.js';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 20;
const MIN_MAG = 1.5;
const MAX_MAG = 8;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Natural (unscaled) size of a Mermaid SVG, from its viewBox when available. */
function svgSize(svg) {
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width && vb.height) return { w: vb.width, h: vb.height };
  const r = svg.getBoundingClientRect();
  return { w: r.width || 400, h: r.height || 300 };
}

/** Prepare a copy of the diagram SVG that renders at a fixed pixel size and is scaled by CSS transform. */
function sizedClone(svg, w, h) {
  const c = svg.cloneNode(true);
  c.setAttribute('width', w);
  c.setAttribute('height', h);
  c.style.maxWidth = 'none';
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  c.removeAttribute('aria-roledescription');
  return c;
}

export function openDiagramViewer(sourceSvg) {
  document.querySelector('.diagram-viewer')?.close();
  const { w, h } = svgSize(sourceSvg);

  const d = document.createElement('dialog');
  d.className = 'diagram-viewer';
  d.innerHTML = `
    <div class="dv-stage" tabindex="0" aria-label="Diagram. Drag to pan, scroll to zoom."><div class="dv-canvas"></div>
      <div class="dv-lens" hidden aria-hidden="true"><div class="dv-lens-canvas"></div></div>
    </div>
    <div class="dv-toolbar" role="toolbar" aria-label="Diagram view">
      <button class="icon-btn" data-act="out" title="Zoom out (−)">${icon('zoomOut')}</button>
      <button class="dv-level" data-act="actual" title="Actual size (1)">100%</button>
      <button class="icon-btn" data-act="in" title="Zoom in (+)">${icon('zoomIn')}</button>
      <button class="icon-btn" data-act="fit" title="Fit to screen (0)">${icon('fit')}</button>
      <span class="dv-sep"></span>
      <button class="icon-btn" data-act="lens" title="Magnifier (M)" aria-pressed="false">${icon('magnifier')}</button>
      <label class="dv-mag" hidden title="Magnifier strength (Shift + scroll)">
        <input type="range" min="${MIN_MAG}" max="${MAX_MAG}" step="0.5" value="2.5"><output>2.5×</output>
      </label>
      <span class="dv-sep"></span>
      <button class="icon-btn" data-act="close" title="Close (Esc)">${icon('x')}</button>
    </div>
    <div class="dv-hint">Drag to pan · Scroll to zoom · <kbd>M</kbd> magnifier</div>`;
  document.body.append(d);

  const stage = d.querySelector('.dv-stage');
  const canvas = d.querySelector('.dv-canvas');
  const lens = d.querySelector('.dv-lens');
  const lensCanvas = d.querySelector('.dv-lens-canvas');
  const level = d.querySelector('.dv-level');
  const lensBtn = d.querySelector('[data-act="lens"]');
  const magBox = d.querySelector('.dv-mag');
  const magInput = magBox.querySelector('input');
  const magOut = magBox.querySelector('output');

  canvas.append(sizedClone(sourceSvg, w, h));
  lensCanvas.append(sizedClone(sourceSvg, w, h));

  // View transform: screen = t + scale * diagram.
  let scale = 1;
  let tx = 0;
  let ty = 0;
  // Lens: centre in stage coordinates, radius in px, magnification relative to the current view.
  const lensState = { on: false, x: 0, y: 0, r: 110, mag: 2.5 };

  function apply() {
    canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    level.textContent = `${Math.round(scale * 100)}%`;
    drawLens();
  }

  function drawLens() {
    if (!lensState.on) return;
    const { x, y, r, mag } = lensState;
    lens.style.width = lens.style.height = `${r * 2}px`;
    lens.style.transform = `translate(${x - r}px, ${y - r}px)`;
    // Diagram point under the lens centre, then render it at the lens centre with extra magnification.
    const ux = (x - tx) / scale;
    const uy = (y - ty) / scale;
    const s = scale * mag;
    lensCanvas.style.transform = `translate(${r - ux * s}px, ${r - uy * s}px) scale(${s})`;
  }

  function zoomAt(factor, cx, cy) {
    const next = clamp(scale * factor, MIN_ZOOM, MAX_ZOOM);
    const f = next / scale;
    tx = cx - (cx - tx) * f;
    ty = cy - (cy - ty) * f;
    scale = next;
    apply();
  }

  const center = () => ({ x: stage.clientWidth / 2, y: stage.clientHeight / 2 });

  function fit() {
    const pad = 48;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    scale = clamp(Math.min((sw - pad * 2) / w, (sh - pad * 2) / h), MIN_ZOOM, 4);
    tx = (sw - w * scale) / 2;
    ty = (sh - h * scale) / 2;
    apply();
  }

  function actual() {
    const c = center();
    zoomAt(1 / scale, c.x, c.y);
  }

  function setMag(v) {
    lensState.mag = clamp(Math.round(v * 2) / 2, MIN_MAG, MAX_MAG);
    magInput.value = lensState.mag;
    magOut.textContent = `${lensState.mag}×`;
    drawLens();
  }

  function keepLensInside() {
    lensState.x = clamp(lensState.x, 0, stage.clientWidth);
    lensState.y = clamp(lensState.y, 0, stage.clientHeight);
  }

  function toggleLens(on = !lensState.on) {
    lensState.on = on;
    lens.hidden = !on;
    magBox.hidden = !on;
    lensBtn.classList.toggle('accent', on);
    lensBtn.setAttribute('aria-pressed', String(on));
    d.classList.toggle('lens-on', on);
    if (on) {
      if (!lensState.x && !lensState.y) Object.assign(lensState, center());
      keepLensInside();
      drawLens();
    }
  }

  // Pointer handling: dragging the lens moves it; dragging anywhere else pans the view.
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const r = stage.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const onLens = lensState.on && Math.hypot(px - lensState.x, py - lensState.y) <= lensState.r;
    drag = onLens
      ? { kind: 'lens', dx: lensState.x - px, dy: lensState.y - py }
      : { kind: 'pan', sx: e.clientX - tx, sy: e.clientY - ty };
    stage.setPointerCapture(e.pointerId);
    d.classList.add(onLens ? 'dragging-lens' : 'panning');
    e.preventDefault();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.kind === 'pan') {
      tx = e.clientX - drag.sx;
      ty = e.clientY - drag.sy;
      apply();
    } else {
      const r = stage.getBoundingClientRect();
      lensState.x = e.clientX - r.left + drag.dx;
      lensState.y = e.clientY - r.top + drag.dy;
      keepLensInside();
      drawLens();
    }
  });
  const endDrag = () => {
    drag = null;
    d.classList.remove('panning', 'dragging-lens');
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (e.shiftKey && lensState.on) {
        setMag(lensState.mag * Math.exp(-dy * 0.004));
        return;
      }
      const r = stage.getBoundingClientRect();
      zoomAt(Math.exp(-dy * 0.0025), e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );

  stage.addEventListener('dblclick', (e) => {
    const r = stage.getBoundingClientRect();
    zoomAt(e.shiftKey ? 0.5 : 2, e.clientX - r.left, e.clientY - r.top);
  });

  magInput.addEventListener('input', () => setMag(+magInput.value));

  d.querySelector('.dv-toolbar').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const c = center();
    if (act === 'in') zoomAt(1.25, c.x, c.y);
    else if (act === 'out') zoomAt(0.8, c.x, c.y);
    else if (act === 'fit') fit();
    else if (act === 'actual') actual();
    else if (act === 'lens') toggleLens();
    else if (act === 'close') d.close();
  });

  d.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target === magInput) return;
    const c = center();
    const step = e.shiftKey ? 120 : 40;
    const handled = {
      '+': () => zoomAt(1.25, c.x, c.y),
      '=': () => zoomAt(1.25, c.x, c.y),
      '-': () => zoomAt(0.8, c.x, c.y),
      _: () => zoomAt(0.8, c.x, c.y),
      0: fit,
      1: actual,
      m: () => toggleLens(),
      M: () => toggleLens(),
      ArrowLeft: () => ((tx += step), apply()),
      ArrowRight: () => ((tx -= step), apply()),
      ArrowUp: () => ((ty += step), apply()),
      ArrowDown: () => ((ty -= step), apply()),
    }[e.key];
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      handled();
    }
  });

  const ro = new ResizeObserver(() => {
    if (lensState.on) {
      keepLensInside();
      drawLens();
    }
  });
  ro.observe(stage);

  d.addEventListener('close', () => {
    ro.disconnect();
    d.remove();
  });

  d.showModal();
  stage.focus({ preventScroll: true });
  fit();
}
