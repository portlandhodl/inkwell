// Command palette (Ctrl/Cmd+Shift+P): fuzzy search across commands, documents and headings.
import { icon } from './icons.js';
import { escapeHtml } from './preview.js';

function score(query, text) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const s = text.toLowerCase();
  const idx = s.indexOf(q);
  if (idx >= 0) return 100 - idx + (idx === 0 || s[idx - 1] === ' ' ? 50 : 0);
  // subsequence match
  let qi = 0;
  let gaps = 0;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) qi++;
    else if (qi > 0) gaps++;
  }
  return qi === q.length ? 40 - Math.min(gaps, 39) : 0;
}

export function openPalette(items, { placeholder = 'Type a command, document or heading…', initial = '' } = {}) {
  document.querySelector('.palette')?.remove();
  const d = document.createElement('dialog');
  d.className = 'palette';
  d.innerHTML = `<div class="palette-search">${icon('search')}<input placeholder="${escapeHtml(placeholder)}" autocomplete="off" spellcheck="false"><kbd>esc</kbd></div><ul class="palette-list" role="listbox"></ul>`;
  document.body.append(d);
  const input = d.querySelector('input');
  const list = d.querySelector('ul');
  let shown = [];
  let sel = 0;

  const draw = () => {
    const q = input.value.trim();
    shown = items
      .map((it) => ({ it, s: score(q, `${it.group} ${it.label} ${it.keywords || ''}`) + score(q, it.label) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 60)
      .map((x) => x.it);
    if (!q) shown = items.slice(0, 60);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.innerHTML = shown.length
      ? shown
          .map(
            (it, i) => `<li role="option" data-i="${i}" class="${i === sel ? 'sel' : ''}">${icon(it.icon || 'command')}
            <span class="pl-label">${escapeHtml(it.label)}</span><span class="pl-group">${escapeHtml(it.group || '')}</span>
            ${it.hint ? `<kbd>${escapeHtml(it.hint)}</kbd>` : ''}</li>`,
          )
          .join('')
      : '<li class="empty">Nothing matches — try another word ✨</li>';
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };

  const run = (i) => {
    const it = shown[i];
    if (!it) return;
    d.close();
    setTimeout(() => it.run(), 0);
  };

  input.addEventListener('input', () => {
    sel = 0;
    draw();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(shown.length, 1);
      draw();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      run(sel);
      e.preventDefault();
    }
  });
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) run(+li.dataset.i);
  });
  list.addEventListener('mousemove', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li && +li.dataset.i !== sel) {
      sel = +li.dataset.i;
      list.querySelectorAll('li').forEach((l) => l.classList.toggle('sel', +l.dataset.i === sel));
    }
  });
  d.addEventListener('click', (e) => e.target === d && d.close());
  d.addEventListener('close', () => d.remove());
  input.value = initial;
  draw();
  d.showModal();
  input.focus();
}
