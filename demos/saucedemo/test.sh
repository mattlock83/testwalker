#!/usr/bin/env bash
# Run the external-site model through the native framework and web adapter.
set -euo pipefail
demo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec node "$demo_dir/run.mjs" "$@"
