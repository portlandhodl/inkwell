// Turns the WASM core's HTML into the live preview: sanitize, then layer on
// math, syntax highlighting, diagrams and locally stored images.
import DOMPurify from 'dompurify';
import katex from 'katex';
import hljs from 'highlight.js/lib/common';
import { getImage } from './store.js';
import { icon } from './icons.js';

const PURIFY = {
  ADD_ATTR: ['target', 'data-line', 'data-offset'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|blob|inkimg|chrome-extension|ftp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
};

export const sanitize = (html) => DOMPurify.sanitize(html, PURIFY);

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Small bounded caches so re-rendering on each keystroke stays cheap.
function lru(max) {
  const m = new Map();
  return {
    get(k) {
      if (!m.has(k)) return undefined;
      const v = m.get(k);
      m.delete(k);
      m.set(k, v);
      return v;
    },
    set(k, v) {
      m.set(k, v);
      if (m.size > max) m.delete(m.keys().next().value);
    },
    clear: () => m.clear(),
  };
}
const mathCache = lru(500);
const codeCache = lru(300);
const mermaidCache = lru(60);

function renderMath(el) {
  const display = el.classList.contains('math-display');
  const tex = el.textContent;
  const key = (display ? 'D' : 'I') + tex;
  let html = mathCache.get(key);
  if (html === undefined) {
    try {
      html = katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'htmlAndMathml' });
    } catch (e) {
      html = `<span class="math-error">${escapeHtml(e.message)}</span>`;
    }
    mathCache.set(key, html);
  }
  el.innerHTML = html;
}

function highlightCode(code) {
  const pre = code.parentElement;
  const lang = (code.className.match(/language-([\w+#.-]+)/) || [])[1]?.toLowerCase() || '';
  const src = code.textContent;
  const key = lang + '\0' + src;
  let html = codeCache.get(key);
  if (html === undefined) {
    if (lang && hljs.getLanguage(lang)) html = hljs.highlight(src, { language: lang, ignoreIllegals: true }).value;
    else if (!lang && src.length < 4000) html = hljs.highlightAuto(src).value;
    else html = escapeHtml(src);
    codeCache.set(key, html);
  }
  code.innerHTML = html;
  code.classList.add('hljs');
  pre.classList.add('code-block');
  if (lang) pre.dataset.lang = lang;
  pre.insertAdjacentHTML('beforeend', `<button class="copy-code" type="button" title="Copy code">${icon('copy')}</button>`);
}

let mermaidLoader = null;
let mermaidTheme = null;
let mermaidSeq = 0;

function loadMermaid() {
  mermaidLoader ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/mermaid.min.js';
    s.onload = () => resolve(window.mermaid);
    s.onerror = () => reject(new Error('Could not load Mermaid'));
    document.head.append(s);
  });
  return mermaidLoader;
}

async function renderMermaid(pre, src, dark) {
  const theme = dark ? 'dark' : 'default';
  const key = theme + '\0' + src;
  const box = document.createElement('div');
  box.className = 'mermaid-block';
  pre.replaceWith(box);
  const cached = mermaidCache.get(key);
  if (cached) {
    box.innerHTML = cached;
    return;
  }
  box.innerHTML = '<div class="mermaid-loading">Drawing diagram…</div>';
  try {
    const mermaid = await loadMermaid();
    if (mermaidTheme !== theme) {
      mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict', fontFamily: 'inherit' });
      mermaidTheme = theme;
    }
    const id = `mmd-${++mermaidSeq}`;
    const { svg } = await mermaid.render(id, src);
    mermaidCache.set(key, svg);
    box.innerHTML = svg;
  } catch (e) {
    document.getElementById('d' + `mmd-${mermaidSeq}`)?.remove();
    box.innerHTML = `<div class="mermaid-error">${icon('alert')}<span>${escapeHtml(e?.message || e)}</span></div>`;
  }
}

const imageUrls = new Map();
export function resolveImage(id) {
  if (!imageUrls.has(id)) {
    imageUrls.set(id, getImage(id).then((rec) => (rec ? URL.createObjectURL(rec.blob) : '')));
  }
  return imageUrls.get(id);
}

export async function imageDataUrl(id) {
  const rec = await getImage(id);
  if (!rec) return '';
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(rec.blob);
  });
}

/** Enhance a freshly sanitized preview. Resolves once async work (diagrams, images) has settled. */
export function enhance(root, { dark = false } = {}) {
  root.querySelectorAll('span.math').forEach(renderMath);
  const pending = [];
  for (const code of root.querySelectorAll('pre > code')) {
    if (/\blanguage-mermaid\b/.test(code.className)) pending.push(renderMermaid(code.parentElement, code.textContent, dark));
    else highlightCode(code);
  }
  for (const img of root.querySelectorAll('img[src^="inkimg:"]')) {
    const id = img.getAttribute('src').slice('inkimg:'.length);
    img.removeAttribute('src');
    pending.push(resolveImage(id).then((url) => url && (img.src = url)));
  }
  for (const table of root.querySelectorAll('table')) {
    if (!table.parentElement.classList.contains('table-wrap')) {
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      table.replaceWith(wrap);
      wrap.append(table);
    }
  }
  return Promise.allSettled(pending);
}

export function resetDiagramTheme() {
  mermaidTheme = null;
}
