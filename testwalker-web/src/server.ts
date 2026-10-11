import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, extname, sep } from "node:path";
import { once } from "node:events";
import { loadExtension } from "./extensions.js";

export type AppHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<boolean> | boolean;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".xml": "application/xml",
};
export function staticServer(directory: string, handler?: AppHandler): Server {
  const root = resolve(directory);
  return createServer(async (request, response) => {
    try {
      if (handler && (await handler(request, response))) return;
      if (!["GET", "HEAD"].includes(request.method ?? "")) {
        response.writeHead(405).end();
        return;
      }
      const url = new URL(request.url ?? "/", "http://localhost");
      const pathname = decodeURIComponent(url.pathname);
      const candidate = resolve(
        root,
        "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname),
      );
      const actual = await realpath(candidate);
      const rel = relative(await realpath(root), actual);
      if (rel === ".." || rel.startsWith(".." + sep) || rel.startsWith(sep)) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(actual);
      response.writeHead(200, {
        "content-type": MIME[extname(actual)] ?? "application/octet-stream",
        "content-length": body.length,
        "cache-control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      if (!response.headersSent) response.writeHead(404).end("Not found");
    }
  });
}
export async function serve(
  directory: string,
  port = 0,
  app?: string,
): Promise<{ url: string; server: Server; close(): Promise<void> }> {
  const server = app
    ? await (await loadExtension(app)).module.create_server(resolve(directory))
    : staticServer(directory);
  if (!server || typeof server.listen !== "function")
    throw new Error("Application must export create_server(directory)");
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Cannot start website server");
  return {
    url: `http://127.0.0.1:${address.port}`,
    server,
    async close() {
      if (!server.listening) return;
      const ended = once(server, "close");
      server.close();
      server.closeIdleConnections();
      await ended;
    },
  };
}
