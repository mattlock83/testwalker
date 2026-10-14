import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const core = fileURLToPath(new URL("..", import.meta.url));
// Pin the output location so Cargo configuration/environment cannot silently redirect it.
const target = join(core, "target");
execFileSync(
  "cargo",
  [
    "build",
    "--release",
    "--locked",
    "--manifest-path",
    join(core, "Cargo.toml"),
    "--target-dir",
    target,
    "--bin",
    "testwalker",
    "--bin",
    "testwalker-core",
  ],
  { stdio: "inherit" },
);
const staging = join(core, `.native-${process.pid}`);
try {
  mkdirSync(staging);
  for (const name of ["testwalker", "testwalker-core"]) {
    const filename = name + (process.platform === "win32" ? ".exe" : "");
    const output = join(staging, filename);
    copyFileSync(join(target, "release", filename), output);
    chmodSync(output, 0o755);
  }
  writeFileSync(
    join(staging, "platform.json"),
    JSON.stringify({ platform: process.platform, arch: process.arch }) + "\n",
  );
  rmSync(join(core, "native"), { recursive: true, force: true });
  renameSync(staging, join(core, "native"));
} finally {
  rmSync(staging, { recursive: true, force: true });
}
