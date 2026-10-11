#!/usr/bin/env bash
set -euo pipefail
demo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$demo_dir/../run.sh" "$demo_dir" --port 4184 --app "$demo_dir/app.ts" --hooks "$demo_dir/hooks.ts" "$@"
