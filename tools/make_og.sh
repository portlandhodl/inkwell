#!/usr/bin/env bash
# Regenerates static/og-image.png (1200×630 link-preview card) from tools/og-card.html.
# Needs Playwright's Chromium: npx playwright install chromium
set -euo pipefail
cd "$(dirname "$0")/.."
npx --yes playwright@1.48.2 screenshot --viewport-size=1200,630 --wait-for-timeout=1500 \
  "file://$PWD/tools/og-card.html" static/og-image.png
python3 - <<'PY'
from PIL import Image
im = Image.open('static/og-image.png').convert('RGB')
im.save('static/og-image.png', optimize=True)
print('og-image.png', im.size)
PY
