#!/usr/bin/env bash
# Builds the unpacked Chrome extension into ./extension and a zip for the Web Store.
set -euo pipefail
cd "$(dirname "$0")"
OUT=extension
# Public address of the web build, used for link previews and share links.
SITE_URL="${SITE_URL:-https://portlandhodl.github.io/inkwell/}"
[[ "$SITE_URL" == */ ]] || SITE_URL="$SITE_URL/"

echo "› Rust → WebAssembly"
(cd wasm && cargo build --quiet --release --target wasm32-unknown-unknown)

rm -rf "$OUT"
mkdir -p "$OUT/dist" "$OUT/vendor/katex"
cp wasm/target/wasm32-unknown-unknown/release/inkwell_core.wasm "$OUT/dist/inkwell.wasm"

echo "› Bundling UI"
npx esbuild src/main.js --bundle --minify --format=iife --target=chrome110 \
  --legal-comments=none --log-level=warning --define:__SITE_URL__="\"$SITE_URL\"" --outfile="$OUT/dist/app.js"

echo "› Copying static assets"
cp -r static/. "$OUT/"
sed -i "s|%SITE_URL%|$SITE_URL|g" "$OUT/editor.html"
cp "$OUT/editor.html" "$OUT/index.html"   # GitHub Pages entry point
cp node_modules/katex/dist/katex.min.css "$OUT/vendor/katex/"
cp -r node_modules/katex/dist/fonts "$OUT/vendor/katex/"
cp node_modules/mermaid/dist/mermaid.min.js "$OUT/vendor/"

python3 - "$OUT" <<'PY'
import sys, zipfile, pathlib
root = pathlib.Path(sys.argv[1])
with zipfile.ZipFile('inkwell.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for p in sorted(root.rglob('*')):
        if p.is_file():
            z.write(p, p.relative_to(root))
PY
du -sh "$OUT" | awk '{print "✓ Built " $2 " (" $1 ")  ·  inkwell.zip ready"}'
