#!/usr/bin/env node
import { Console } from "node:console";
import { parseArgs } from "node:util";
import { WebAdapter } from "./adapter.js";
import { JsonRpcPeer } from "./rpc.js";

// Trusted hooks and dependency diagnostics cannot corrupt the protocol stream.
const protocolOutput = process.stdout;
globalThis.console = new Console(process.stderr, process.stderr);
const { values } = parseArgs({
  options: {
    config: { type: "string" },
    hooks: { type: "string" },
    "strategy-provider": { type: "string" },
    headed: { type: "boolean" },
    "cdp-url": { type: "string" },
    debug: { type: "boolean" },
  },
});
const peer = new JsonRpcPeer(process.stdin, protocolOutput);
const adapter = new WebAdapter(peer, {
  config: values.config,
  hooks: values.hooks,
  strategyProvider: values["strategy-provider"],
  headed: values.headed,
  cdpUrl: values["cdp-url"],
});
const interrupt = () => {
  peer.abort(new Error("Adapter interrupted"));
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
try {
  const ready = adapter.load();
  peer.setHandler(async (method, params) => {
    await ready;
    try {
      return await adapter.call(method, params);
    } catch (error) {
      if (values.debug) console.error(`Callback failed: ${method}`, error);
      throw error;
    }
  });
  await ready;
  await peer.done;
} catch (error) {
  console.error(error);
  process.exitCode = 2;
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  await adapter.close();
}
