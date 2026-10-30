# Inkwell

A Markdown editor for Chrome. Markdown is parsed by a Rust engine (`pulldown-cmark`) compiled to WebAssembly, so the preview keeps up as you type.

**Live:** https://portlandhodl.github.io/inkwell/ (runs entirely in your browser; documents stay in local storage)

## Install as a Chrome extension

1. `./build.sh` (needs Rust with the `wasm32-unknown-unknown` target, Node 18+, and `npm install` run once)
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the `extension/` folder.
3. Click the toolbar icon or press **Alt+Shift+M**.

`inkwell.zip` is produced alongside for uploading to the Chrome Web Store.

## Features

- **Markdown:** CommonMark + GFM tables, task lists, strikethrough, footnotes, autolinks, GitHub alerts (`> [!NOTE]`), definition lists, front matter, heading IDs/attributes, `==highlight==`, `^sup^`, optional `~sub~`, `:emoji:` shortcodes, `[[wiki links]]` between documents, smart punctuation, hard-break mode.
- **Rich blocks:** KaTeX math, Mermaid diagrams, syntax highlighting for ~40 languages, collapsible `<details>`, images pasted or dropped straight in (stored locally).
- **Editor:** CodeMirror 6 with Markdown highlighting, highlighted code in fences, list continuation, multi-cursor, find & replace, `/` slash commands, `:` emoji completion, formatting shortcuts, a table-size picker and a WASM table aligner.
- **Workspace:** multiple documents with search, pinning, duplicate, and delete with undo; outline panel; split/write/preview views with synced scroll and a resizable divider; checkboxes you can click in the preview; double-click the preview to jump to the source.
- **Fun:** 7 themes plus Auto, zen mode, typewriter scrolling, a word-goal ring, and confetti when you finish every task or hit your goal.
- **Import:** `.md`/`.txt`/`.html` files (picker or drag & drop), URLs (GitHub/GitLab/Gist links become raw files), rich-text paste turned into Markdown, JSON backups. Right-click on any page to **Send selection to Inkwell** or **Open link in Inkwell**.
- **Export:** Markdown (images embedded), standalone themed HTML, PDF (print), Word `.doc`, plain text, rich-text copy, Markdown copy, full JSON backup.

## Layout

| Path | What |
| --- | --- |
| `wasm/` | Rust core: render, outline/stats, emoji, table formatter (C ABI, no wasm-bindgen) |
| `src/` | UI modules bundled by esbuild into `extension/dist/app.js` |
| `static/` | Manifest, service worker, HTML, CSS, icons, welcome doc |
| `tools/make_icons.py` | Regenerates the PNG icons |

Pushing to `main` builds and deploys the site through `.github/workflows/pages.yml`; the site also offers the extension zip for download.

Run the core's tests with `cd wasm && cargo test --lib`.
