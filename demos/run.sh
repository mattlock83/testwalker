#!/usr/bin/env bash
# Hosting wrapper only: the Node CLI starts the site and Rust owns execution and reports.
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$project_dir/.." && pwd)"
export TESTWALKER_BIN="${TESTWALKER_BIN:-$repo_dir/core/target/release/testwalker}"
if (($# == 0)); then printf 'Usage: demos/run.sh DEMO_DIRECTORY [options]\n' >&2; exit 2; fi
demo_dir="$1"
shift
exec node "$repo_dir/testwalker-web/dist/cli.js" demo --directory "$demo_dir" "$@"
