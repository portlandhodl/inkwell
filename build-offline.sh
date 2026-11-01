#!/usr/bin/env bash
# Builds inkwell.html: one self-contained file that runs offline from file://.
set -euo pipefail
cd "$(dirname "$0")"

./build.sh
python3 tools/make_offline.py extension inkwell.html
