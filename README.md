# Inkwell

A Markdown editor for Chrome. Markdown is parsed by a Rust engine (`pulldown-cmark`) compiled to WebAssembly, so the preview keeps up as you type.

**Live:** https://portlandhodl.github.io/inkwell/ (runs entirely in your browser; documents stay in local storage)

## Install as a Chrome extension

1. `./build.sh` (needs Rust with the `wasm32-unknown-unknown` target, Node 18+, and `npm install` run once)
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the `extension/` folder.
3. Click the toolbar icon or press **Alt+Shift+M**.

`inkwell.zip` is produced alongside for uploading to the Chrome Web Store.

## Offline single file

`./build-offline.sh` produces `inkwell.html`: the whole editor in one file, with the WebAssembly core, Mermaid, KaTeX fonts, styles and icons embedded. Copy it to an air-gapped machine and open it—no server or network needed. Releases attach this file.

## Features

- **Markdown:** CommonMark + GFM tables, task lists, strikethrough, footnotes, autolinks, GitHub alerts (`> [!NOTE]`), definition lists, front matter, heading IDs/attributes, `==highlight==`, `^sup^`, optional `~sub~`, `:emoji:` shortcodes, `[[wiki links]]` between documents, smart punctuation, hard-break mode.
- **Rich blocks:** KaTeX math, Mermaid diagrams, syntax highlighting for ~40 languages, collapsible `<details>`, images pasted or dropped straight in (stored locally).
- **Editor:** CodeMirror 6 with Markdown highlighting, highlighted code in fences, list continuation, multi-cursor, find & replace, `/` slash commands, `:` emoji completion, formatting shortcuts, a table-size picker and a WASM table aligner.
- **Workspace:** multiple documents with search, pinning, duplicate, and delete with undo; drag (or Alt+↑/↓) to reorder, or sort by recent edits or title; outline panel; split/write/preview views with synced scroll and a resizable divider; checkboxes you can click in the preview; double-click the preview to jump to the source.
- **Fun:** 7 themes plus Auto, zen mode, typewriter scrolling, a word-goal ring, and confetti when you finish every task or hit your goal.
- **Import:** `.md`/`.txt`/`.html` files (picker or drag & drop), URLs (GitHub/GitLab/Gist links become raw files), rich-text paste turned into Markdown, JSON backups. Right-click on any page to **Send selection to Inkwell** or **Open link in Inkwell**.
- **Export:** Markdown (images embedded), standalone themed HTML, PDF (print), Word `.doc`, plain text, rich-text copy, Markdown copy, full JSON backup.
- **Share:** **Share** (Ctrl/⌘+Shift+S) creates a link with the whole document compressed into the URL fragment, so nothing is uploaded and the server never sees it. Recipients get a read-only view with **Save a copy**. Links made in the extension point at the GitHub Pages site. Also: system share sheet, email, or share as a `.md` file (which includes pasted images; links can't).
- **Multi-document export:** pick any set of documents and get a ZIP of Markdown files (images in `images/`), a ZIP of HTML pages with an index, or one combined Markdown, HTML (with contents) or PDF file in sidebar order.
- **Linking documents:** type `[[` to insert a link to another document. It's a plain CommonMark link, `[Title](title.md)`, so it still works on GitHub, in other editors, and inside the Markdown ZIP export (files are named to match). `#heading` fragments and `[[wiki links]]` resolve too; links to missing documents create them; the Outline panel lists backlinks; HTML exports rewrite links to the exported pages.

## Layout

| Path | What |
| --- | --- |
| `wasm/` | Rust core: render, outline/stats, emoji, table formatter (C ABI, no wasm-bindgen) |
| `src/` | UI modules bundled by esbuild into `extension/dist/app.js` |
| `static/` | Manifest, service worker, HTML, CSS, icons, welcome doc |
| `tools/make_icons.py` | Regenerates the PNG icons |

**Link previews:** `static/editor.html` carries Open Graph and X card tags plus `theme-color`, Slack label rows and an Apple touch icon, so links unfurl on Facebook, X, LinkedIn, Slack, Discord, WhatsApp, iMessage, Telegram, Teams, Signal, Mastodon, Bluesky and Reddit. The card image is `static/og-image.png` (1200×630), rendered from `tools/og-card.html` by `tools/make_og.sh`. The site address comes from `SITE_URL` in `build.sh`; the Pages workflow sets it automatically.

Pushing to `main` builds and deploys the site through `.github/workflows/pages.yml`; the site also offers the extension zip for download.

Run the core's tests with `cd wasm && cargo test --lib`.
