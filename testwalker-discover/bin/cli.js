#!/usr/bin/env node
import { main } from "../dist/cli.js";

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
