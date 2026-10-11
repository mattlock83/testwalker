import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { message, type Rpc } from "./types.js";

/** PlayJev's HTTP transport enters Rust's decision service: no provider key leaves Rust. */
export class DecisionBridge {
  private server?: Server;
  readonly token = randomBytes(32).toString("hex");
  baseUrl = "";
  constructor(private core: Rpc) {}
  async start(): Promise<void> {
    this.server = createServer(async (request, response) => {
      response.setHeader("content-type", "application/json");
      if (
        request.method !== "POST" ||
        request.url !== "/systemone" ||
        request.headers.authorization !== `Bearer ${this.token}`
      ) {
        response
          .writeHead(403)
          .end(JSON.stringify({ error: "Invalid bridge request" }));
        return;
      }
      try {
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024)
            throw new Error("Decision request exceeds 2 MiB");
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString());
        if (
          !body.questions ||
          typeof body.questions !== "object" ||
          Array.isArray(body.questions)
        ) {
          throw new Error("Decision questions must be an object");
        }
        const result = await this.core.request("decision.ask", {
          evidence: body.state,
          questions: body.questions,
        });
        response.end(JSON.stringify(result));
      } catch (error) {
        // Non-retryable error: the caller must not spend more budget retrying an exhausted run.
        response.writeHead(409).end(JSON.stringify({ error: message(error) }));
      }
    });
    this.server.listen(0, "127.0.0.1");
    await once(this.server, "listening");
    const address = this.server.address();
    if (!address || typeof address === "string")
      throw new Error("Cannot start decision bridge");
    this.baseUrl = `http://127.0.0.1:${address.port}`;
  }
  async close(): Promise<void> {
    if (!this.server?.listening) return;
    const closed = once(this.server, "close");
    this.server.close();
    await closed;
  }
}
