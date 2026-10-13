# Testwalker framework

The Rust framework plans graph walks, generates and shrinks property inputs, schedules lifecycle hooks, evaluates results and writes reports. It runs an adapter executable over JSON-RPC, so the target can be a website, an API or another system.

## Build and test

Requires Rust 1.88 or later. From the repository root:

```bash
cargo build --release --locked --manifest-path core/Cargo.toml \
  --bin testwalker --bin testwalker-core
cargo test --locked --manifest-path core/Cargo.toml
export PATH="$PWD/core/target/release:$PATH"
testwalker self-test
```

The self-test uses [models/rpc-selftest.json](models/rpc-selftest.json) to test a separate worker through JSON-RPC. It uses deterministic assertions and needs no browser, Node.js or API key.

## Executables

| Command                | Purpose                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `testwalker run`       | Launch an executable adapter and execute a model.                                  |
| `testwalker rpc`       | Test an executable JSON-RPC service with declarative request bindings.             |
| `testwalker self-test` | Run the bundled API self-test model.                                               |
| `testwalker-core`      | Start the stdin/stdout JSON-RPC worker for clients that host execution themselves. |

A basic adapter run is:

```bash
testwalker run --model /path/to/model.json \
  --adapter /path/to/adapter --config /path/to/run.json
```

By default, each run writes to `artifact/<timestamped run>/` beside the supplied model. Use `--output DIR` to choose another parent directory. The bundled self-test writes to `artifact/` in the current working directory.

The adapter implements target operations and returns evidence. The framework owns the test inventory, verdicts, coverage, JUnit, HTML reports and replay files.

## Reference

- [CLI and run configuration](docs/cli.md)
- [Architecture and execution lifecycle](docs/architecture.md)
- [Business model format](docs/model-format.md)
- [Hegel input strategies](docs/input-strategies.md)
- [Adapter protocol](docs/protocol.md)
- [JSON-RPC testing and self-tests](docs/rpc-testing.md)
- [Worker OpenRPC](openrpc.json) and [adapter OpenRPC](openrpc.adapter.json)

For browser tests, start with the [web adapter](../testwalker-web/README.md) or the [local demos](../demos/README.md).
