// Thin bridge over the Rust core's C ABI (see wasm/src/lib.rs).
const enc = new TextEncoder();
const dec = new TextDecoder();
let core = null;

export const FLAGS = { smartPunct: 1, hardBreaks: 2, subscript: 4 };

export async function initWasm(url) {
  const res = await fetch(url);
  const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
  core = instance.exports;
}

function call(str, fn) {
  const bytes = enc.encode(str);
  const ptr = core.alloc(bytes.length);
  new Uint8Array(core.memory.buffer, ptr, bytes.length).set(bytes);
  try {
    fn(ptr, bytes.length);
  } finally {
    core.dealloc(ptr, bytes.length);
  }
}

const read = (ptr, len) => dec.decode(new Uint8Array(core.memory.buffer, ptr, len));
const readHtml = () => read(core.html_ptr(), core.html_len());

export function render(markdown, flags = 0) {
  call(markdown, (p, l) => core.render(p, l, flags));
  return { html: readHtml(), meta: JSON.parse(read(core.meta_ptr(), core.meta_len())) };
}

export function formatTables(markdown) {
  call(markdown, (p, l) => core.format_tables(p, l));
  return readHtml();
}

export function emojiList() {
  core.emoji_list();
  return JSON.parse(readHtml());
}

/** The core reports UTF-8 byte offsets; CodeMirror wants UTF-16 indices. */
export function byteToCharOffset(text, byteOffset) {
  return dec.decode(enc.encode(text).subarray(0, byteOffset)).length;
}
