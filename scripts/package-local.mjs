import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const destination = fileURLToPath(new URL("../.packages/", import.meta.url));
mkdirSync(destination, { recursive: true });
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
for (const name of ["@testwalker/core", "@testwalker/web"]) {
  const result = JSON.parse(
    execFileSync(
      npm,
      [
        "pack",
        "--workspace",
        name,
        "--pack-destination",
        destination,
        "--ignore-scripts",
        "--json",
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    ),
  );
  const paths = result[0].files.map((entry) => entry.path);
  if (
    paths.some((path) =>
      /(^|\/)(src|target|tests|artifact|artifacts)(\/|$)|\.local\.json$/.test(
        path,
      ),
    )
  ) {
    throw new Error(`${name} archive contains development files or local data`);
  }
  if (
    name === "@testwalker/core" &&
    !paths.some((path) => path.startsWith("native/testwalker"))
  ) {
    throw new Error(
      "The core archive must contain the native executables; build it before packing",
    );
  }
  console.log(`${name}: ${destination}${result[0].filename}`);
}
