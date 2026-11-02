// Lucide-style stroke icons, inlined so the extension needs no icon font.
const P = (d) => d.split(' M').map((s, i) => `<path d="${i ? 'M' + s : s}"/>`).join('');
const rect = (x, y, w, h, r = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;
const circle = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;

const ICONS = {
  bold: P('M6 4h8a4 4 0 0 1 0 8H6z M6 12h9a4 4 0 0 1 0 8H6z'),
  italic: P('M19 4h-9 M14 20H5 M15 4 9 20'),
  strike: P('M16 4H9a3 3 0 0 0-2.83 4 M14 12a4 4 0 0 1 0 8H6 M4 12h16'),
  mark: P('m9 11-6 6v3h9l3-3 M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4'),
  code: P('m16 18 6-6-6-6 M8 6l-6 6 6 6'),
  codeBlock: rect(3, 3, 18, 18) + P('m10 9-3 3 3 3 M14 15l3-3-3-3'),
  link: P('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'),
  image: rect(3, 3, 18, 18) + circle(9, 9, 2) + P('m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21'),
  quote: P('M6 7h4v4c0 3-2 5-4 6 M14 7h4v4c0 3-2 5-4 6'),
  ul: P('M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01'),
  ol: P('M10 6h11 M10 12h11 M10 18h11 M4 6h1v4 M4 10h2 M6 18H4c0-1 2-2 2-3s-1-1.5-2-1'),
  task: P('m9 11 3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'),
  table: rect(3, 3, 18, 18) + P('M3 9h18 M3 15h18 M9 3v18 M15 3v18'),
  hr: P('M5 12h14'),
  math: P('M18 7V4H6l6 8-6 8h12v-3'),
  diagram: circle(6, 6, 3) + circle(6, 18, 3) + circle(18, 12, 3) + P('M6 9v6 M8.6 7.5l6.8 3 M8.6 16.5l6.8-3'),
  smile: circle(12, 12, 10) + P('M8 14s1.5 2 4 2 4-2 4-2 M9 9h.01 M15 9h.01'),
  heading: P('M6 12h12 M6 20V4 M18 20V4'),
  footnote: P('M4 19l8-8 M12 19l-8-8 M20 12h-4c0-1.5.44-2 1.5-2.5S20 8.33 20 7.06c0-.47-.17-.93-.48-1.29a2.11 2.11 0 0 0-2.62-.44c-.42.24-.74.62-.9 1.07'),
  alert: P('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3 M12 9v4 M12 17h.01'),
  open: P('m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2'),
  download: P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3'),
  upload: P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12'),
  moon: P('M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'),
  palette: circle(13.5, 6.5, 0.5) + circle(17.5, 10.5, 0.5) + circle(8.5, 7.5, 0.5) + circle(6.5, 12.5, 0.5) + P('M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.56-2.5 5.56-5.55C21.97 6.01 17.46 2 12 2z'),
  command: P('M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3'),
  settings: P('M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6'),
  split: rect(3, 3, 18, 18) + P('M12 3v18'),
  width: P('m18 8 4 4-4 4 M2 12h20 M6 8l-4 4 4 4'),
  pen: P('M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'),
  eye: P('M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z') + circle(12, 12, 3),
  sidebar: rect(3, 3, 18, 18) + P('M9 3v18'),
  plus: P('M12 5v14 M5 12h14'),
  trash: P('M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'),
  copy: rect(9, 9, 13, 13) + P('M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'),
  search: circle(11, 11, 8) + P('m21 21-4.3-4.3'),
  zen: P('M8 3H5a2 2 0 0 0-2 2v3 M21 8V5a2 2 0 0 0-2-2h-3 M3 16v3a2 2 0 0 0 2 2h3 M16 21h3a2 2 0 0 0 2-2v-3'),
  file: P('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z M14 2v4a2 2 0 0 0 2 2h4 M10 9H8 M16 13H8 M16 17H8'),
  outline: P('M21 12h-8 M21 6H8 M21 18h-8 M3 6v4c0 1.1.9 2 2 2h3 M3 10v6c0 1.1.9 2 2 2h3'),
  printer: P('M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z'),
  globe: circle(12, 12, 10) + P('M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'),
  wand: P('m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72 M14 7l3 3 M5 6v4 M19 14v4 M10 2v2 M7 8H3 M21 16h-4 M11 3H9'),
  sparkles: P('M12 3l1.9 5.8L20 10.7l-5.8 1.9L12 18.5l-1.9-5.9L4.2 10.7l5.9-1.9z M5 3v4 M3 5h4 M19 17v4 M17 19h4'),
  target: circle(12, 12, 10) + circle(12, 12, 6) + circle(12, 12, 2),
  check: P('M20 6 9 17l-5-5'),
  x: P('M18 6 6 18 M6 6l12 12'),
  chevron: P('m6 9 6 6 6-6'),
  undo: P('M3 7v6h6 M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13'),
  redo: P('M21 7v6h-6 M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7'),
  archive: rect(2, 3, 20, 5, 1) + P('M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8 M10 12h4'),
  clipboard: rect(8, 2, 8, 4, 1) + P('M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'),
  word: P('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z M14 2v4a2 2 0 0 0 2 2h4 M8 12l1.5 6 2.5-4.5 2.5 4.5 1.5-6'),
  html: P('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z M14 2v4a2 2 0 0 0 2 2h4 M10 12l-2 2.5 2 2.5 M14 12l2 2.5-2 2.5'),
  text: P('M4 7V4h16v3 M9 20h6 M12 4v16'),
  pin: P('M12 17v5 M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z'),
  duplicate: rect(8, 8, 14, 14) + P('M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2 M15 12v6 M12 15h6'),
  keyboard: rect(2, 4, 20, 16) + P('M6 8h.01 M10 8h.01 M14 8h.01 M18 8h.01 M8 12h.01 M12 12h.01 M16 12h.01 M7 16h10'),
  book: P('M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20'),
  sort: P('m3 16 4 4 4-4 M7 20V4 M21 8l-4-4-4 4 M17 4v16'),
  files: P('M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8z M15 2v4a2 2 0 0 0 2 2h4 M5 7v12a2 2 0 0 0 2 2h9'),
  share: circle(18, 5, 3) + circle(6, 12, 3) + circle(18, 19, 3) + P('m8.59 13.51 6.83 3.98 M15.41 6.51l-6.82 3.98'),
  mail: rect(2, 4, 20, 16) + P('m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7'),
  external: P('M15 3h6v6 M10 14 21 3 M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'),
  zoomIn: circle(11, 11, 8) + P('m21 21-4.3-4.3 M11 8v6 M8 11h6'),
  zoomOut: circle(11, 11, 8) + P('m21 21-4.3-4.3 M8 11h6'),
  magnifier: circle(10, 10, 7) + circle(10, 10, 3) + P('m21 21-6-6'),
  fit: P('M3 8V5a2 2 0 0 1 2-2h3 M16 3h3a2 2 0 0 1 2 2v3 M21 16v3a2 2 0 0 1-2 2h-3 M8 21H5a2 2 0 0 1-2-2v-3') + rect(8, 8, 8, 8, 1),
  expand: P('M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7'),
  bolt: P('M13 2 3 14h9l-1 8 10-12h-9l1-8z'),
};

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
}

export const LOGO = `<svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true">
  <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/></linearGradient></defs>
  <path d="M16 3c4.8 6 9 11 9 16a9 9 0 0 1-18 0c0-5 4.2-10 9-16z" fill="url(#lg)"/>
  <path d="M12 20a4 4 0 0 0 4 4" stroke="#fff" stroke-opacity=".75" stroke-width="2.2" fill="none" stroke-linecap="round"/>
</svg>`;
