# Testwalker

A Rust test framework driven by declarative GraphWalker models. Rust owns graph exploration, Hegel input generation/shrinking, lifecycle scheduling, decision providers, verdicts, coverage, replay and HTML/JSON/JUnit reports. Executable adapters interact with it through bidirectional JSON-RPC.

The web adapter is **TypeScript/JavaScript**, using Playwright with Jev decisions through the core's JSON-RPC API. The independent discovery package uses JavaScript Crawlee and needs no Jev key or Rust executable. Python is not required.

```text
core/                       Standalone Rust framework, CLI, tests and reports
  models/rpc-selftest.json  Model that tests the framework itself
  docs/, openrpc*.json      Framework documentation and API specifications
testwalker-web/             Standalone Node package: @testwalker/web
  src/, tests/, docs/       Playwright/Jev adapter and hooks
testwalker-discover/        Standalone Node package: @testwalker/discover
  src/, tests/, docs/       Crawlee discovery, model drafts and static viewer
demos/                      Applications, models and colocated TypeScript tests
  hello-world/             Two navigation options and one form input
  booking/                 Workshop booking with four menu destinations
  feedback/                Enquiry form and validation
  trailhead/               Larger site, TypeScript backend and custom hooks
```

## Build and run

Requires Rust 1.88+, Node.js 22+, npm and Google Chrome. From the repository root:

```bash
cd core
cargo build --release --locked --bin testwalker --bin testwalker-core
cd ..
export PATH="$PWD/core/target/release:$PATH"
npm ci
npm run build
cp demos/hello-world/run.json.example demos/hello-world/run.local.json
# Set decision.api_key in the ignored run.local.json to your Jev key.
npx --no-install testwalker-web demo --directory demos/hello-world --headed
```

The Node CLI starts the website, invokes Rust, and stops the website afterward. Rust launches the TypeScript executable adapter, schedules tests, closes the browser, and saves reports. Hello World needs no application-specific test code. Default confidence is **0.80**; default input testing is focused Hegel constraint partitions. Nothing is published.

For Trailhead, including its custom dropdown and backend hooks:

```bash
cp demos/trailhead/run.json.example demos/trailhead/run.local.json
# Set decision.api_key in that file, or use --config with another run.local.json.
npx --no-install testwalker-web demo --directory demos/trailhead \
  --app demos/trailhead/app.ts --hooks demos/trailhead/hooks.ts --headed \
  --generator new_york_street_sweeper --max-steps 1000 \
  --input-mode generated --cases 1 --max-input-attempts 2 \
  --no-shrink --max-calls 4000
```

That selects full graph exploration and two generated property inputs. Use `--input-mode none` for graph only, or omit the input options for focused boundaries. Models describe flows, input constraints and business requirements without UI selectors. Custom application code belongs in explicitly loaded JS/TS hooks.

## Check the framework and adapters

```bash
cd core
cargo test --locked
cargo run --release -- self-test
cd ..
npm run check
npm test
# Optional local Chrome regression checks, without a Jev key:
TESTWALKER_BROWSER_TESTS=1 npm test
```

The Rust self-test runs without Node, a browser or an API key. The web package consumes separately installed executables through JSON-RPC; it never compiles or imports Rust source. GraphWalker and Hegel are linked into Rust and need no separate installation.

See [web configuration and architecture](testwalker-web/README.md), [testing and triage](testwalker-web/docs/testing.md), [demo commands](demos/README.md), [model format](core/docs/model-format.md), [framework CLI](core/docs/cli.md), [OpenRPC](core/openrpc.json), and [discovery](testwalker-discover/README.md).
