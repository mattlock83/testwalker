# Hegel input strategies

The Rust core translates business constraints into test partitions; Hegel generates and shrinks their inputs. JavaScript/TypeScript providers return declarative domains for Hegel to execute.

The default `--input-mode focused --cases 1` checks each selected constraint separately, changing one field while the others stay valid. Required blanks, whitespace, numeric and length neighbours, malformed formats and unlisted choices are covered. Passing duplicates within a phase are not resubmitted. Failures are reproduced and shrunk; uncertain outcomes end the affected phase without being shrunk into defects. With [keep-going](continuation.md), independent phases can continue. If uncertainty interrupts minimization of an already observed defect, that defect remains FAIL.

From the repository root after [setup](../../README.md#build-and-run), with Trailhead's local run configuration prepared:

```bash
# Focused checks, one generated example per partition.
npm run demo --workspace @testwalker/demo-trailhead -- --headed \
  --input-mode focused --cases 1 --max-calls 10000

# Explore more values in those partitions.
npm run demo --workspace @testwalker/demo-trailhead -- --headed \
  --input-mode focused --cases 3 --max-calls 10000
```

Trailhead has 186 focused phases across seven campaigns. That is an upper estimate of exploration inputs, before reproduction and shrinking. `--max-input-attempts` selects scope in model order and also limits those additional attempts. An observed defect remains FAIL if the allowance prevents complete minimization. Singleton domains can execute fewer distinct inputs than `--cases`; this does not make a passing phase inconclusive.

## Configure fields without code

The included policy can be used from the repository root:

```bash
npm run demo --workspace @testwalker/demo-trailhead -- --headed \
  --input-mode focused \
  --input-strategies "$PWD/demos/trailhead/input-strategies.json"
```

Use an absolute policy path with npm workspace commands, since npm runs inside the workspace folder. To create your own policy:

```json
{
  "defaults": { "strategy": "nearby", "radius": 1 },
  "data sets": {
    "Adventure party": {
      "Party size": { "cases": 3, "radius": 5 },
      "Traveller name": { "cases": 3, "alphabet": "abcdefghijklmnopqrstuvwxyz" }
    }
  }
}
```

Names must match the model. File defaults override the CLI case count; field settings override file defaults. JSON policy settings apply to focused mode.

| Setting                | Meaning                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `strategy: "nearby"`   | Generate values inside the selected constraint partition. Default.                                                 |
| `strategy: "boundary"` | Use the exact partition reference through Hegel.                                                                   |
| `cases`                | Requested maximum examples per phase, 1–200.                                                                       |
| `radius`               | Numeric distance beyond a bound, 1–1000; also widens malformed text/whitespace lengths, capped at 2000 characters. |
| `alphabet`             | Letters used for generated text, 1–1000 characters.                                                                |

## Supply a custom domain

A trusted JavaScript/TypeScript module exports sync or async `input_strategy(context, defaultDomain)`. Use `--strategy-provider path/to/inputs.ts`:

```ts
import type { Json } from "@testwalker/web";

export function input_strategy(context: Json, defaultDomain: Json): Json {
  if (
    context.field_name === "Party size" &&
    context.partition === "maximum +1"
  ) {
    const limit = context.field.maximum;
    return { kind: "integer", minimum: limit + 1, maximum: limit + 20 };
  }
  return defaultDomain;
}
```

`context` contains `data_set`, `field_name`, `field`, `fields`, `partition`, `reference`, `options` and `violations`. `default` is `{"kind": "default"}`. Return it to use the built-in native strategy, or return a JSON domain:

| Kind      | Required keys besides `kind`                                                       |
| --------- | ---------------------------------------------------------------------------------- |
| `literal` | `value`: text, finite number or boolean.                                           |
| `choice`  | `values`: 1–200 literal values.                                                    |
| `integer` | `minimum`, `maximum`: ordered integer bounds within ±10,000,000.                   |
| `number`  | `minimum`, `maximum`: ordered finite bounds within ±10,000,000.                    |
| `text`    | `alphabet`, `minimum length`, `maximum length`: nonempty alphabet, lengths 0–2000. |
| `object`  | `fields`: a domain for every modeled field. Only for combined generation.          |

Providers can also customize `generated` or `all`. A combined phase has `field_name: null`; return `default` or an `object` whose field names exactly match the data set. Object fields cannot themselves be `default` or nested objects.

In focused mode, the core filters generated values against the independently calculated violation partition, including during shrinking. Discarded inputs do not reach the target or spend Jev calls. An impossible provider domain is INCONCLUSIVE, not a pass. Invalid domain descriptions are rejected before target initialization. The selected domain descriptions are recorded for triage. Replay uses the saved concrete input without the provider.

`boundaries` executes exact reference values through Hegel. `generated` explores broad per-field and combined domains; `all` adds exact boundary phases; `none` disables separate input campaigns. Strategies never change the model's business rules or expected acceptance/rejection states.
