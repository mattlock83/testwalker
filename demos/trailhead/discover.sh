#!/usr/bin/env bash
# Discover a new draft; never overwrite the authored model.
set -euo pipefail
demo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec node "$demo_dir/../discover.mjs" "$demo_dir" \
  --app "$demo_dir/app.ts" --depth 10 --max-pages 100 --max-actions 4000 --settle-ms 100 \
  --click-buttons --probe-empty-forms "$@"
