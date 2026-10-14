import { accessSync, constants, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Resolve a packaged native executable without searching a source checkout. */
function executable(name) {
  const directory = new URL("../native/", import.meta.url);
  let manifest;
  try {
    manifest = JSON.parse(
      readFileSync(new URL("platform.json", directory), "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new Error(
      "@testwalker/core is not built. Run npm run build from the repository root.",
    );
  }
  if (
    manifest.platform !== process.platform ||
    manifest.arch !== process.arch
  ) {
    throw new Error(
      `@testwalker/core was built for ${manifest.platform}/${manifest.arch}; rebuild it for ${process.platform}/${process.arch}.`,
    );
  }
  const path = fileURLToPath(
    new URL(name + (process.platform === "win32" ? ".exe" : ""), directory),
  );
  accessSync(
    path,
    process.platform === "win32" ? constants.F_OK : constants.X_OK,
  );
  return path;
}

export function frameworkPath() {
  return executable("testwalker");
}
export function workerPath() {
  return executable("testwalker-core");
}
