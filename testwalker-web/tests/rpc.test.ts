import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { JsonRpcPeer } from "../src/rpc.js";
import { Defect } from "../src/types.js";

test("Nested service responses are processed while an asynchronous callback runs", async () => {
  const fromCore = new PassThrough(),
    toCore = new PassThrough();
  const written: any[] = [];
  toCore.on("data", (chunk) => {
    const envelope = JSON.parse(chunk.toString());
    written.push(envelope);
    if (envelope.method === "decision.ask")
      fromCore.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: envelope.id,
          result: { answers: { state: "observed" } },
        }) + "\n",
      );
  });
  const peer = new JsonRpcPeer(fromCore, toCore);
  peer.setHandler(
    async () =>
      await peer.request("decision.ask", {
        evidence: { synthetic: true },
        questions: {},
      }),
  );
  fromCore.write(
    '{"jsonrpc":"2.0","id":17,"method":"target.evaluate","params":{}}\n',
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(written.at(-1), {
    jsonrpc: "2.0",
    id: 17,
    result: { answers: { state: "observed" } },
  });
  fromCore.end();
  await peer.done;
});
test("Definite hook defects retain structured FAIL evidence; notifications have no response", async () => {
  const input = new PassThrough(),
    output = new PassThrough();
  const written: any[] = [];
  output.on("data", (chunk) => written.push(JSON.parse(chunk.toString())));
  const peer = new JsonRpcPeer(input, output, async () => {
    throw new Defect("Wrong refund", { refunds: 2 });
  });
  input.write(
    '{"jsonrpc":"2.0","id":"hook","method":"target.hook","params":{}}\n',
  );
  input.write('{"jsonrpc":"2.0","method":"target.hook","params":{}}\n');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(written.length, 1);
  assert.equal(written[0].error.data.status, "FAIL");
  assert.deepEqual(written[0].error.data.result, { refunds: 2 });
  input.end();
  await peer.done;
});
test("Timeout and EOF reject pending calls rather than hanging", async () => {
  const input = new PassThrough(),
    output = new PassThrough();
  const peer = new JsonRpcPeer(input, output, undefined, 5);
  await assert.rejects(peer.request("core.info"), /timed out/);
  const pending = assert.rejects(peer.request("core.info"), /closed/);
  input.end();
  await pending;
});
test("Split UTF-8 envelopes preserve text and IDs", async () => {
  const input = new PassThrough(),
    output = new PassThrough();
  let observed: any;
  output.on("data", (chunk) => (observed = JSON.parse(chunk.toString())));
  const peer = new JsonRpcPeer(
    input,
    output,
    async (_method, params) => params,
  );
  const envelope = Buffer.from(
    '{"jsonrpc":"2.0","id":0,"method":"target.hook","params":{"text":"😀"}}\n',
  );
  for (const byte of envelope) input.write(Buffer.from([byte]));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(observed.result.text, "😀");
  assert.equal(observed.id, 0);
  input.end();
  await peer.done;
});
