#!/usr/bin/env bash
# Discover a new draft; never overwrite the authored model.
set -euo pipefail
demo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec node "$demo_dir/../discover.mjs" "$demo_dir" \
  --url https://www.saucedemo.com/ --values "$demo_dir/discovery/values.json" --depth 8 --max-pages 60 --max-actions 1200 --max-state-variants 2 --settle-ms 600 \
  --click-buttons --probe-empty-forms "$@"
