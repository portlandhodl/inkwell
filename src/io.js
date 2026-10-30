// Import & export: files, URLs, clipboard, backups.
import TurndownService from 'turndown';
import katex from 'katex';
import { gfm } from 'turndown-plugin-gfm';
import { render as wasmRender } from './wasm.js';
import { sanitize, enhance, imageDataUrl, escapeHtml } from './preview.js';
import { putImage, uid, listDocs, putDoc, getImage } from './store.js';

// ---------------------------------------------------------------------------
// HTML → Markdown
// ---------------------------------------------------------------------------

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  hr: '---',
});
turndown.use(gfm);
turndown.addRule('strike', { filter: ['del', 's', 'strike'], replacement: (c) => `~~${c}~~` });
turndown.addRule('mark', { filter: ['mark'], replacement: (c) => `==${c}==` });
turndown.addRule('fencedLang', {
  filter: (node) => node.nodeName === 'PRE' && node.querySelector('code'),
  replacement: (_c, node) => {
    const code = node.querySelector('code');
    const lang = (code.className.match(/(?:language|lang)-([\w+#-]+)/) || [])[1] || node.dataset?.lang || '';
    return `\n\n\`\`\`${lang}\n${code.textContent.replace(/\n$/, '')}\n\`\`\`\n\n`;
  },
});
// Tight "- item" / "1. item" markers instead of Turndown's padded defaults.
turndown.addRule('listItem', {
  filter: 'li',
  replacement: (content, node, options) => {
    const parent = node.parentNode;
    let prefix = options.bulletListMarker + ' ';
    if (parent.nodeName === 'OL') {
      const start = Number(parent.getAttribute('start') || 1);
      prefix = `${start + Array.prototype.indexOf.call(parent.children, node)}. `;
    }
    const body = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, '\n' + ' '.repeat(prefix.length));
    return prefix + body + (node.nextSibling && !/\n$/.test(body) ? '\n' : '');
  },
});
turndown.remove(['script', 'style', 'noscript', 'iframe']);

export function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('.copy-code, .src-line, .katex-mathml').forEach((n) => n.remove());
  return turndown.turndown(doc.body).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Rich text from web pages / docs is worth converting; editor-to-editor copies usually aren't. */
export function looksLikeRichHtml(html) {
  return /<(h[1-6]|ul|ol|table|blockquote|strong|b|em|i|a\s[^>]*href|img|pre)\b/i.test(html) && !/vscode|monaco|cm-line/i.test(html);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

const MD_EXT = /\.(md|markdown|mdown|mkd|mkdn|mdx|txt|text)$/i;
const HTML_EXT = /\.(html?|xhtml)$/i;

export const titleFromFilename = (name) => name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Untitled';

/** Reads a dropped/picked file into `{ title, content }`, or a backup marker. */
export async function readImportFile(file) {
  const text = await file.text();
  if (/\.json$/i.test(file.name)) {
    const data = JSON.parse(text);
    if (data?.app !== 'inkwell') throw new Error(`${file.name} isn't an Inkwell backup`);
    return { backup: data };
  }
  if (HTML_EXT.test(file.name) || file.type === 'text/html') {
    const pageTitle = new DOMParser().parseFromString(text, 'text/html').title.trim();
    return { title: pageTitle || titleFromFilename(file.name), content: htmlToMarkdown(text) };
  }
  if (MD_EXT.test(file.name) || file.type.startsWith('text/') || !file.type) {
    const h1 = text.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1];
    return { title: h1 || titleFromFilename(file.name), content: text };
  }
  throw new Error(`Can't import ${file.name}`);
}

export async function storeImage(file) {
  const id = uid();
  await putImage({ id, blob: file, type: file.type, name: file.name, created: Date.now() });
  const alt = (file.name || 'image').replace(/\.[^.]+$/, '').replace(/[\[\]]/g, '');
  return `![${alt}](inkimg:${id})`;
}

/** GitHub/GitLab "blob" pages and gists → their raw file. */
export function normalizeImportUrl(raw) {
  let url = raw.trim();
  if (!/^[a-z]+:\/\//i.test(url)) url = 'https://' + url;
  url = url.replace(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/, 'https://raw.githubusercontent.com/$1/$2/$3');
  url = url.replace(/^(https:\/\/gitlab\.com\/.+?)\/-\/blob\//, '$1/-/raw/');
  url = url.replace(/^https:\/\/gist\.github\.com\/([^/]+)\/([0-9a-f]+)\/?$/, 'https://gist.githubusercontent.com/$1/$2/raw');
  return url;
}

export async function importUrl(raw) {
  const url = normalizeImportUrl(raw);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const type = res.headers.get('content-type') || '';
  const text = await res.text();
  const name = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || new URL(url).hostname);
  const isHtml = type.includes('html') && !MD_EXT.test(name);
  if (isHtml) {
    const title = new DOMParser().parseFromString(text, 'text/html').title;
    return { title: title || titleFromFilename(name), content: htmlToMarkdown(text) };
  }
  return { title: titleFromFilename(name), content: text };
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

export const slug = (s) => (s || 'untitled').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'untitled';

/** Save via the native "Save as" dialog when available, otherwise a plain download. */
export async function saveFile(name, data, type, description) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  if (window.showSaveFilePicker) {
    try {
      const ext = '.' + name.split('.').pop();
      const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description, accept: { [type.split(';')[0]]: [ext] } }] });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
      // Fall through to the download path (e.g. unsupported type)
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return true;
}

/** Replace `inkimg:` references with data URLs so exported Markdown is self-contained. */
export async function embedImages(markdown) {
  const ids = [...new Set([...markdown.matchAll(/inkimg:([a-z0-9]+)/g)].map((m) => m[1]))];
  let out = markdown;
  for (const id of ids) out = out.replaceAll(`inkimg:${id}`, (await imageDataUrl(id)) || `inkimg:${id}`);
  return out;
}

/** Render a document to final, self-contained body HTML (math, highlighting, diagrams, images resolved). */
export async function renderForExport(markdown, flags, dark) {
  const host = document.createElement('div');
  host.className = 'markdown-body';
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;';
  document.body.append(host);
  try {
    host.innerHTML = sanitize(wasmRender(markdown, flags).html);
    await enhance(host, { dark });
    for (const img of host.querySelectorAll('img')) {
      if (img.src.startsWith('blob:')) {
        const blob = await (await fetch(img.src)).blob();
        img.src = await new Promise((r) => {
          const fr = new FileReader();
          fr.onload = () => r(fr.result);
          fr.readAsDataURL(blob);
        });
      }
    }
    host.querySelectorAll('.src-line, .copy-code').forEach((n) => n.remove());
    host.querySelectorAll('input.task-box').forEach((n) => n.setAttribute('disabled', ''));
    return host.innerHTML;
  } finally {
    host.remove();
  }
}

const THEME_VARS = [
  '--bg', '--surface', '--surface-2', '--border', '--text', '--muted', '--faint', '--accent', '--accent-2', '--accent-soft',
  '--code-bg', '--mark-bg', '--syn-keyword', '--syn-string', '--syn-number', '--syn-comment', '--syn-func', '--syn-type',
  '--syn-attr', '--syn-heading', '--syn-link', '--syn-code', '--syn-meta', '--preview-font', '--font-mono', '--font-ui',
  '--alert-note', '--alert-tip', '--alert-important', '--alert-warning', '--alert-caution',
];

let previewCss = null;
async function getPreviewCss() {
  previewCss ??= await fetch('css/preview.css').then((r) => r.text());
  return previewCss;
}

export async function buildHtmlDocument(title, bodyHtml) {
  const cs = getComputedStyle(document.documentElement);
  const vars = THEME_VARS.map((v) => `${v}:${cs.getPropertyValue(v).trim()};`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Inkwell">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@${katex.version}/dist/katex.min.css">
<style>
:root{${vars}}
html{background:var(--bg);}
body{margin:0;padding:48px 20px;background:var(--bg);font-family:var(--font-ui);}
.page{max-width:860px;margin:0 auto;background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:56px 64px;box-shadow:0 20px 60px -30px rgba(0,0,0,.35);}
.page .markdown-body{padding:0;max-width:none}
@media (max-width:700px){.page{padding:28px 20px}}
@media print{body{padding:0;background:#fff}.page{border:0;box-shadow:none;padding:0}}
${await getPreviewCss()}
</style>
</head>
<body>
<main class="page"><article class="markdown-body">
${bodyHtml}
</article></main>
</body>
</html>`;
}

/** Word opens HTML documents saved as .doc; keep styling simple (no CSS variables). */
export function buildWordDocument(title, bodyHtml) {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.5;color:#1f2328}
h1,h2,h3,h4{font-family:Calibri,Arial,sans-serif;color:#1f2328}
h1{font-size:22pt}h2{font-size:17pt}h3{font-size:14pt}
pre,code{font-family:Consolas,monospace;font-size:10pt;background:#f3f4f6}
pre{padding:8pt;border:1px solid #e5e7eb}
blockquote{border-left:3pt solid #8b7cff;margin-left:0;padding-left:10pt;color:#555}
table{border-collapse:collapse}td,th{border:1px solid #d0d7de;padding:4pt 8pt}th{background:#f3f4f6}
mark{background:#fff3a3}
.katex-mathml{display:none}
</style></head><body>${bodyHtml}</body></html>`;
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

export async function buildBackup() {
  const docs = await listDocs();
  const ids = new Set(docs.flatMap((d) => [...d.content.matchAll(/inkimg:([a-z0-9]+)/g)].map((m) => m[1])));
  const images = [];
  for (const id of ids) {
    const rec = await getImage(id);
    if (rec) images.push({ id, type: rec.type, name: rec.name, data: await imageDataUrl(id) });
  }
  return JSON.stringify({ app: 'inkwell', version: 1, exported: new Date().toISOString(), docs, images }, null, 1);
}

export async function restoreBackup(data) {
  for (const img of data.images || []) {
    const blob = await (await fetch(img.data)).blob();
    await putImage({ id: img.id, blob, type: img.type, name: img.name, created: Date.now() });
  }
  for (const doc of data.docs || []) await putDoc(doc);
  return (data.docs || []).length;
}
