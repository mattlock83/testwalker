import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";
import { Inconclusive, message, type Json, type Rpc } from "./types.js";

export const MAX_MESSAGE = 64 * 1024 * 1024;
export type Handler = (method: string, params: Json) => Promise<any>;

/** Dispatch responses immediately while serializing callbacks, allowing nested RPC calls. */
export class JsonRpcPeer extends EventEmitter implements Rpc {
  private sequence = 0;
  private buffered = Buffer.alloc(0);
  private queue: Promise<void> = Promise.resolve();
  private pending = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private ended = false;
  readonly done: Promise<void>;
  constructor(
    readonly input: Readable,
    readonly output: Writable,
    private handler?: Handler,
    readonly timeoutMs = 120_000,
  ) {
    super();
    this.done = new Promise((resolve) => this.once("closed", resolve));
    input.on("data", (chunk) => this.read(Buffer.from(chunk)));
    input.on("error", (error) => this.abort(error));
    output.on("error", (error) => this.abort(error));
    input.on("end", () => {
      if (this.buffered.length)
        this.abort(new Inconclusive("Incomplete JSON-RPC message at EOF"));
      else this.abort(new Inconclusive("Framework connection closed"));
    });
  }
  setHandler(handler: Handler): void {
    this.handler = handler;
  }
  private send(envelope: Json): void {
    if (this.ended) throw new Inconclusive("Framework connection closed");
    const encoded = JSON.stringify(envelope) + "\n";
    if (Buffer.byteLength(encoded) > MAX_MESSAGE)
      throw new Inconclusive("JSON-RPC message exceeds 64 MiB");
    this.output.write(encoded);
  }
  request(method: string, params: Json = {}): Promise<any> {
    const id = `web/${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Inconclusive(`Framework request timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  private read(chunk: Buffer): void {
    this.buffered = Buffer.concat([this.buffered, chunk]);
    let end: number;
    while ((end = this.buffered.indexOf(10)) !== -1) {
      const line = this.buffered.subarray(0, end);
      this.buffered = this.buffered.subarray(end + 1);
      if (line.length + 1 > MAX_MESSAGE) {
        this.abort(new Inconclusive("JSON-RPC message exceeds 64 MiB"));
        return;
      }
      try {
        this.accept(JSON.parse(line.toString("utf8")));
      } catch (error) {
        this.abort(
          new Inconclusive(`Invalid JSON-RPC message: ${message(error)}`),
        );
        return;
      }
    }
    if (this.buffered.length >= MAX_MESSAGE)
      this.abort(new Inconclusive("JSON-RPC message exceeds 64 MiB"));
  }
  private accept(envelope: Json): void {
    if (!envelope || Array.isArray(envelope) || envelope.jsonrpc !== "2.0") {
      throw new Inconclusive("Invalid JSON-RPC envelope");
    }
    if (!("method" in envelope)) {
      const waiting = this.pending.get(envelope.id);
      if (!waiting) throw new Inconclusive("Unmatched JSON-RPC response");
      this.pending.delete(envelope.id);
      clearTimeout(waiting.timer);
      if (envelope.error)
        waiting.reject(
          new Inconclusive(
            envelope.error.message,
            envelope.error.data?.result ?? {},
          ),
        );
      else if ("result" in envelope) waiting.resolve(envelope.result);
      else waiting.reject(new Inconclusive("JSON-RPC response has no result"));
      return;
    }
    if (
      typeof envelope.method !== "string" ||
      !envelope.params ||
      Array.isArray(envelope.params) ||
      typeof envelope.params !== "object"
    )
      throw new Inconclusive("Invalid callback parameters");
    this.queue = this.queue
      .then(async () => {
        try {
          if (!this.handler)
            throw new Inconclusive(`Unsupported callback: ${envelope.method}`);
          const result = await this.handler(envelope.method, envelope.params);
          if ("id" in envelope)
            this.send({
              jsonrpc: "2.0",
              id: envelope.id,
              result: result ?? {},
            });
        } catch (error) {
          if ("id" in envelope && !this.ended)
            this.send({
              jsonrpc: "2.0",
              id: envelope.id,
              error: {
                code: -32001,
                message: message(error),
                data: {
                  status:
                    error instanceof Inconclusive
                      ? error.status
                      : "INCONCLUSIVE",
                  message: message(error),
                  result: error instanceof Inconclusive ? error.result : {},
                },
              },
            });
        }
      })
      .catch((error) => this.abort(error));
  }
  abort(error: Error): void {
    if (this.ended) return;
    this.ended = true;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
    this.emit("closed");
  }
}

/** Independent worker client for discovery, planning and tests; never finds source or runs Cargo. */
export class CoreClient implements Rpc {
  readonly child: ChildProcessWithoutNullStreams;
  readonly peer: JsonRpcPeer;
  constructor(
    executable = process.env.TESTWALKER_CORE_BIN ?? "testwalker-core",
    handler?: Handler,
  ) {
    this.child = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"] });
    this.peer = new JsonRpcPeer(this.child.stdout, this.child.stdin, handler);
    this.child.on("error", (error) => this.peer.abort(error));
    this.child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  }
  request(method: string, params: Json = {}): Promise<any> {
    return this.peer.request(method, params);
  }
  async close(): Promise<void> {
    if (this.child.exitCode !== null) return;
    try {
      await this.request("core.shutdown");
    } finally {
      this.child.stdin.end();
    }
  }
}
