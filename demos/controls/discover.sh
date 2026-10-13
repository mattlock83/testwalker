#!/usr/bin/env bash
# Discover a new draft; never overwrite the authored model.
set -euo pipefail
demo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec node "$demo_dir/../discover.mjs" "$demo_dir" \
  --depth 4 --max-pages 60 --max-actions 500 --max-state-variants 2 \
  --click-buttons --probe-empty-forms "$@"
