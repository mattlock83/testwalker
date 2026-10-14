// Demo hosting only; consume the installed web package's public CLI.
import { main } from "@testwalker/web/cli";

try {
  const [directory, ...args] = process.argv.slice(2);
  if (!directory) throw new Error("Supply a demo directory");
  process.exitCode = await main(["demo", "--directory", directory, ...args]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
