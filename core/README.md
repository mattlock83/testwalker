# Testwalker Rust framework

This folder is the complete Rust project: source, CLI, tests, report assets, OpenRPC specifications, documentation and the model used to test itself. No Node.js, browser or website source is required to build it.

Run from this folder:

```bash
cargo build --release --locked --bin testwalker --bin testwalker-core
cargo test --locked
cargo run --release -- self-test
```

`models/rpc-selftest.json` drives a separate Rust worker through its JSON-RPC API, with GraphWalker exploration, Hegel input testing, deterministic assertions and framework reports. It needs no Jev key.

To use an executable target adapter:

```bash
target/release/testwalker run --model /path/to/model.json \
  --adapter /path/to/adapter --config /path/to/run.json
```

The adapter can be written in any language. See [CLI configuration](docs/cli.md), [architecture](docs/architecture.md), [protocol](docs/protocol.md), [API self-tests](docs/rpc-testing.md) and [business models](docs/model-format.md).
