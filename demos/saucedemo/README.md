# Sauce Demo draft

This folder contains a discovery-generated [model](model.json) of the external [Sauce Demo](https://www.saucedemo.com/) site. It has 63 observed states and 135 journeys, including fixed login and checkout examples.

**This is a draft, not a complete runnable regression model.** Forty-four states have no outgoing edge, preventing a continuous full traversal. Saved route batches got through some journeys but stopped on ambiguous UI decisions. No website defect was established. The measured results are recorded in [the verification inventory](../verification.json).

There are no independently authored data sets or Hegel campaigns. `--input-mode none` skips additional property testing while fixed graph form inputs still execute.

## Shell scripts

After [repository setup](../../README.md#build-and-run), run from the repository root:

```bash
./demos/saucedemo/test.sh --headed
./demos/saucedemo/discover.sh --headed
```

Testing uses the existing model and `run.local.json` with your Jev key. Discovery needs no key and writes a new timestamped draft beside the existing model, with its viewer and captures under `artifact/`. Both scripts accept extra CLI options. Both scripts use the hosted demo site; discovery loads the synthetic values in `discovery/values.json`. The existing draft still needs review before full test execution. See [the script guide](../README.md#shell-scripts) for overrides.

## Inspect and review

After [setup](../../README.md#build-and-run), inspect the draft without a key or browser:

```bash
npx --no-install testwalker-web plan \
  --model demos/saucedemo/model.json --max-steps 10000
```

The current draft reports a planning error because of its terminal states. Before expecting full execution, review the model in GraphWalker: resolve terminal paths, distinguish ambiguous states/actions and add independent expected rules. Discovery observations alone are not expected business behavior.

For individually reset route testing, the framework also accepts reviewed `options.paths`. Imported route counts must match `walks`, with at most 100 walks per run. See [the CLI reference](../../core/docs/cli.md#graph-walk-modes). Locally recorded batch configurations and report bundles are ignored files and are not required setup assets in a fresh checkout.

## Run a reviewed model

Create a run configuration and set its Jev key. An existing example can be copied as a starting point:

```bash
cp demos/saucedemo/run.json.example demos/saucedemo/run.local.json
```

Edit `decision.api_key`, then run:

```bash
npx --no-install testwalker-web run \
  --model demos/saucedemo/model.json --url https://www.saucedemo.com/ \
  --config demos/saucedemo/run.local.json \
  --browser-config demos/saucedemo/browser.json --headed \
  --input-mode none --max-steps 10000 --max-calls 4000
```

Use the reviewed model's path if saved separately. The original checked-in draft still has the limitations above. The command uses the existing external site; it does not host a local server or perform discovery.

For collection commands and synthetic field values, see [Sauce Demo discovery](discovery/README.md). For a complete local example, use [Controls](../controls/README.md) or [Trailhead](../trailhead/README.md).
