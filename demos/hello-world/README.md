# Hello World

The smallest example: **Home** and **Greeting** navigation, one **Name** input, four business states and eight journeys. Names must contain 2–30 characters after trimming spaces.

`site/` is the plain HTML application; `model.json` is its selector-free GraphWalker business specification. There is no custom runtime test code or hook. The shared TypeScript adapter executes the model through Rust, with focused Hegel input checks by default. Regression checks stay beside the site in [tests/](tests/).

## Run

After [building Rust and Node](../../README.md#build-and-run), run from the repository root:

```bash
cp demos/hello-world/run.json.example demos/hello-world/run.local.json
# Set decision.api_key in run.local.json to your Jev key.
npx --no-install testwalker-web demo --directory demos/hello-world --port 4185 --headed
# Full graph, just two selected property inputs:
npm run demo --workspace @testwalker/demo-hello-world -- --headed --max-input-attempts 2 --no-shrink
# Plan without a key or browser:
npx --no-install testwalker-web plan --model demos/hello-world/model.json --config demos/hello-world/run.json.example
```

The owned browser and website close afterward. Reports go to `demos/artifacts/hello-world/`. Native provider settings are in ignored `run.local.json`; optional Playwright settings are in `browser.json`. Confidence defaults to **0.80**. Use `--input-mode none` for graph only, `--max-calls` for Jev allowance, and `--threshold` to change confidence. See [testing and triage](../../testwalker-web/docs/testing.md).

Preview without Jev:

```bash
npx --no-install testwalker-web serve --directory demos/hello-world/site --port 4185
```

Regression checks use the public `@testwalker/web` package and installed Rust executable, without a Jev key:

```bash
export PATH="$PWD/core/target/release:$PATH"
npm test --workspace @testwalker/demo-hello-world
```

Prefix with `TESTWALKER_BROWSER_TESTS=1` to include real Chrome form and navigation checks.

The migrated adapter was verified with the default live Jev run at 0.80 confidence: all eight edges and ten focused input attempts passed, using 100 decision calls.
