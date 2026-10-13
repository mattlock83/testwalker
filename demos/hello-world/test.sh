#!/usr/bin/env bash
# Execute the authored graph model and selected property tests.
set -euo pipefail
demo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$demo_dir/run.sh" "$@"
