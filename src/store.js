// Documents and pasted images live in IndexedDB; small settings in localStorage.
const DB_NAME = 'inkwell';
let dbPromise;

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('docs', { keyPath: 'id' });
      req.result.createObjectStore('images', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const listDocs = () => tx('docs', 'readonly', (s) => s.getAll());
export const getDoc = (id) => tx('docs', 'readonly', (s) => s.get(id));
export const putDoc = (doc) => tx('docs', 'readwrite', (s) => s.put(doc));
export const deleteDoc = (id) => tx('docs', 'readwrite', (s) => s.delete(id));

export const putImage = (img) => tx('images', 'readwrite', (s) => s.put(img));
export const getImage = (id) => tx('images', 'readonly', (s) => s.get(id));

export function newDoc(content = '', title = 'Untitled') {
  const now = Date.now();
  return { id: uid(), title, autoTitle: true, content, created: now, updated: now, pinned: false };
}

const SETTINGS_KEY = 'inkwell:settings';
export const DEFAULT_SETTINGS = {
  theme: 'auto',
  view: 'split',
  sidebar: true,
  sidebarTab: 'docs',
  previewFont: 'sans',
  fontSize: 15,
  lineNumbers: false,
  lineWrap: true,
  smartPunct: false,
  hardBreaks: false,
  subscript: false,
  smartPaste: true,
  syncScroll: true,
  typewriter: false,
  spellcheck: true,
  wordGoal: 500,
  splitRatio: 0.5,
  docSort: 'recent',
  multiExportFormat: 'md-zip',
  lastDoc: null,
};

export function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}
