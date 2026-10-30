// Small UI primitives: toasts, dropdown menus, and modal dialogs.
import { icon } from './icons.js';
import { escapeHtml } from './preview.js';

export function toast(message, { icon: ic = 'check', action, duration = 2600, tone = '' } = {}) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.innerHTML = `${icon(ic)}<span>${escapeHtml(message)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => {
      action.run();
      dismiss();
    };
    el.append(b);
  }
  host.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const dismiss = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  };
  setTimeout(dismiss, action ? Math.max(duration, 6000) : duration);
}

let openMenu = null;

export function closeMenu() {
  openMenu?.remove();
  openMenu = null;
  document.querySelectorAll('[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
}

/**
 * Show a dropdown under `anchor`. Items: { icon, label, hint, run, active } | '-' | { header } | { element }.
 */
export function showMenu(anchor, items, { align = 'left', className = '' } = {}) {
  const wasOpen = openMenu?.anchor === anchor;
  closeMenu();
  if (wasOpen) return;
  const menu = document.createElement('div');
  menu.className = `menu ${className}`;
  menu.anchor = anchor;
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    if (item === '-') {
      menu.insertAdjacentHTML('beforeend', '<div class="menu-sep"></div>');
    } else if (item.header) {
      menu.insertAdjacentHTML('beforeend', `<div class="menu-header">${escapeHtml(item.header)}</div>`);
    } else if (item.element) {
      menu.append(item.element);
    } else {
      const b = document.createElement('button');
      b.className = 'menu-item' + (item.active ? ' active' : '');
      b.setAttribute('role', 'menuitem');
      b.innerHTML = `${item.swatch ? `<span class="swatch" style="background:${item.swatch}"></span>` : icon(item.icon || 'file')}
        <span class="menu-label">${escapeHtml(item.label)}${item.desc ? `<small>${escapeHtml(item.desc)}</small>` : ''}</span>
        ${item.hint ? `<kbd>${escapeHtml(item.hint)}</kbd>` : ''}${item.active ? icon('check', 'menu-check') : ''}`;
      b.onclick = () => {
        closeMenu();
        item.run();
      };
      menu.append(b);
    }
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  let left = align === 'right' ? r.right - mw : r.left;
  left = Math.max(8, Math.min(left, innerWidth - mw - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.min(r.bottom + 6, innerHeight - menu.offsetHeight - 8)}px`;
  anchor.setAttribute('aria-expanded', 'true');
  openMenu = menu;
  menu.querySelector('button, input')?.focus({ preventScroll: true });
}

document.addEventListener('pointerdown', (e) => {
  if (openMenu && !openMenu.contains(e.target) && !openMenu.anchor.contains(e.target)) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (!openMenu) return;
  if (e.key === 'Escape') {
    const a = openMenu.anchor;
    closeMenu();
    a.focus?.();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const items = [...openMenu.querySelectorAll('.menu-item')];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    e.preventDefault();
  }
});

/** Simple prompt dialog that returns the entered string, or null when cancelled. */
export function promptDialog({ title, label, placeholder = '', value = '', okLabel = 'OK', icon: ic = 'globe' }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'modal small';
    d.innerHTML = `<form method="dialog">
      <header class="modal-head">${icon(ic)}<h2>${escapeHtml(title)}</h2></header>
      <label class="field"><span>${escapeHtml(label)}</span><input name="v" autocomplete="off" placeholder="${escapeHtml(placeholder)}"></label>
      <footer class="modal-foot"><button type="button" value="cancel" class="btn" data-cancel>Cancel</button><button value="ok" class="btn primary">${escapeHtml(okLabel)}</button></footer>
    </form>`;
    document.body.append(d);
    const input = d.querySelector('input');
    input.value = value;
    d.querySelector('[data-cancel]').onclick = () => d.close('cancel');
    d.addEventListener('close', () => {
      resolve(d.returnValue === 'ok' && input.value.trim() ? input.value.trim() : null);
      d.remove();
    });
    d.showModal();
    input.select();
  });
}
