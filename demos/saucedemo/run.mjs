import { main } from "@testwalker/web/cli";
import { fileURLToPath } from "node:url";

try {
  process.exitCode = await main([
    "run",
    "--directory",
    fileURLToPath(new URL(".", import.meta.url)),
    "--url",
    "https://www.saucedemo.com/",
    "--input-mode",
    "none",
    "--max-steps",
    "10000",
    "--max-calls",
    "4000",
    ...process.argv.slice(2),
  ]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
