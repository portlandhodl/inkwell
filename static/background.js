// Inkwell service worker: opens the editor and offers "send to Inkwell" context menus.
const EDITOR = chrome.runtime.getURL('editor.html');

async function openEditor(query = '') {
  const [existing] = await chrome.tabs.query({ url: EDITOR + '*' });
  if (existing && !query) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: EDITOR + query });
  }
}

chrome.action.onClicked.addListener(() => openEditor());

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'selection', title: 'Send selection to Inkwell', contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'link', title: 'Open link in Inkwell', contexts: ['link'] });
  chrome.contextMenus.create({ id: 'new', title: 'New Inkwell document', contexts: ['action'] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'selection') {
    const source = tab?.url ? `\n\n---\n*Clipped from [${tab.title || tab.url}](${tab.url})*\n` : '';
    await chrome.storage.local.set({ inbox: { title: tab?.title || 'Clipping', content: `> ${info.selectionText.replace(/\n/g, '\n> ')}${source}` } });
    openEditor('?inbox=1');
  } else if (info.menuItemId === 'link') {
    openEditor('?url=' + encodeURIComponent(info.linkUrl));
  } else if (info.menuItemId === 'new') {
    openEditor('?new=1');
  }
});
