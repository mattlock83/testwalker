#!/usr/bin/env bash
# Discover a new draft; never overwrite the authored model.
set -euo pipefail
demo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec node "$demo_dir/../discover.mjs" "$demo_dir" \
  --depth 5 --max-pages 40 --max-actions 300 \
  --click-buttons --probe-empty-forms "$@"
