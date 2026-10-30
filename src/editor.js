// CodeMirror 6 setup plus every Markdown editing command the toolbar,
// keyboard shortcuts and command palette share.
import {
  EditorView, keymap, drawSelection, dropCursor, highlightActiveLine, lineNumbers,
  highlightActiveLineGutter, highlightSpecialChars, rectangularSelection, crosshairCursor, placeholder,
} from '@codemirror/view';
import { EditorState, EditorSelection, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, snippet } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.4em', fontWeight: '800', color: 'var(--syn-heading)' },
  { tag: t.heading2, fontSize: '1.22em', fontWeight: '750', color: 'var(--syn-heading)' },
  { tag: t.heading3, fontSize: '1.1em', fontWeight: '700', color: 'var(--syn-heading)' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '700', color: 'var(--syn-heading)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', opacity: '0.7' },
  { tag: [t.link, t.url], color: 'var(--syn-link)' },
  { tag: t.monospace, color: 'var(--syn-code)' },
  { tag: t.quote, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.contentSeparator], color: 'var(--syn-meta)', fontWeight: '400' },
  { tag: t.meta, color: 'var(--syn-meta)' },
  { tag: [t.keyword, t.tagName, t.modifier], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.atom, t.null], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-func)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--syn-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syn-attr)' },
  { tag: [t.operator, t.punctuation], color: 'var(--muted)' },
]);

const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--editor-size)', color: 'var(--text)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--editor-font)', lineHeight: '1.75' },
  '.cm-content': { padding: '28px 0 45vh', caretColor: 'var(--accent)', maxWidth: 'var(--editor-measure)', margin: '0 auto' },
  '.cm-line': { padding: '0 28px' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--accent)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--selection) !important' },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--faint)', paddingLeft: '8px' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--accent)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--accent-soft)' },
  '.cm-matchingBracket': { backgroundColor: 'var(--accent-soft)', outline: 'none' },
  '.cm-searchMatch': { backgroundColor: 'var(--mark-bg)', borderRadius: '3px' },
  '.cm-searchMatch-selected': { outline: '2px solid var(--accent)' },
  '.cm-placeholder': { color: 'var(--faint)', fontStyle: 'italic' },
  '.cm-panels': { backgroundColor: 'var(--surface-2)', color: 'var(--text)', borderColor: 'var(--border) !important' },
  '.cm-panel.cm-search': { padding: '8px 12px', fontFamily: 'var(--font-ui)' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': {
    fontFamily: 'var(--font-ui)', borderRadius: '8px', border: '1px solid var(--border)',
    background: 'var(--surface)', color: 'var(--text)', padding: '4px 8px', backgroundImage: 'none',
  },
  '.cm-panel.cm-search label': { fontSize: '12px', color: 'var(--muted)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px',
    boxShadow: 'var(--shadow-lg)', overflow: 'hidden', fontFamily: 'var(--font-ui)',
  },
  '.cm-tooltip-autocomplete > ul': { maxHeight: '320px', padding: '4px' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '6px 10px !important', borderRadius: '8px', lineHeight: '1.3' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--accent)', color: 'var(--accent-contrast)' },
  '.cm-completionLabel': { fontSize: '13px' },
  '.cm-completionDetail': { fontStyle: 'normal', opacity: '0.7', marginLeft: '12px', fontSize: '12px' },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700' },
});

// ---------------------------------------------------------------------------
// Editing commands
// ---------------------------------------------------------------------------

function wrap(view, before, after = before, fallback = 'text') {
  const { state } = view;
  view.dispatch(
    state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to);
      const outerBefore = state.sliceDoc(range.from - before.length, range.from);
      const outerAfter = state.sliceDoc(range.to, range.to + after.length);
      if (outerBefore === before && outerAfter === after) {
        return {
          changes: [{ from: range.from - before.length, to: range.from }, { from: range.to, to: range.to + after.length }],
          range: EditorSelection.range(range.from - before.length, range.to - before.length),
        };
      }
      if (text.length >= before.length + after.length && text.startsWith(before) && text.endsWith(after)) {
        const inner = text.slice(before.length, text.length - after.length);
        return { changes: { from: range.from, to: range.to, insert: inner }, range: EditorSelection.range(range.from, range.from + inner.length) };
      }
      const content = text || fallback;
      return {
        changes: { from: range.from, to: range.to, insert: before + content + after },
        range: EditorSelection.range(range.from + before.length, range.from + before.length + content.length),
      };
    }),
    { scrollIntoView: true, userEvent: 'input' },
  );
  view.focus();
  return true;
}

const BLOCK_PREFIX = /^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/;

/** Toggle a line-level construct (heading, list, quote, task) on every selected line. */
function lines(view, kind) {
  const { state } = view;
  const seen = new Set();
  const targets = [];
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
      if (!seen.has(n)) seen.add(n), targets.push(state.doc.line(n));
    }
  }
  const prefixFor = (i) =>
    kind === 'ol' ? `${i + 1}. ` : kind === 'ul' ? '- ' : kind === 'task' ? '- [ ] ' : kind === 'quote' ? '> ' : '#'.repeat(kind) + ' ';
  const matches = (current) =>
    kind === 'ol' ? /^\d+[.)]\s+$/.test(current) : kind === 'ul' ? /^[-*+]\s+$/.test(current)
      : kind === 'task' ? /^[-*+]\s+\[[ xX]\]\s+$/.test(current) : kind === 'quote' ? /^>\s?$/.test(current)
        : current.trim() === '#'.repeat(kind);
  const nonEmpty = targets.filter((l) => l.text.trim() || targets.length === 1);
  const allHave = nonEmpty.every((l) => matches(l.text.match(BLOCK_PREFIX)[2] || ''));
  const changes = [];
  nonEmpty.forEach((line, i) => {
    const [, indent, existing = ''] = line.text.match(BLOCK_PREFIX);
    const from = line.from + indent.length;
    const keepExisting = kind === 'quote' && !allHave; // quotes stack on top of lists
    const insert = allHave ? '' : prefixFor(i);
    changes.push({ from, to: keepExisting ? from : from + existing.length, insert });
  });
  view.dispatch({ changes, scrollIntoView: true, userEvent: 'input' });
  view.focus();
  return true;
}

/** Insert a snippet as its own block, padding it with blank lines as needed. */
export function insertBlock(view, template) {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  let from = line.from;
  let to = line.to;
  let prefix = '';
  if (line.text.trim()) {
    from = to = line.to;
    prefix = '\n\n';
  } else if (line.number > 1 && state.doc.line(line.number - 1).text.trim()) {
    prefix = '\n';
  }
  const after = line.number < state.doc.lines && state.doc.line(line.number + 1).text.trim() ? '\n' : '';
  snippet(prefix + template + after)(view, null, from, to);
  view.focus();
  return true;
}

export function insertText(view, text) {
  view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true, userEvent: 'input' });
  view.focus();
  return true;
}

function link(view) {
  const { state } = view;
  const sel = state.sliceDoc(state.selection.main.from, state.selection.main.to);
  const { from, to } = state.selection.main;
  const tpl = /^https?:\/\/\S+$/.test(sel) ? `[\${text}](${sel})` : `[${sel ? sel.replace(/[{}]/g, '') : '${text}'}](\${https://})`;
  snippet(tpl)(view, null, from, to);
  view.focus();
  return true;
}

export function tableTemplate(rows, cols) {
  const row = (cells) => `| ${cells.join(' | ')} |`;
  const head = row(Array.from({ length: cols }, (_, i) => (i === 0 ? '${Header}' : `Header ${i + 1}`)));
  const delim = row(Array.from({ length: cols }, () => '---'));
  const body = Array.from({ length: rows }, () => row(Array.from({ length: cols }, () => '   ')));
  return [head, delim, ...body].join('\n');
}

export const cmd = {
  bold: (v) => wrap(v, '**', '**', 'bold text'),
  italic: (v) => wrap(v, '*', '*', 'italic text'),
  strike: (v) => wrap(v, '~~', '~~', 'struck text'),
  mark: (v) => wrap(v, '==', '==', 'highlighted'),
  code: (v) => wrap(v, '`', '`', 'code'),
  sup: (v) => wrap(v, '^', '^', 'sup'),
  kbd: (v) => wrap(v, '<kbd>', '</kbd>', 'Ctrl'),
  heading: (n) => (v) => lines(v, n),
  ul: (v) => lines(v, 'ul'),
  ol: (v) => lines(v, 'ol'),
  task: (v) => lines(v, 'task'),
  quote: (v) => lines(v, 'quote'),
  link,
  codeBlock: (v) => insertBlock(v, '```${lang}\n${}\n```'),
  math: (v) => insertBlock(v, '$$\n${E = mc^2}\n$$'),
  mermaid: (v) => insertBlock(v, '```mermaid\nflowchart LR\n  A[${Start}] --> B(Think) --> C[Ship it]\n```'),
  hr: (v) => insertBlock(v, '---\n${}'),
  table: (rows = 2, cols = 3) => (v) => insertBlock(v, tableTemplate(rows, cols)),
  alert: (kind) => (v) => insertBlock(v, `> [!${kind.toUpperCase()}]\n> \${Write something here}`),
  footnote: (v) => {
    const n = (v.state.doc.toString().match(/^\[\^[^\]]+\]:/gm) || []).length + 1;
    v.dispatch(v.state.replaceSelection(`[^${n}]`));
    const end = v.state.doc.length;
    const insert = (v.state.doc.sliceString(end - 1, end) === '\n' ? '' : '\n') + `\n[^${n}]: `;
    v.dispatch({ changes: { from: end, insert }, selection: { anchor: end + insert.length }, scrollIntoView: true });
    v.focus();
    return true;
  },
};

// ---------------------------------------------------------------------------
// Completions
// ---------------------------------------------------------------------------

const today = () => new Date().toISOString().slice(0, 10);

export const SLASH_COMMANDS = [
  ['h1', 'Heading 1', '# ${Heading}'],
  ['h2', 'Heading 2', '## ${Heading}'],
  ['h3', 'Heading 3', '### ${Heading}'],
  ['todo', 'Task list', '- [ ] ${Task}\n- [ ] ${}'],
  ['bullets', 'Bulleted list', '- ${Item}\n- ${}'],
  ['numbers', 'Numbered list', '1. ${Item}\n2. ${}'],
  ['quote', 'Quote', '> ${Quote}'],
  ['code', 'Code block', '```${js}\n${}\n```'],
  ['table', 'Table', tableTemplate(2, 3)],
  ['math', 'Math block', '$$\n${\\int_0^1 x^2 \\, dx = \\tfrac13}\n$$'],
  ['mermaid', 'Mermaid diagram', '```mermaid\nflowchart LR\n  A[${Start}] --> B(Think) --> C[Ship it]\n```'],
  ['sequence', 'Sequence diagram', '```mermaid\nsequenceDiagram\n  Alice->>Bob: ${Hello Bob!}\n  Bob-->>Alice: Hi Alice!\n```'],
  ['note', 'Note callout', '> [!NOTE]\n> ${Useful information.}'],
  ['tip', 'Tip callout', '> [!TIP]\n> ${A helpful tip.}'],
  ['important', 'Important callout', '> [!IMPORTANT]\n> ${Key information.}'],
  ['warning', 'Warning callout', '> [!WARNING]\n> ${Careful now.}'],
  ['caution', 'Caution callout', '> [!CAUTION]\n> ${Danger ahead.}'],
  ['divider', 'Divider', '---\n${}'],
  ['image', 'Image from URL', '![${alt text}](${https://})'],
  ['link', 'Link', '[${text}](${https://})'],
  ['details', 'Collapsible section', '<details>\n<summary>${Summary}</summary>\n\n${Hidden content}\n\n</details>'],
  ['deflist', 'Definition list', '${Term}\n: ${Definition}'],
  ['frontmatter', 'Front matter', () => `---\ntitle: \${Title}\nauthor: \${}\ndate: ${today()}\n---`],
  ['date', "Today's date", () => today() + '${}'],
  ['kbd', 'Keyboard key', '<kbd>${Ctrl}</kbd>'],
];

function slashSource(getToc) {
  return (ctx) => {
    const m = ctx.matchBefore(/^\s*\/[\w-]*/);
    if (!m) return null;
    const from = m.from + m.text.indexOf('/');
    const options = [...SLASH_COMMANDS, ['toc', 'Table of contents', () => getToc() + '${}']].map(([id, title, tpl]) => ({
      label: '/' + id,
      detail: title,
      type: 'keyword',
      apply: (view, _c, f, to) => snippet(typeof tpl === 'function' ? tpl() : tpl)(view, null, f, to),
    }));
    return { from, options, validFor: /^\/[\w-]*$/ };
  };
}

function emojiSource(emojis) {
  const options = emojis.map(([name, e]) => ({ label: `:${name}:`, displayLabel: `${e}  ${name}`, apply: e, type: 'text' }));
  return (ctx) => {
    const m = ctx.matchBefore(/:[\w+-]{2,}/);
    if (!m || (m.from > 0 && /\w/.test(ctx.state.sliceDoc(m.from - 1, m.from)))) return null;
    return { from: m.from, options, validFor: /^:[\w+-]*$/ };
  };
}

/**
 * `[[` searches your documents and inserts a plain CommonMark link, `[Title](slug.md)`,
 * so files stay portable (it also works on GitHub and in a zipped export).
 */
function docLinkSource(getDocs) {
  return (ctx) => {
    const m = ctx.matchBefore(/\[\[[^\]\n]*/);
    if (!m) return null;
    const options = getDocs().map(({ title, target }) => ({
      label: title,
      detail: target,
      type: 'variable',
      apply: (view, _c, from, to) => {
        const start = from - 2; // replace the `[[` trigger too
        const end = view.state.sliceDoc(to, to + 2) === ']]' ? to + 2 : to;
        const link = `[${title.replace(/([\[\]])/g, '\\$1')}](${target})`;
        view.dispatch({ changes: { from: start, to: end, insert: link }, selection: { anchor: start + link.length }, userEvent: 'input.complete' });
      },
    }));
    return { from: m.from + 2, options, filter: true };
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createEditor({ parent, emojis, getToc, getDocs, onChange, onCursor, onPaste, onDropFiles }) {
  const gutterC = new Compartment();
  const wrapC = new Compartment();
  const attrsC = new Compartment();

  const formatKeys = keymap.of([
    { key: 'Mod-b', run: cmd.bold },
    { key: 'Mod-i', run: cmd.italic },
    { key: 'Mod-Shift-x', run: cmd.strike },
    { key: 'Mod-Shift-h', run: cmd.mark },
    { key: 'Mod-e', run: cmd.code },
    { key: 'Mod-k', run: cmd.link },
    { key: 'Mod-Shift-7', run: cmd.ol },
    { key: 'Mod-Shift-8', run: cmd.ul },
    { key: 'Mod-Shift-9', run: cmd.task },
    { key: 'Mod-Shift-.', run: cmd.quote },
    ...[1, 2, 3, 4, 5, 6].map((n) => ({ key: `Mod-Alt-${n}`, run: cmd.heading(n) })),
  ]);

  const extensions = () => [
    gutterC.of([]),
    wrapC.of(EditorView.lineWrapping),
    attrsC.of(EditorView.contentAttributes.of({ spellcheck: 'true' })),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
    syntaxHighlighting(highlight),
    baseTheme,
    placeholder('Start writing… type / for blocks, : for emoji, [[ to link a document'),
    autocompletion({ override: [slashSource(getToc), emojiSource(emojis), docLinkSource(getDocs)], icons: false }),
    formatKeys,
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange(u);
      if (u.docChanged || u.selectionSet) onCursor(u.view);
    }),
    EditorView.domEventHandlers({
      paste: (e, view) => onPaste(e, view),
      drop: (e, view) => {
        if (e.dataTransfer?.files?.length) {
          e.preventDefault();
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
          onDropFiles([...e.dataTransfer.files], pos);
          return true;
        }
        return false;
      },
    }),
  ];

  let current = {};
  const view = new EditorView({ parent, state: EditorState.create({ doc: '', extensions: extensions() }) });

  function configure(s) {
    current = s;
    view.dispatch({
      effects: [
        gutterC.reconfigure(s.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
        wrapC.reconfigure(s.lineWrap ? EditorView.lineWrapping : []),
        attrsC.reconfigure(EditorView.contentAttributes.of({ spellcheck: String(!!s.spellcheck) })),
      ],
    });
  }

  return {
    view,
    configure,
    getText: () => view.state.doc.toString(),
    /** Swap documents: a fresh state so undo history doesn't leak between docs. */
    setText(text, cursor = 0) {
      view.setState(EditorState.create({ doc: text, extensions: extensions(), selection: { anchor: Math.min(cursor, text.length) } }));
      configure(current);
    },
    replaceAll(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: 'input' });
    },
    centerCursor() {
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }) });
    },
    gotoLine(line) {
      const l = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines));
      view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'start', yMargin: 60 }) });
      view.focus();
    },
  };
}
