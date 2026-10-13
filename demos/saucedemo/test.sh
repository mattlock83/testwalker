#!/usr/bin/env bash
# Run the external-site model through the native framework and web adapter.
set -euo pipefail
demo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$demo_dir/../.." && pwd)"
export TESTWALKER_BIN="${TESTWALKER_BIN:-$repo_dir/core/target/release/testwalker}"
exec node "$repo_dir/testwalker-web/dist/cli.js" run \
  --directory "$demo_dir" --url https://www.saucedemo.com/ \
  --input-mode none --max-steps 10000 --max-calls 4000 "$@"
