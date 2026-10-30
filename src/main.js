// Inkwell — app shell: wires the WASM engine, editor, preview, storage and UI together.
import { undo, redo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { initWasm, render as wasmRender, formatTables, emojiList, byteToCharOffset, FLAGS } from './wasm.js';
import * as store from './store.js';
import { sanitize, enhance, escapeHtml, resetDiagramTheme } from './preview.js';
import { createEditor, cmd, insertText } from './editor.js';
import { icon, LOGO } from './icons.js';
import * as io from './io.js';
import { confetti } from './confetti.js';
import { toast, showMenu, closeMenu, promptDialog } from './ui.js';
import { openPalette } from './palette.js';

const $ = (s, r = document) => r.querySelector(s);
const root = document.documentElement;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';
const key = (s) => s.replace(/Mod/g, MOD).replace(/Alt/g, isMac ? '⌥' : 'Alt').replace(/Shift/g, isMac ? '⇧' : 'Shift');

export const THEMES = [
  { id: 'auto', name: 'Auto', desc: 'Follow your system', swatch: 'linear-gradient(135deg,#eef0fb 50%,#141925 50%)' },
  { id: 'daylight', name: 'Daylight', dark: false, swatch: 'linear-gradient(135deg,#6d5dfc,#ff6b9a)' },
  { id: 'midnight', name: 'Midnight', dark: true, swatch: 'linear-gradient(135deg,#141925 30%,#8b7cff)' },
  { id: 'sakura', name: 'Sakura', dark: false, swatch: 'linear-gradient(135deg,#ffd9e4,#e0457b)' },
  { id: 'paper', name: 'Paper', dark: false, swatch: 'linear-gradient(135deg,#f8f1e3,#b45309)' },
  { id: 'forest', name: 'Forest', dark: true, swatch: 'linear-gradient(135deg,#15211b 30%,#4ade80)' },
  { id: 'ocean', name: 'Ocean', dark: true, swatch: 'linear-gradient(135deg,#0e1b2a 30%,#38bdf8)' },
  { id: 'synthwave', name: 'Synthwave', dark: true, swatch: 'linear-gradient(135deg,#ff4ecd,#22d3ee)' },
];

const today = () => new Date().toISOString().slice(0, 10);
const TEMPLATES = [
  { name: 'Blank document', icon: 'file', content: () => '' },
  { name: 'Meeting notes', icon: 'clipboard', content: () => `# Meeting notes — ${today()}\n\n**Attendees:** \n\n## Agenda\n\n1. \n\n## Notes\n\n\n## Action items\n\n- [ ] \n` },
  { name: 'Daily journal', icon: 'sparkles', content: () => `# ${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}\n\n## :sunrise: Intentions\n\n- [ ] \n\n## :memo: Notes\n\n\n## :pray: Grateful for\n\n1. \n` },
  { name: 'Project README', icon: 'book', content: () => '# Project name\n\n> One-line description of what this does.\n\n## Features\n\n- \n\n## Install\n\n```bash\nnpm install project-name\n```\n\n## Usage\n\n```js\nimport thing from "project-name";\n```\n\n## License\n\nMIT\n' },
  { name: 'Blog post', icon: 'pen', content: () => `---\ntitle: My new post\ndate: ${today()}\ntags: [writing]\n---\n\n# My new post\n\n*A short, punchy subtitle.*\n\n## Introduction\n\n` },
];

const state = {
  settings: store.loadSettings(),
  docs: [],
  doc: null,
  meta: null,
  prevMeta: null,
  saveTimer: 0,
  renderTimer: 0,
  emojis: [],
  ignoreScroll: { editor: 0, preview: 0 },
};
let editor;

const els = {
  app: $('#app'),
  title: $('#doc-title'),
  saveState: $('#save-state'),
  preview: $('#preview'),
  previewPane: $('#preview-pane'),
  panes: $('#panes'),
  docList: $('#doc-list'),
  docSearch: $('#doc-search'),
  outline: $('#outline'),
  fileInput: $('#file-input'),
  imageInput: $('#image-input'),
};

// ---------------------------------------------------------------------------
// Settings, theme & layout
// ---------------------------------------------------------------------------

const resolvedTheme = () =>
  state.settings.theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'midnight' : 'daylight') : state.settings.theme;
const isDark = () => !!THEMES.find((t) => t.id === resolvedTheme())?.dark;

function applyTheme() {
  root.dataset.theme = resolvedTheme();
  root.dataset.dark = String(isDark());
  root.style.colorScheme = isDark() ? 'dark' : 'light';
}

function applyLayout() {
  const s = state.settings;
  els.app.dataset.view = s.view;
  els.app.classList.toggle('no-sidebar', !s.sidebar);
  root.style.setProperty('--split', s.splitRatio);
  root.style.setProperty('--editor-size', `${s.fontSize}px`);
  root.dataset.previewFont = s.previewFont;
  root.dataset.editorFont = s.editorFont ?? 'mono';
  document.querySelectorAll('#view-switch button').forEach((b) => b.classList.toggle('active', b.dataset.view === s.view));
  document.querySelectorAll('.side-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === s.sidebarTab));
  document.querySelectorAll('.side-panel').forEach((p) => (p.hidden = p.dataset.panel !== s.sidebarTab));
  requestAnimationFrame(() => editor?.view.requestMeasure());
}

function updateSettings(patch) {
  const before = state.settings;
  state.settings = { ...before, ...patch };
  store.saveSettings(state.settings);
  if ('theme' in patch) {
    applyTheme();
    resetDiagramTheme();
  }
  applyLayout();
  editor.configure(state.settings);
  if (['theme', 'smartPunct', 'hardBreaks', 'subscript', 'wordGoal'].some((k) => k in patch)) renderNow();
}

const flags = () =>
  (state.settings.smartPunct ? FLAGS.smartPunct : 0) |
  (state.settings.hardBreaks ? FLAGS.hardBreaks : 0) |
  (state.settings.subscript ? FLAGS.subscript : 0);

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function frontmatterCard(yaml) {
  if (!yaml.trim()) return '';
  const rows = yaml
    .split('\n')
    .map((l) => l.match(/^([\w][\w -]*):\s*(.*)$/))
    .filter(Boolean)
    .map(([, k, v]) => {
      const list = v.match(/^\[(.*)\]$/);
      const value = list
        ? list[1].split(',').map((x) => `<span class="fm-tag">${escapeHtml(x.trim().replace(/^["']|["']$/g, ''))}</span>`).join('')
        : escapeHtml(v.replace(/^["']|["']$/g, ''));
      return `<div><dt>${escapeHtml(k)}</dt><dd>${value}</dd></div>`;
    });
  return rows.length
    ? `<aside class="frontmatter"><dl>${rows.join('')}</dl></aside>`
    : `<aside class="frontmatter"><pre>${escapeHtml(yaml)}</pre></aside>`;
}

function renderNow() {
  clearTimeout(state.renderTimer);
  const md = editor.getText();
  const t0 = performance.now();
  const { html, meta } = wasmRender(md, flags());
  const ms = performance.now() - t0;
  els.preview.innerHTML = frontmatterCard(meta.frontmatter) + sanitize(html);
  els.preview.classList.toggle('empty', !md.trim());
  const enhanced = enhance(els.preview, { dark: isDark() }).then(() => state.settings.syncScroll && syncPreviewToEditor());

  state.meta = meta;
  updateStatus(meta, ms);
  renderOutline(meta.outline);
  autoTitle(meta, md);
  celebrate(meta);
  return enhanced;
}

function scheduleRender() {
  clearTimeout(state.renderTimer);
  state.renderTimer = setTimeout(renderNow, editor.view.state.doc.length > 80000 ? 180 : 30);
}

function celebrate(meta) {
  const prev = state.prevMeta;
  state.prevMeta = meta;
  if (!prev) return;
  if (meta.tasks > 0 && meta.tasks === prev.tasks && meta.tasksDone === meta.tasks && prev.tasksDone < prev.tasks) {
    confetti();
    toast('Every task checked off — nice work!', { icon: 'sparkles' });
  }
  const goal = state.settings.wordGoal;
  if (goal > 0 && prev.words < goal && meta.words >= goal && !state.doc.goalReached) {
    state.doc.goalReached = true;
    confetti({ count: 260 });
    toast(`${goal.toLocaleString()} words — goal reached!`, { icon: 'target' });
  }
}

function updateStatus(meta, ms) {
  const n = (x) => x.toLocaleString();
  $('#st-words').textContent = `${n(meta.words)} words`;
  $('#st-chars').textContent = `${n(meta.chars)} chars`;
  $('#st-read').textContent = `${Math.max(1, Math.round(meta.words / 230))} min read`;
  const tasks = $('#st-tasks');
  tasks.hidden = !meta.tasks;
  tasks.innerHTML = `${icon('task')}${meta.tasksDone}/${meta.tasks}`;
  tasks.classList.toggle('done', meta.tasks > 0 && meta.tasks === meta.tasksDone);

  const goal = state.settings.wordGoal;
  const g = $('#st-goal');
  g.hidden = !goal;
  if (goal) {
    const p = Math.min(1, meta.words / goal);
    g.style.setProperty('--p', p);
    g.classList.toggle('done', p >= 1);
    g.querySelector('span').textContent = `${Math.round(p * 100)}%`;
    g.title = `${n(meta.words)} / ${n(goal)} word goal — click to change`;
  }
  $('#st-engine').innerHTML = `${icon('bolt')}WASM ${ms < 1 ? ms.toFixed(2) : ms.toFixed(1)} ms`;
}

function renderOutline(outline) {
  if (!outline.length) {
    els.outline.innerHTML = '<p class="side-empty">Add headings with <code>#</code> to build an outline.</p>';
    return;
  }
  const min = Math.min(...outline.map((h) => h.level));
  els.outline.innerHTML = outline
    .map((h) => `<a href="#${escapeHtml(h.id)}" data-line="${h.line}" style="--lvl:${h.level - min}" class="lvl-${h.level}">${escapeHtml(h.text || 'Untitled')}</a>`)
    .join('');
  highlightOutline();
}

function highlightOutline() {
  if (!state.meta) return;
  const line = editor.view.state.doc.lineAt(editor.view.state.selection.main.head).number - 1;
  let active = null;
  for (const h of state.meta.outline) if (h.line <= line) active = h;
  els.outline.querySelectorAll('a').forEach((a) => a.classList.toggle('active', active && +a.dataset.line === active.line));
}

function tocMarkdown() {
  const outline = state.meta?.outline ?? [];
  if (!outline.length) return '*(Add some headings first)*';
  const min = Math.min(...outline.map((h) => h.level));
  return outline.map((h) => `${'  '.repeat(h.level - min)}- [${h.text}](#${h.id})`).join('\n');
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const sortedDocs = () => [...state.docs].sort((a, b) => (b.pinned - a.pinned) || b.updated - a.updated);

function autoTitle(meta, md) {
  const doc = state.doc;
  if (!doc.autoTitle) return;
  const h = meta.outline.find((x) => x.level === 1) ?? meta.outline[0];
  let title = h?.text;
  if (!title) {
    const line = md.split('\n').find((l) => l.trim() && !/^(---|```)/.test(l));
    title = line?.replace(/[#>*_`~\[\]()!-]/g, '').trim().slice(0, 60);
  }
  title ||= 'Untitled';
  if (title !== doc.title) {
    doc.title = title;
    if (document.activeElement !== els.title) els.title.value = title;
    document.title = `${title} · Inkwell`;
  }
}

function setSaveState(s) {
  els.saveState.dataset.state = s;
  els.saveState.title = s === 'saved' ? 'All changes saved' : 'Saving…';
}

async function saveNow() {
  clearTimeout(state.saveTimer);
  state.saveTimer = 0;
  const doc = state.doc;
  if (!doc) return;
  doc.content = editor.getText();
  doc.cursor = editor.view.state.selection.main.head;
  try {
    await store.putDoc(doc);
    setSaveState('saved');
  } catch (e) {
    toast(`Couldn't save: ${e.message}`, { icon: 'alert', tone: 'error' });
  }
  renderDocList();
}

function scheduleSave() {
  setSaveState('saving');
  state.doc.updated = Date.now();
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveNow, 500);
}

async function openDoc(doc) {
  if (state.saveTimer) await saveNow();
  state.doc = doc;
  state.prevMeta = null;
  editor.setText(doc.content, doc.cursor ?? 0);
  els.title.value = doc.title;
  document.title = `${doc.title} · Inkwell`;
  state.settings.lastDoc = doc.id;
  store.saveSettings(state.settings);
  setSaveState('saved');
  renderNow();
  renderDocList();
  editor.view.scrollDOM.scrollTop = 0;
  els.previewPane.scrollTop = 0;
  requestAnimationFrame(() => editor.view.dispatch({ scrollIntoView: true }));
}

async function createDoc(content = '', title = 'Untitled', { open = true } = {}) {
  const doc = store.newDoc(content, title);
  doc.autoTitle = title === 'Untitled';
  await store.putDoc(doc);
  state.docs.push(doc);
  if (open) await openDoc(doc);
  return doc;
}

async function newFromTemplate(t = TEMPLATES[0]) {
  await createDoc(t.content());
  editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
  editor.view.focus();
}

async function removeDoc(doc) {
  await store.deleteDoc(doc.id);
  state.docs = state.docs.filter((d) => d.id !== doc.id);
  if (state.doc.id === doc.id) {
    clearTimeout(state.saveTimer);
    state.saveTimer = 0;
    const next = sortedDocs()[0];
    if (next) await openDoc(next);
    else await createDoc();
  }
  renderDocList();
  toast(`Deleted “${doc.title}”`, {
    icon: 'trash',
    action: {
      label: 'Undo',
      run: async () => {
        await store.putDoc(doc);
        state.docs.push(doc);
        openDoc(doc);
      },
    },
  });
}

async function duplicateDoc(doc) {
  if (doc.id === state.doc.id) await saveNow();
  const copy = await createDoc(doc.content, `${doc.title} (copy)`);
  copy.autoTitle = false;
  store.putDoc(copy);
}

function openWikiLink(title) {
  const doc = state.docs.find((d) => d.title.toLowerCase() === title.toLowerCase());
  if (doc) return openDoc(doc);
  createDoc(`# ${title}\n\n`).then(() => toast(`Created “${title}”`, { icon: 'plus' }));
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function relTime(ts) {
  const s = (ts - Date.now()) / 1000;
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [u, sec] of units) if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), u);
  return 'just now';
}

function snippetOf(content) {
  const body = content.replace(/^---\n[\s\S]*?\n---\n/, '');
  const line = body.split('\n').find((l) => l.trim() && !/^\s*(#|```|---|\||<)/.test(l)) ?? '';
  return line.replace(/[*_`~>#\[\]]|\(.*?\)|!\[|inkimg:\w+/g, '').replace(/^\s*([-+]|\d+\.)\s+/, '').trim().slice(0, 90);
}

function renderDocList() {
  const q = els.docSearch.value.trim().toLowerCase();
  const docs = sortedDocs().filter((d) => !q || d.title.toLowerCase().includes(q) || d.content.toLowerCase().includes(q));
  els.docList.innerHTML = docs.length
    ? docs
        .map(
          (d) => `<li class="doc-item${d.id === state.doc?.id ? ' active' : ''}${d.pinned ? ' pinned' : ''}" data-id="${d.id}">
        <button class="doc-open" title="${escapeHtml(d.title)}">
          <span class="doc-title">${d.pinned ? icon('pin', 'pin-mark') : ''}${escapeHtml(d.title)}</span>
          <span class="doc-snippet">${escapeHtml(snippetOf(d.content)) || '<em>Empty</em>'}</span>
          <span class="doc-meta">${relTime(d.updated)}</span>
        </button>
        <span class="doc-actions">
          <button data-act="pin" title="${d.pinned ? 'Unpin' : 'Pin'}">${icon('pin')}</button>
          <button data-act="dup" title="Duplicate">${icon('duplicate')}</button>
          <button data-act="del" title="Delete">${icon('trash')}</button>
        </span>
      </li>`,
        )
        .join('')
    : `<li class="side-empty">${q ? 'No documents match.' : 'No documents yet.'}</li>`;
}

// ---------------------------------------------------------------------------
// Scroll sync (uses the invisible `.src-line` anchors the WASM core emits)
// ---------------------------------------------------------------------------

function previewAnchors() {
  const paneTop = els.previewPane.getBoundingClientRect().top - els.previewPane.scrollTop;
  return [...els.preview.querySelectorAll('.src-line')].map((el) => ({ line: +el.dataset.line, top: el.getBoundingClientRect().top - paneTop }));
}

function editorTopLine() {
  const v = editor.view;
  const h = v.scrollDOM.getBoundingClientRect().top - v.documentTop;
  const block = v.lineBlockAtHeight(Math.max(0, h));
  return v.state.doc.lineAt(block.from).number - 1 + Math.min(1, Math.max(0, (h - block.top) / (block.height || 1)));
}

const now = () => performance.now();

function syncPreviewToEditor() {
  if (state.settings.view !== 'split' || now() < state.ignoreScroll.editor) return;
  const sc = editor.view.scrollDOM;
  const pane = els.previewPane;
  let target;
  if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4) target = pane.scrollHeight;
  else {
    const L = editorTopLine();
    const anchors = previewAnchors();
    let i = anchors.findLastIndex((a) => a.line <= L);
    if (i < 0) target = 0;
    else {
      const a = anchors[i];
      const b = anchors[i + 1];
      target = a.top + (b && b.line > a.line ? ((L - a.line) / (b.line - a.line)) * (b.top - a.top) : 0) - 24;
    }
  }
  state.ignoreScroll.preview = now() + 120;
  pane.scrollTop = target;
}

function syncEditorToPreview() {
  if (state.settings.view !== 'split' || now() < state.ignoreScroll.preview) return;
  const pane = els.previewPane;
  const v = editor.view;
  const sc = v.scrollDOM;
  let target;
  if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 4) target = sc.scrollHeight;
  else {
    const y = pane.scrollTop + 24;
    const anchors = previewAnchors();
    const i = anchors.findLastIndex((a) => a.top <= y);
    if (i < 0) target = 0;
    else {
      const a = anchors[i];
      const b = anchors[i + 1];
      const L = a.line + (b && b.top > a.top ? ((y - a.top) / (b.top - a.top)) * (b.line - a.line) : 0);
      const lineNo = Math.min(v.state.doc.lines, Math.floor(L) + 1);
      const block = v.lineBlockAt(v.state.doc.line(lineNo).from);
      const offset = v.documentTop - sc.getBoundingClientRect().top + sc.scrollTop;
      target = offset + block.top + (L - Math.floor(L)) * block.height;
    }
  }
  state.ignoreScroll.editor = now() + 120;
  sc.scrollTop = target;
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

async function insertImages(files, pos) {
  const snippets = [];
  for (const f of files) snippets.push(await io.storeImage(f));
  const text = snippets.join('\n\n');
  const at = pos ?? editor.view.state.selection.main.head;
  editor.view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: 'input' });
  editor.view.focus();
  toast(files.length > 1 ? `Added ${files.length} images` : 'Image added', { icon: 'image' });
}

async function importFiles(files) {
  let last = null;
  let count = 0;
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (images.length) await insertImages(images);
  for (const f of files.filter((x) => !x.type.startsWith('image/'))) {
    try {
      const r = await io.readImportFile(f);
      if (r.backup) {
        const n = await io.restoreBackup(r.backup);
        state.docs = await store.listDocs();
        renderDocList();
        toast(`Restored ${n} document${n === 1 ? '' : 's'} from backup`, { icon: 'archive' });
        continue;
      }
      last = await createDoc(r.content, r.title, { open: false });
      last.autoTitle = false;
      count++;
    } catch (e) {
      toast(e.message, { icon: 'alert', tone: 'error' });
    }
  }
  if (last) {
    await openDoc(last);
    toast(count > 1 ? `Imported ${count} documents` : `Imported “${last.title}”`, { icon: 'upload' });
  }
}

/** Sites without CORS need per-origin host access; ask only when the user imports from them. */
async function ensureHostAccess(url) {
  if (!globalThis.chrome?.permissions) return;
  const origins = [`${new URL(io.normalizeImportUrl(url)).origin}/*`];
  try {
    if (!(await chrome.permissions.contains({ origins }))) await chrome.permissions.request({ origins });
  } catch {
    /* fetch below reports the real failure */
  }
}

async function importFromUrl(url, { fromGesture = !url } = {}) {
  url ??= await promptDialog({ title: 'Import from URL', label: 'Markdown or web page URL', placeholder: 'https://github.com/user/repo/blob/main/README.md', okLabel: 'Import' });
  if (!url) return;
  if (fromGesture) await ensureHostAccess(url);
  try {
    const { title, content } = await io.importUrl(url);
    const doc = await createDoc(content, title);
    doc.autoTitle = false;
    toast(`Imported “${title}”`, { icon: 'globe' });
  } catch (e) {
    toast(`Couldn't fetch that URL (${e.message})`, {
      icon: 'alert',
      tone: 'error',
      duration: 5000,
      action: fromGesture ? undefined : { label: 'Allow & retry', run: () => importFromUrl(url, { fromGesture: true }) },
    });
  }
}

async function pasteAsMarkdown() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes('text/html')) {
        const html = await (await item.getType('text/html')).text();
        insertText(editor.view, io.htmlToMarkdown(html).trim());
        return toast('Pasted as Markdown', { icon: 'wand' });
      }
    }
    insertText(editor.view, await navigator.clipboard.readText());
  } catch (e) {
    toast(`Clipboard unavailable: ${e.message}`, { icon: 'alert', tone: 'error' });
  }
}

const fileBase = () => io.slug(state.doc.title);

async function bodyForExport(dark = isDark()) {
  return io.renderForExport(editor.getText(), flags(), dark);
}

const exporters = {
  async md() {
    const md = await io.embedImages(editor.getText());
    if (await io.saveFile(`${fileBase()}.md`, md, 'text/markdown', 'Markdown')) toast('Exported Markdown', { icon: 'download' });
  },
  async html() {
    const html = await io.buildHtmlDocument(state.doc.title, await bodyForExport());
    if (await io.saveFile(`${fileBase()}.html`, html, 'text/html', 'Web page')) toast('Exported HTML', { icon: 'html' });
  },
  async word() {
    const html = io.buildWordDocument(state.doc.title, await bodyForExport(false));
    if (await io.saveFile(`${fileBase()}.doc`, new Blob(['﻿', html], { type: 'application/msword' }), 'application/msword', 'Word document'))
      toast('Exported Word document', { icon: 'word' });
  },
  async pdf() {
    await renderNow();
    const prev = document.title;
    document.title = state.doc.title;
    window.print();
    document.title = prev;
  },
  async txt() {
    const host = document.createElement('div');
    host.className = 'markdown-body offscreen';
    host.innerHTML = await bodyForExport();
    document.body.append(host);
    const text = host.innerText.replace(/\n{3,}/g, '\n\n');
    host.remove();
    if (await io.saveFile(`${fileBase()}.txt`, text, 'text/plain', 'Plain text')) toast('Exported plain text', { icon: 'text' });
  },
  async copyHtml() {
    const body = await bodyForExport(false);
    await navigator.clipboard.write([
      new ClipboardItem({ 'text/html': new Blob([body], { type: 'text/html' }), 'text/plain': new Blob([editor.getText()], { type: 'text/plain' }) }),
    ]);
    toast('Copied rich text — paste into email or docs', { icon: 'clipboard' });
  },
  async copyMd() {
    await navigator.clipboard.writeText(editor.getText());
    toast('Copied Markdown', { icon: 'copy' });
  },
  async backup() {
    await saveNow();
    const json = await io.buildBackup();
    if (await io.saveFile(`inkwell-backup-${today()}.json`, json, 'application/json', 'Inkwell backup'))
      toast(`Backed up ${state.docs.length} documents`, { icon: 'archive' });
  },
};

const IMPORT_ITEMS = () => [
  { icon: 'open', label: 'Open files…', desc: '.md, .markdown, .txt, .html', hint: key('Mod+O'), run: () => els.fileInput.click() },
  { icon: 'globe', label: 'Import from URL…', desc: 'GitHub, Gists, raw files, web pages', run: () => importFromUrl() },
  { icon: 'wand', label: 'Paste as Markdown', desc: 'Convert rich clipboard content', run: pasteAsMarkdown },
  { icon: 'image', label: 'Insert image…', run: () => els.imageInput.click() },
  '-',
  { icon: 'archive', label: 'Restore backup…', desc: 'Inkwell .json backup', run: () => els.fileInput.click() },
];

const EXPORT_ITEMS = () => [
  { header: 'Save as' },
  { icon: 'file', label: 'Markdown', desc: '.md with images embedded', run: exporters.md },
  { icon: 'html', label: 'HTML page', desc: 'Standalone, styled with your theme', run: exporters.html },
  { icon: 'printer', label: 'PDF', desc: 'Via the print dialog', hint: key('Mod+P'), run: exporters.pdf },
  { icon: 'word', label: 'Word document', desc: '.doc', run: exporters.word },
  { icon: 'text', label: 'Plain text', desc: '.txt', run: exporters.txt },
  { header: 'Clipboard' },
  { icon: 'clipboard', label: 'Copy as rich text', run: exporters.copyHtml },
  { icon: 'copy', label: 'Copy Markdown', run: exporters.copyMd },
  '-',
  { icon: 'archive', label: 'Back up all documents', desc: '.json, includes images', run: exporters.backup },
];

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function tableGrid() {
  const el = document.createElement('div');
  el.className = 'table-picker';
  const R = 8;
  const C = 8;
  el.innerHTML = `<div class="tp-grid">${Array.from({ length: R * C }, (_, i) => `<button data-r="${Math.floor(i / C) + 1}" data-c="${(i % C) + 1}"></button>`).join('')}</div><div class="tp-label">Pick a size</div>`;
  const label = el.querySelector('.tp-label');
  el.addEventListener('mouseover', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const r = +b.dataset.r;
    const c = +b.dataset.c;
    el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', +x.dataset.r <= r && +x.dataset.c <= c));
    label.textContent = `${c} × ${r} table`;
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    closeMenu();
    cmd.table(Math.max(1, +b.dataset.r - 1), +b.dataset.c)(editor.view);
  });
  return el;
}

function emojiPicker() {
  const el = document.createElement('div');
  el.className = 'emoji-picker';
  el.innerHTML = `<input placeholder="Search emoji…" spellcheck="false"><div class="ep-grid"></div>`;
  const grid = el.querySelector('.ep-grid');
  const draw = (q = '') => {
    grid.innerHTML = state.emojis
      .filter(([n]) => n.includes(q.toLowerCase().replace(/:/g, '')))
      .map(([n, e]) => `<button title=":${n}:" data-e="${e}">${e}</button>`)
      .join('');
  };
  el.querySelector('input').addEventListener('input', (e) => draw(e.target.value));
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) {
      closeMenu();
      insertText(editor.view, b.dataset.e);
    }
  });
  draw();
  return el;
}

function formatTablesCmd() {
  const before = editor.getText();
  const after = formatTables(before);
  if (after === before) return toast('Tables already look tidy', { icon: 'table' });
  editor.replaceAll(after);
  toast('Tables aligned by the WASM formatter', { icon: 'wand' });
}

const run = (fn) => () => fn(editor.view);

const TOOLBAR = () => [
  { icon: 'undo', title: `Undo (${key('Mod+Z')})`, run: run(undo) },
  { icon: 'redo', title: `Redo (${key(isMac ? 'Mod+Shift+Z' : 'Mod+Y')})`, run: run(redo) },
  '|',
  {
    icon: 'heading', title: 'Heading', menu: () => [1, 2, 3, 4, 5, 6].map((n) => ({ icon: 'heading', label: `Heading ${n}`, hint: key(`Mod+Alt+${n}`), run: run(cmd.heading(n)) })),
  },
  { icon: 'bold', title: `Bold (${key('Mod+B')})`, run: run(cmd.bold) },
  { icon: 'italic', title: `Italic (${key('Mod+I')})`, run: run(cmd.italic) },
  { icon: 'strike', title: `Strikethrough (${key('Mod+Shift+X')})`, run: run(cmd.strike) },
  { icon: 'mark', title: `Highlight (${key('Mod+Shift+H')})`, run: run(cmd.mark) },
  { icon: 'code', title: `Inline code (${key('Mod+E')})`, run: run(cmd.code) },
  '|',
  { icon: 'ul', title: `Bulleted list (${key('Mod+Shift+8')})`, run: run(cmd.ul) },
  { icon: 'ol', title: `Numbered list (${key('Mod+Shift+7')})`, run: run(cmd.ol) },
  { icon: 'task', title: `Task list (${key('Mod+Shift+9')})`, run: run(cmd.task) },
  { icon: 'quote', title: `Quote (${key('Mod+Shift+.')})`, run: run(cmd.quote) },
  '|',
  { icon: 'link', title: `Link (${key('Mod+K')})`, run: run(cmd.link) },
  {
    icon: 'image', title: 'Image', menu: () => [
      { icon: 'upload', label: 'Upload image…', desc: 'Or paste / drop one anywhere', run: () => els.imageInput.click() },
      { icon: 'globe', label: 'Image from URL', run: () => insertText(editor.view, '![alt text](https://)') },
    ],
  },
  { icon: 'table', title: 'Table', menu: () => [{ element: tableGrid() }], className: 'menu-plain' },
  { icon: 'codeBlock', title: 'Code block', run: run(cmd.codeBlock) },
  { icon: 'math', title: 'Math (KaTeX)', run: run(cmd.math) },
  { icon: 'diagram', title: 'Mermaid diagram', run: run(cmd.mermaid) },
  {
    icon: 'alert', title: 'Callout', menu: () => [['note', 'Note'], ['tip', 'Tip'], ['important', 'Important'], ['warning', 'Warning'], ['caution', 'Caution']]
      .map(([k, label]) => ({ icon: 'alert', label, run: run(cmd.alert(k)) })),
  },
  { icon: 'footnote', title: 'Footnote', run: run(cmd.footnote) },
  { icon: 'hr', title: 'Divider', run: run(cmd.hr) },
  { icon: 'smile', title: 'Emoji', menu: () => [{ element: emojiPicker() }], className: 'menu-plain' },
  '|',
  { icon: 'wand', title: `Align tables (${key('Mod+Shift+F')})`, run: formatTablesCmd },
  { icon: 'search', title: `Find & replace (${key('Mod+F')})`, run: () => openSearchPanel(editor.view) },
];

function buildToolbar() {
  const bar = $('#toolbar');
  for (const item of TOOLBAR()) {
    if (item === '|') {
      bar.insertAdjacentHTML('beforeend', '<span class="tb-sep"></span>');
      continue;
    }
    const b = document.createElement('button');
    b.className = 'tb-btn' + (item.menu ? ' has-menu' : '');
    b.title = item.title;
    b.setAttribute('aria-label', item.title);
    b.innerHTML = icon(item.icon);
    b.addEventListener('mousedown', (e) => e.preventDefault()); // keep editor selection
    b.addEventListener('click', () => (item.menu ? showMenu(b, item.menu(), { className: item.className }) : item.run()));
    bar.append(b);
  }
}

// ---------------------------------------------------------------------------
// Settings dialog
// ---------------------------------------------------------------------------

const SETTINGS_SCHEMA = () => [
  { section: 'Appearance' },
  { key: 'theme', label: 'Theme', type: 'select', options: THEMES.map((t) => [t.id, t.name]) },
  { key: 'previewFont', label: 'Preview typeface', type: 'select', options: [['sans', 'Sans-serif'], ['serif', 'Serif'], ['mono', 'Monospace']] },
  { key: 'editorFont', label: 'Editor typeface', type: 'select', options: [['mono', 'Monospace'], ['sans', 'Sans-serif'], ['serif', 'Serif']] },
  { key: 'fontSize', label: 'Editor font size', type: 'range', min: 12, max: 22 },
  { key: 'lineNumbers', label: 'Line numbers', type: 'toggle' },
  { key: 'lineWrap', label: 'Wrap long lines', type: 'toggle' },
  { section: 'Writing' },
  { key: 'spellcheck', label: 'Spellcheck', type: 'toggle' },
  { key: 'typewriter', label: 'Typewriter scrolling', desc: 'Keep the cursor vertically centered', type: 'toggle' },
  { key: 'syncScroll', label: 'Sync scrolling', desc: 'Editor and preview scroll together', type: 'toggle' },
  { key: 'smartPaste', label: 'Smart paste', desc: 'Convert rich text from web pages into Markdown', type: 'toggle' },
  { key: 'wordGoal', label: 'Word goal', desc: 'Per document; 0 to hide', type: 'number', min: 0, step: 50 },
  { section: 'Markdown' },
  { key: 'smartPunct', label: 'Smart punctuation', desc: '“Curly quotes”, en–dashes and ellipses…', type: 'toggle' },
  { key: 'hardBreaks', label: 'Newlines are line breaks', desc: 'Like chat apps, no trailing spaces needed', type: 'toggle' },
  { key: 'subscript', label: 'Single-tilde subscript', desc: 'H~2~O instead of ~strikethrough~', type: 'toggle' },
];

const SHORTCUTS = [
  ['Command palette', 'Mod+Shift+P'], ['Bold / Italic', 'Mod+B / Mod+I'], ['Link', 'Mod+K'], ['Inline code', 'Mod+E'],
  ['Headings', 'Mod+Alt+1…6'], ['Find & replace', 'Mod+F'], ['Toggle view', 'Mod+\\'], ['Open file', 'Mod+O'],
  ['New document', 'Alt+N'], ['Toggle sidebar', 'Alt+B'], ['Zen mode', 'Alt+Z'], ['Align tables', 'Mod+Shift+F'],
  ['Slash commands', '/'], ['Emoji', ':name'],
];

function openSettings() {
  const d = document.createElement('dialog');
  d.className = 'modal settings';
  const s = state.settings;
  const field = (f) => {
    if (f.section) return `<h3>${f.section}</h3>`;
    const v = s[f.key] ?? '';
    const label = `<span class="f-label">${escapeHtml(f.label)}${f.desc ? `<small>${escapeHtml(f.desc)}</small>` : ''}</span>`;
    let input;
    if (f.type === 'toggle') input = `<input type="checkbox" class="switch" data-key="${f.key}" ${v ? 'checked' : ''}>`;
    else if (f.type === 'select') input = `<select data-key="${f.key}">${f.options.map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    else if (f.type === 'range') input = `<span class="range"><input type="range" data-key="${f.key}" min="${f.min}" max="${f.max}" value="${v}"><output>${v}px</output></span>`;
    else input = `<input type="number" data-key="${f.key}" min="${f.min}" step="${f.step}" value="${v}">`;
    return `<label class="setting">${label}${input}</label>`;
  };
  d.innerHTML = `
    <header class="modal-head">${icon('settings')}<h2>Settings</h2><button class="icon-btn" data-close title="Close">${icon('x')}</button></header>
    <div class="modal-body">
      ${SETTINGS_SCHEMA().map(field).join('')}
      <h3>Keyboard shortcuts</h3>
      <div class="shortcuts">${SHORTCUTS.map(([l, k]) => `<div><span>${l}</span><kbd>${escapeHtml(key(k))}</kbd></div>`).join('')}</div>
      <p class="about">${LOGO}<span><b>Inkwell</b> renders Markdown with <code>pulldown-cmark</code> compiled from Rust to WebAssembly. Your documents never leave this browser.${globalThis.chrome?.runtime?.id ? '' : ' <a href="inkwell-extension.zip" download>Get the Chrome extension</a>'}</span></p>
    </div>`;
  document.body.append(d);
  d.addEventListener('input', (e) => {
    const k = e.target.dataset.key;
    if (!k) return;
    const f = SETTINGS_SCHEMA().find((x) => x.key === k);
    const val = f.type === 'toggle' ? e.target.checked : f.type === 'range' || f.type === 'number' ? Number(e.target.value) : e.target.value;
    if (f.type === 'range') e.target.nextElementSibling.textContent = `${val}px`;
    updateSettings({ [k]: val });
  });
  d.querySelector('[data-close]').onclick = () => d.close();
  d.addEventListener('click', (e) => e.target === d && d.close());
  d.addEventListener('close', () => d.remove());
  d.showModal();
}

// ---------------------------------------------------------------------------
// Commands (palette)
// ---------------------------------------------------------------------------

function setView(view) {
  updateSettings({ view });
  if (view !== 'preview') editor.view.focus();
}

function toggleZen(force) {
  const on = force ?? !els.app.classList.contains('zen');
  els.app.classList.toggle('zen', on);
  if (on) toast(`Zen mode — press Esc to return`, { icon: 'zen' });
  requestAnimationFrame(() => editor.view.requestMeasure());
}

function themeMenu(anchor) {
  showMenu(anchor, THEMES.map((t) => ({ swatch: t.swatch, label: t.name, desc: t.desc, active: state.settings.theme === t.id, run: () => updateSettings({ theme: t.id }) })), { align: 'right' });
}

function paletteItems() {
  const c = (group, label, ic, runFn, hint, keywords) => ({ group, label, icon: ic, run: runFn, hint: hint && key(hint), keywords });
  const items = [
    c('File', 'New document', 'plus', () => newFromTemplate(), 'Alt+N'),
    ...TEMPLATES.slice(1).map((t) => c('File', `New from template: ${t.name}`, t.icon, () => newFromTemplate(t))),
    c('File', 'Open files…', 'open', () => els.fileInput.click(), 'Mod+O', 'import'),
    c('File', 'Import from URL…', 'globe', () => importFromUrl(), null, 'github fetch'),
    c('File', 'Paste as Markdown', 'wand', pasteAsMarkdown, null, 'clipboard html convert'),
    c('File', 'Rename document', 'pen', () => els.title.select()),
    c('File', 'Duplicate document', 'duplicate', () => duplicateDoc(state.doc)),
    c('File', 'Delete document', 'trash', () => removeDoc(state.doc)),
    c('Export', 'Export as Markdown', 'file', exporters.md),
    c('Export', 'Export as HTML', 'html', exporters.html),
    c('Export', 'Export as PDF', 'printer', exporters.pdf, 'Mod+P', 'print'),
    c('Export', 'Export as Word document', 'word', exporters.word, null, 'docx doc'),
    c('Export', 'Export as plain text', 'text', exporters.txt),
    c('Export', 'Copy as rich text', 'clipboard', exporters.copyHtml),
    c('Export', 'Copy Markdown', 'copy', exporters.copyMd),
    c('Export', 'Back up all documents', 'archive', exporters.backup, null, 'json'),
    c('View', 'Write only', 'pen', () => setView('edit'), 'Mod+\\', 'editor'),
    c('View', 'Split view', 'split', () => setView('split')),
    c('View', 'Preview only', 'eye', () => setView('preview')),
    c('View', 'Toggle sidebar', 'sidebar', () => updateSettings({ sidebar: !state.settings.sidebar }), 'Alt+B'),
    c('View', 'Zen mode', 'zen', () => toggleZen(), 'Alt+Z', 'focus distraction free'),
    c('View', `${state.settings.lineNumbers ? 'Hide' : 'Show'} line numbers`, 'ol', () => updateSettings({ lineNumbers: !state.settings.lineNumbers })),
    c('View', `${state.settings.typewriter ? 'Disable' : 'Enable'} typewriter scrolling`, 'keyboard', () => updateSettings({ typewriter: !state.settings.typewriter })),
    c('View', 'Settings', 'settings', openSettings, null, 'preferences options'),
    ...THEMES.map((t) => c('Theme', `Theme: ${t.name}`, 'palette', () => updateSettings({ theme: t.id }), null, 'color dark light')),
    c('Format', 'Align all tables', 'wand', formatTablesCmd, 'Mod+Shift+F', 'format prettify'),
    c('Format', 'Insert table of contents', 'outline', () => insertText(editor.view, tocMarkdown() + '\n'), null, 'toc'),
    c('Format', 'Insert table', 'table', run(cmd.table(2, 3))),
    c('Format', 'Insert code block', 'codeBlock', run(cmd.codeBlock)),
    c('Format', 'Insert math block', 'math', run(cmd.math), null, 'katex latex equation'),
    c('Format', 'Insert Mermaid diagram', 'diagram', run(cmd.mermaid), null, 'flowchart chart'),
    c('Format', 'Insert footnote', 'footnote', run(cmd.footnote)),
    c('Format', 'Insert image…', 'image', () => els.imageInput.click()),
    c('Format', 'Insert date', 'sparkles', () => insertText(editor.view, today())),
    c('Edit', 'Find & replace', 'search', () => openSearchPanel(editor.view), 'Mod+F'),
    c('Fun', 'Celebrate 🎉', 'sparkles', () => confetti(), null, 'confetti party'),
  ];
  for (const d of sortedDocs()) if (d.id !== state.doc.id) items.push(c('Open', d.title, 'file', () => openDoc(d)));
  for (const h of state.meta?.outline ?? []) items.push(c('Go to', `${'#'.repeat(h.level)} ${h.text}`, 'heading', () => editor.gotoLine(h.line + 1)));
  return items;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function wire() {
  $('#toggle-sidebar').onclick = () => updateSettings({ sidebar: !state.settings.sidebar });
  document.querySelectorAll('#view-switch button').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  document.querySelectorAll('.side-tabs button').forEach((b) => (b.onclick = () => updateSettings({ sidebarTab: b.dataset.tab })));
  $('#import-btn').onclick = (e) => showMenu(e.currentTarget, IMPORT_ITEMS());
  $('#export-btn').onclick = (e) => showMenu(e.currentTarget, EXPORT_ITEMS(), { align: 'right' });
  $('#theme-btn').onclick = (e) => themeMenu(e.currentTarget);
  $('#zen-btn').onclick = () => toggleZen();
  $('#palette-btn').onclick = () => openPalette(paletteItems());
  $('#settings-btn').onclick = openSettings;
  $('#new-doc').onclick = (e) =>
    showMenu(e.currentTarget, [{ header: 'New document' }, ...TEMPLATES.map((t) => ({ icon: t.icon, label: t.name, run: () => newFromTemplate(t) }))]);
  $('#st-goal').onclick = async () => {
    const v = await promptDialog({ title: 'Word goal', label: 'Words to aim for in each document', value: String(state.settings.wordGoal), okLabel: 'Set goal', icon: 'target' });
    if (v !== null && !Number.isNaN(+v)) updateSettings({ wordGoal: Math.max(0, Math.round(+v)) });
  };

  els.title.addEventListener('input', () => {
    const t = els.title.value.trim();
    state.doc.autoTitle = !t;
    state.doc.title = t || 'Untitled';
    document.title = `${state.doc.title} · Inkwell`;
    scheduleSave();
  });
  els.title.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), editor.view.focus()));
  els.title.addEventListener('blur', () => {
    if (!els.title.value.trim()) {
      state.doc.autoTitle = true;
      renderNow();
      els.title.value = state.doc.title;
    }
  });

  els.docSearch.addEventListener('input', renderDocList);
  els.docList.addEventListener('click', (e) => {
    const li = e.target.closest('.doc-item');
    if (!li) return;
    const doc = state.docs.find((d) => d.id === li.dataset.id);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'del') removeDoc(doc);
    else if (act === 'dup') duplicateDoc(doc);
    else if (act === 'pin') {
      doc.pinned = !doc.pinned;
      store.putDoc(doc);
      renderDocList();
    } else if (doc.id !== state.doc.id) openDoc(doc);
  });

  els.outline.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    if (state.settings.view !== 'preview') editor.gotoLine(+a.dataset.line + 1);
    els.preview.querySelector(`[id="${CSS.escape(a.getAttribute('href').slice(1))}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  els.preview.addEventListener('click', async (e) => {
    const box = e.target.closest('input.task-box');
    if (box) {
      const text = editor.getText();
      const at = byteToCharOffset(text, +box.dataset.offset);
      if (text[at] === '[') {
        editor.view.dispatch({ changes: { from: at + 1, to: at + 2, insert: text[at + 1] === ' ' ? 'x' : ' ' }, userEvent: 'input' });
      }
      return;
    }
    const copy = e.target.closest('.copy-code');
    if (copy) {
      await navigator.clipboard.writeText(copy.parentElement.querySelector('code').textContent);
      copy.classList.add('copied');
      setTimeout(() => copy.classList.remove('copied'), 1200);
      return;
    }
    const a = e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    if (href.startsWith('#')) {
      els.preview.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      window.open(href, '_blank', 'noopener');
    } else {
      openWikiLink(decodeURIComponent(href).replace(/\.md$/i, ''));
    }
  });

  // Double-click the preview to jump to the source.
  els.preview.addEventListener('dblclick', (e) => {
    if (state.settings.view === 'preview') return;
    let n = e.target;
    while (n && n.parentElement !== els.preview) n = n.parentElement;
    while (n && !n.classList?.contains('src-line')) n = n.previousElementSibling;
    if (n) editor.gotoLine(+n.dataset.line + 1);
  });

  editor.view.scrollDOM.addEventListener('scroll', () => state.settings.syncScroll && syncPreviewToEditor(), { passive: true });
  els.previewPane.addEventListener('scroll', () => state.settings.syncScroll && syncEditorToPreview(), { passive: true });

  // Split resizer
  const resizer = $('#resizer');
  resizer.addEventListener('pointerdown', (e) => {
    resizer.setPointerCapture(e.pointerId);
    els.app.classList.add('resizing');
    const rect = els.panes.getBoundingClientRect();
    const move = (ev) => root.style.setProperty('--split', Math.min(0.8, Math.max(0.2, (ev.clientX - rect.left) / rect.width)));
    const up = () => {
      resizer.removeEventListener('pointermove', move);
      els.app.classList.remove('resizing');
      updateSettings({ splitRatio: +getComputedStyle(root).getPropertyValue('--split') });
    };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', up, { once: true });
  });
  resizer.addEventListener('dblclick', () => updateSettings({ splitRatio: 0.5 }));

  els.fileInput.addEventListener('change', () => {
    importFiles([...els.fileInput.files]);
    els.fileInput.value = '';
  });
  els.imageInput.addEventListener('change', () => {
    if (els.imageInput.files.length) insertImages([...els.imageInput.files]);
    els.imageInput.value = '';
  });

  // Drag & drop anywhere
  let dragDepth = 0;
  const overlay = $('#drop-overlay');
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => hasFiles(e) && (dragDepth++, overlay.classList.add('show')));
  window.addEventListener('dragleave', (e) => hasFiles(e) && --dragDepth <= 0 && overlay.classList.remove('show'));
  window.addEventListener('dragover', (e) => hasFiles(e) && e.preventDefault());
  window.addEventListener('drop', (e) => {
    dragDepth = 0;
    overlay.classList.remove('show');
    if (!hasFiles(e)) return;
    e.preventDefault();
    importFiles([...e.dataTransfer.files]);
  });

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if ((mod && e.shiftKey && k === 'p') || e.key === 'F1') {
      e.preventDefault();
      openPalette(paletteItems());
    } else if (mod && !e.shiftKey && k === 's') {
      e.preventDefault();
      saveNow().then(() => toast('Saved', { icon: 'check', duration: 1200 }));
    } else if (mod && !e.shiftKey && k === 'o') {
      e.preventDefault();
      els.fileInput.click();
    } else if (mod && e.key === '\\') {
      e.preventDefault();
      const order = ['edit', 'split', 'preview'];
      setView(order[(order.indexOf(state.settings.view) + 1) % 3]);
    } else if (mod && e.shiftKey && k === 'f') {
      e.preventDefault();
      formatTablesCmd();
    } else if (e.altKey && !mod && e.code === 'KeyN') {
      e.preventDefault();
      newFromTemplate();
    } else if (e.altKey && !mod && e.code === 'KeyB') {
      e.preventDefault();
      updateSettings({ sidebar: !state.settings.sidebar });
    } else if (e.altKey && !mod && e.code === 'KeyZ') {
      e.preventDefault();
      toggleZen();
    } else if (e.key === 'Escape' && els.app.classList.contains('zen') && !document.querySelector('dialog[open], .menu')) {
      toggleZen(false);
    }
  });

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.settings.theme === 'auto') {
      applyTheme();
      renderNow();
    }
  });
  // Print (PDF export) always uses a light theme.
  window.addEventListener('beforeprint', () => isDark() && (root.dataset.theme = 'daylight'));
  window.addEventListener('afterprint', applyTheme);
  window.addEventListener('beforeunload', () => state.saveTimer && saveNow());
  document.addEventListener('visibilitychange', () => document.hidden && state.saveTimer && saveNow());
  // Another Inkwell tab may have edited the doc list.
  window.addEventListener('focus', async () => {
    const fresh = await store.listDocs();
    const known = new Map(state.docs.map((d) => [d.id, d]));
    state.docs = fresh.map((d) => (d.id === state.doc.id ? state.doc : known.get(d.id)?.updated >= d.updated ? known.get(d.id) : d));
    if (!state.docs.some((d) => d.id === state.doc.id)) state.docs.push(state.doc);
    renderDocList();
  });
  setInterval(renderDocList, 60_000);
}

async function handleLaunchParams() {
  const params = new URLSearchParams(location.search);
  if (!params.size) return;
  history.replaceState(null, '', location.pathname);
  if (params.has('inbox') && globalThis.chrome?.storage) {
    const { inbox } = await chrome.storage.local.get('inbox');
    await chrome.storage.local.remove('inbox');
    if (inbox?.content) {
      await createDoc(inbox.content, inbox.title || 'Clipping');
      toast('Captured from the web', { icon: 'sparkles' });
    }
  }
  if (params.has('url')) importFromUrl(params.get('url'));
  if (params.has('new')) newFromTemplate();
}

async function init() {
  document.querySelectorAll('[data-icon]').forEach((el) => el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)));
  $('#logo').innerHTML = LOGO;
  applyTheme();
  applyLayout();
  buildToolbar();

  try {
    await initWasm('dist/inkwell.wasm');
  } catch (e) {
    document.body.innerHTML = `<div class="fatal"><h1>Inkwell couldn't start</h1><p>The WebAssembly engine failed to load: ${escapeHtml(e.message)}</p></div>`;
    return;
  }
  state.emojis = emojiList();

  editor = createEditor({
    parent: $('#editor'),
    emojis: state.emojis,
    getToc: tocMarkdown,
    onChange: () => {
      scheduleSave();
      scheduleRender();
    },
    onCursor: (view) => {
      const sel = view.state.selection.main;
      const line = view.state.doc.lineAt(sel.head);
      let selected = '';
      if (!sel.empty) {
        const text = view.state.sliceDoc(sel.from, sel.to);
        const words = text.split(/\s+/).filter(Boolean).length;
        selected = ` · ${words ? `${words} word${words === 1 ? '' : 's'}` : `${text.length} chars`} selected`;
      }
      $('#st-cursor').textContent = `Ln ${line.number}, Col ${sel.head - line.from + 1}${selected}`;
      highlightOutline();
      if (state.settings.typewriter) requestAnimationFrame(() => editor.centerCursor());
    },
    onPaste: (e, view) => {
      const images = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (images.length) {
        e.preventDefault();
        insertImages(images);
        return true;
      }
      const html = e.clipboardData?.getData('text/html');
      if (state.settings.smartPaste && html && io.looksLikeRichHtml(html)) {
        e.preventDefault();
        insertText(view, io.htmlToMarkdown(html).trim());
        toast('Rich text converted to Markdown', { icon: 'wand', duration: 1800 });
        return true;
      }
      return false;
    },
    onDropFiles: (files, pos) => {
      const images = files.filter((f) => f.type.startsWith('image/'));
      if (images.length) insertImages(images, pos);
      const others = files.filter((f) => !f.type.startsWith('image/'));
      if (others.length) importFiles(others);
    },
  });
  editor.configure(state.settings);

  state.docs = await store.listDocs();
  if (!state.docs.length) {
    const welcome = await fetch('welcome.md').then((r) => r.text());
    const doc = store.newDoc(welcome, 'Welcome to Inkwell');
    doc.autoTitle = false;
    await store.putDoc(doc);
    state.docs = [doc];
  }
  await openDoc(state.docs.find((d) => d.id === state.settings.lastDoc) ?? sortedDocs()[0]);
  wire();
  await handleLaunchParams();
  document.body.classList.add('ready');
}

init();
