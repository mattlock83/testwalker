# Local packages

The repository has two private npm packages. Demos declare them as dependencies and import their public APIs through `node_modules`. npm workspaces link the Testwalker packages locally. Discovery is provided by [web-discover](https://github.com/mattlock83/web-discover), a separate repository installed as a Git dependency for the demos.

| Package                | Contents                                                                   | Public entry points                                                                               |
| ---------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `@testwalker/core`     | Compiled Rust CLI and JSON-RPC worker for the build machine.               | `frameworkPath()`, `workerPath()`; `testwalker` and `testwalker-core` commands.                   |
| `@testwalker/web`      | Playwright/Jev adapter and browser helpers. Depends on `@testwalker/core`. | `@testwalker/web`, `@testwalker/web/cli`; `testwalker-web` and `testwalker-web-adapter` commands. |

## Build and use in this repository

Requires Rust 1.88 or later, Node.js 22 or later and npm. Browser execution also needs Chrome; web tests use a Jev key in the demo's ignored `run.local.json`.

```bash
npm ci
npm run build
./demos/hello-world/test.sh --headed
```

Prepare the key file using [the first-run guide](../README.md#build-and-run) before testing. `npm run build` first builds the two release Rust executables and copies them into `core/native/`, then builds the TypeScript packages. Generated binaries are ignored by Git. Demos never import another package's `src/` or `dist/` path and never reach into Cargo's `target/` directory. No PATH setup is required.

`npm ci` installs and builds the pinned web-discover dependency. Discovery alone requires neither Rust nor a decision key. Local demo hosting needs the web package's build:

```bash
npm run build --workspace @testwalker/web
./demos/hello-world/discover.sh --headed
```

To rebuild only the native payload, use `npm run build --workspace @testwalker/core`. A direct `cargo build` still works for Rust development, but does not refresh the Node package's copied binaries.

## Import public modules

A demo hook imports its SDK by package name:

```javascript
import { Defect } from "@testwalker/web";

export function after_state(context) {
  if (context.scratch.unexpectedRefund) {
    throw new Defect("The booking was refunded twice.");
  }
}
```

An executable launcher can use `main` from `@testwalker/web/cli` or `web-discover/cli`. It passes an argument array and receives an exit code. Importing the CLI does not start a run. Native integrations can import `frameworkPath()` or `workerPath()` from `@testwalker/core` and launch those binaries over the existing JSON-RPC protocol.

## Create local archives

```bash
npm run package:local
```

This builds the packages, then runs `npm pack` for each. It writes:

```text
.packages/
  testwalker-core-4.0.0.tgz
  testwalker-web-4.0.0.tgz
```

The archives contain runtime code, declarations and documentation; the core archive also contains its two native executables. Source trees, Cargo build directories, demo sites, credentials and reports are excluded. Both Testwalker package manifests use `private: true`, and the Cargo package has `publish = false`. Packaging does not publish or build on installation. web-discover is distributed separately from [its repository](https://github.com/mattlock83/web-discover).

Core archives are specific to the operating system and CPU architecture where they were built. Build again on the destination platform instead of reusing an incompatible archive; the package checks for a mismatch before execution. The archive command replaces its previous archives with newly built versions.

## Install into another local project

Supply both core and web archives together so npm resolves the web package's core dependency locally:

```bash
npm install /absolute/path/to/testwalker/.packages/testwalker-core-4.0.0.tgz \
  /absolute/path/to/testwalker/.packages/testwalker-web-4.0.0.tgz
```

This installs the local Testwalker archives and their normal npm dependencies. Rust and the original checkout are not needed to run a compatible core archive. Chrome and a Jev key are still required for web execution. To use discovery independently, follow [web-discover's installation guide](https://github.com/mattlock83/web-discover#setup-and-first-run). npm scripts expose the installed CLI commands, and application code imports the same package names as the demos.

## Verify package isolation

After creating archives, run:

```bash
npm run test:packages
```

This installs them into a temporary project with no workspace links, uses an empty PATH for execution, and verifies public module imports, CLI help, model planning, worker RPC and the native self-test. Its installation uses npm's offline cache; run `npm ci` in this repository first to populate normal dependency downloads. The temporary project is removed afterward.
