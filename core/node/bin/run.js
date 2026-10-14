import { spawn } from "node:child_process";

/** Preserve stdio, signals and native exit codes through npm's executable entry points. */
export function run(resolveExecutable) {
  try {
    const child = spawn(resolveExecutable(), process.argv.slice(2), {
      stdio: "inherit",
    });
    const interrupt = () => child.kill("SIGINT");
    const terminate = () => child.kill("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    const cleanup = () => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    };
    child.once("error", (error) => {
      cleanup();
      console.error(error.message);
      process.exitCode = 2;
    });
    child.once("exit", (code, signal) => {
      cleanup();
      if (signal) process.kill(process.pid, signal);
      else process.exitCode = code ?? 2;
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
