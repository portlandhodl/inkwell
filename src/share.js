// Share links: the whole document is compressed into the URL fragment, so nothing is uploaded
// and the server never sees it (browsers don't send `#…` in requests).
import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';

/** Where share links point when Inkwell runs somewhere others can't open (the Chrome extension). */
export const PUBLIC_URL = __SITE_URL__; // injected by build.sh
const PREFIX = '#share=';

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function shareBaseUrl() {
  if (!/^https?:$/.test(location.protocol)) return PUBLIC_URL;
  return location.origin + location.pathname.replace(/(editor|index)\.html$/, '');
}

export function buildShareUrl({ title, content, flags }) {
  const payload = JSON.stringify({ v: 1, t: title, c: content, f: flags });
  return shareBaseUrl() + PREFIX + toBase64Url(deflateSync(strToU8(payload), { level: 9 }));
}

/** The shared document in `hash`, `null` if there is none, or throws if the link is damaged. */
export function readShareHash(hash = location.hash) {
  if (!hash.startsWith(PREFIX)) return null;
  const data = JSON.parse(strFromU8(inflateSync(fromBase64Url(hash.slice(PREFIX.length)))));
  if (typeof data?.c !== 'string') throw new Error('missing content');
  return { title: String(data.t || 'Shared document'), content: data.c, flags: Number(data.f) || 0 };
}

export function clearShareHash() {
  if (location.hash.startsWith(PREFIX)) history.replaceState(null, '', location.pathname + location.search);
}
