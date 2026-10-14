#!/usr/bin/env node
// Demo hosting only. The standalone discovery CLI owns crawling and output.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@testwalker/web";

const [directory, ...args] = process.argv.slice(2);
const signals = { SIGINT: 130, SIGTERM: 143 };
let server, child, stopped;
const stop = (signal) => {
  stopped = signal;
  child?.kill(signal);
};
const interrupt = () => stop("SIGINT");
const terminate = () => stop("SIGTERM");

try {
  if (!directory) throw new Error("Supply a demo directory");
  const demo = resolve(directory),
    hosting = {},
    forwarded = [];
  // Consume hosting options; leave discovery options and literal values intact.
  for (let index = 0; index < args.length; index++) {
    const [flag, ...assigned] = args[index].split("=");
    if (!["--port", "--app", "--url"].includes(flag)) {
      forwarded.push(args[index]);
      continue;
    }
    const value = assigned.length ? assigned.join("=") : args[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`${flag} needs a value`);
    hosting[flag.slice(2)] = value;
  }
  const help = forwarded.some((arg) => ["--help", "-h"].includes(arg));
  if (!help) {
    const port = Number(hosting.port ?? 0);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error("--port must be 0–65535");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    if (!hosting.url) {
      server = await serve(join(demo, "site"), port, hosting.app);
      hosting.url = server.url + "/";
      console.log(`Website: ${hosting.url}`);
    }
    if (
      !forwarded.some(
        (arg) => arg === "--output" || arg.startsWith("--output="),
      )
    ) {
      const timestamp = new Date().toISOString().replaceAll(":", "-");
      forwarded.push(
        "--output",
        join(demo, `discovered-${timestamp}-${process.pid}.model.json`),
      );
    }
  }
  if (stopped) {
    process.exitCode = signals[stopped];
  } else {
    child = spawn(
      process.execPath,
      [
        process.env.TESTWALKER_DISCOVER_CLI ??
          fileURLToPath(new URL("./discover-cli.mjs", import.meta.url)),
        "discover-url",
        ...(help ? [] : ["--url", hosting.url]),
        ...forwarded,
      ],
      { stdio: "inherit" },
    );
    const [code, signal] = await once(child, "exit");
    process.exitCode = code ?? signals[signal] ?? 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", terminate);
  await server?.close();
}
