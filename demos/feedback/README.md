# Feedback

A studio enquiry site with **three states and four journeys**: compose a message, reject incomplete details, acknowledge acceptance and start again. Hegel exercises required subject/message inputs and length limits.

`site/` is the plain HTML application; `model.json` is its selector-free GraphWalker business specification. There is no custom runtime test code or hook. The shared TypeScript adapter executes the model through Rust, with focused Hegel input checks by default. Regression checks stay beside the site in [tests/](tests/).

## Run

After [building Rust and Node](../../README.md#build-and-run), run from the repository root:

```bash
cp demos/feedback/run.json.example demos/feedback/run.local.json
# Set decision.api_key in run.local.json to your Jev key.
npx --no-install testwalker-web demo --directory demos/feedback --port 4186 --headed
# Full graph, just two selected property inputs:
npm run demo --workspace @testwalker/demo-feedback -- --headed --max-input-attempts 2 --no-shrink
# Plan without a key or browser:
npx --no-install testwalker-web plan --model demos/feedback/model.json --config demos/feedback/run.json.example
```

The owned browser and website close afterward. Reports go to `demos/artifacts/feedback/`. Native provider settings are in ignored `run.local.json`; optional Playwright settings are in `browser.json`. Confidence defaults to **0.80**. Use `--input-mode none` for graph only, `--max-calls` for Jev allowance, and `--threshold` to change confidence. See [testing and triage](../../testwalker-web/docs/testing.md).

Preview without Jev:

```bash
npx --no-install testwalker-web serve --directory demos/feedback/site --port 4186
```

Regression checks use the public `@testwalker/web` package and installed Rust executable, without a Jev key:

```bash
export PATH="$PWD/core/target/release:$PATH"
npm test --workspace @testwalker/demo-feedback
```
