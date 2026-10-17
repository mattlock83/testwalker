# JavaScript and TypeScript lifecycle hooks

Most models need no application code. Explicitly load an extension only for custom controls, fixture setup, or deterministic checks:

```bash
npx --no-install testwalker-web run --model model.json --url http://localhost:3000 \
  --config run.local.json --hooks hooks.ts --headed
```

Exports may be synchronous or async. Rust schedules them over `target.hook`; the adapter awaits completion. The model cannot name imports or contain executable hooks.

| Pair                                     | When                                                 |
| ---------------------------------------- | ---------------------------------------------------- |
| `before_run` / `after_run`               | Around the whole run.                                |
| `before_walk` / `after_walk`             | Around each seeded graph walk.                       |
| `before_reset` / `after_reset`           | Every reset, including property setup and shrinking. |
| `before_transition` / `after_transition` | Around an edge operation, including setup edges.     |
| `before_state` / `after_state`           | Around an independently checked destination.         |
| `before_case` / `after_case`             | Around each complete property input attempt.         |

`HookContext` provides `model`, `states`, `edges`, `element`, `element_id`, `phase` (`graph`, `setup`, `property`), `walk`, `url`, `page` (Playwright Page), `core` (nested JSON-RPC client), `data`, `invalid`, `result`, `error`, `report`, `scratch`, and `check(condition, description)`. `scratch` persists across this run's hook calls. Data/result/report objects are snapshots; changing them cannot replace inputs or grant coverage. Check `ctx.result?.status === 'PASS'` before a backend assertion that assumes a successful UI checkpoint.

```ts
import type { HookContext } from "@testwalker/web";

export async function before_reset(ctx: HookContext) {
  const response = await fetch(new URL("/test/reset", ctx.url), {
    method: "POST",
    signal: AbortSignal.timeout(5000),
  });
  ctx.check(response.ok, "Fixture reset succeeds");
}

export async function after_state(ctx: HookContext) {
  if (ctx.element_id !== "confirmed" || ctx.result?.status !== "PASS") return;
  const response = await fetch(new URL("/test/bookings", ctx.url), {
    signal: AbortSignal.timeout(5000),
  });
  const bookings = await response.json();
  ctx.check(bookings.length === 1, "Confirmation creates exactly one booking");
}
```

Replace those fixture endpoints with your application's APIs. `ctx.check`, `Defect`, and Node assertion failures mean FAIL. Other exceptions mean INCONCLUSIVE. A failure during property setup makes that candidate inconclusive because its source state was not established. Teardown errors are recorded without erasing the original defect. Hooks have the process's permissions and the framework callback deadline; bound external calls yourself.

The browser context starts fresh for each property attempt, then the framework replays its modeled setup route. Backend data requires a reset hook. Grouped graph journeys share state. Replaying a case uses its own reset/setup, and requires explicitly supplying the same extensions.

[Trailhead's hooks](../../demos/trailhead/hooks.ts) demonstrate an actual custom shadow-DOM picker, backend resets, review side-effect checks, inventory and refund assertions. All application selectors stay in that hook. The framework still independently verifies the destination afterward. Reports record hook events and the loaded file's path/SHA-256.

When using `page.evaluate` in a `.ts` hook, avoid sending functions containing transpiler-generated helpers to the browser. Use Playwright locators, or a self-contained JavaScript expression with safely serialized literal arguments; Trailhead illustrates the latter.

Custom Hegel domains are separate exports named `input_strategy(context, defaultDomain)`, also sync or async. See [input strategies](../../core/docs/input-strategies.md). The independent web-discover tool has its own hooks, documented in [discovery configuration](https://github.com/mattlock83/web-discover/blob/main/docs/discovery.md#values-and-hooks).
