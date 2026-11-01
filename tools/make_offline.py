#!/usr/bin/env python3
"""Assemble a single, fully self-contained HTML file from the built extension.

Everything the app needs at runtime is inlined: the WASM core (base64), the
JavaScript bundle, Mermaid, KaTeX (including fonts), the stylesheets, the icons
and the welcome document. The result runs from file:// on an air-gapped machine.
"""
import base64
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
out = pathlib.Path(sys.argv[2])

MIMES = {
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
}


def data_uri(path):
    mime = MIMES.get(path.suffix.lower(), "application/octet-stream")
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def inline_font_urls(css, css_dir):
    def repl(match):
        url = match.group(1).strip("'\"")
        if url.startswith(("data:", "http:", "https:")):
            return match.group(0)
        return f"url({data_uri((css_dir / url).resolve())})"

    import re

    return re.sub(r"url\(([^)]+)\)", repl, css)


def script_safe(text):
    return text.replace("</script", "<\\/script")


html = (root / "editor.html").read_text()

styles = "\n".join(
    [
        inline_font_urls((root / "vendor/katex/katex.min.css").read_text(), root / "vendor/katex"),
        (root / "css/app.css").read_text(),
        (root / "css/preview.css").read_text(),
    ]
)
html = html.replace(
    '<link rel="stylesheet" href="vendor/katex/katex.min.css">\n  <link rel="stylesheet" href="css/app.css">\n  <link rel="stylesheet" href="css/preview.css">',
    f"<style>\n{styles}\n</style>",
)
html = html.replace('<link rel="icon" type="image/png" href="icons/icon-32.png">', f'<link rel="icon" href="{data_uri(root / "icons/icon-32.png")}">')
html = html.replace('<link rel="apple-touch-icon" href="icons/icon-180.png">', f'<link rel="apple-touch-icon" href="{data_uri(root / "icons/icon-180.png")}">')

wasm = base64.b64encode((root / "dist/inkwell.wasm").read_bytes()).decode()
prelude = (
    "<script>"
    f'window.__INKWELL_WASM_B64__="{wasm}";'
    f"window.__INKWELL_WELCOME__={json.dumps((root / 'welcome.md').read_text())};"
    f"window.__INKWELL_PREVIEW_CSS__={json.dumps((root / 'css/preview.css').read_text())};"
    "</script>"
)
mermaid = f"<script>{script_safe((root / 'vendor/mermaid.min.js').read_text())}</script>"
app = f"<script>{script_safe((root / 'dist/app.js').read_text())}</script>"
html = html.replace('<script src="dist/app.js"></script>', f"{prelude}\n{mermaid}\n{app}")

out.write_text(html)
print(f"✓ Wrote {out} ({out.stat().st_size / 1024 / 1024:.1f} MB)")
