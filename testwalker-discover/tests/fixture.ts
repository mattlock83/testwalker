import { createServer, type Server } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, extname, sep } from "node:path";
import { once } from "node:events";

/** Local discovery fixtures need no web adapter or framework process. */
export async function serve(directory: string): Promise<{
  url: string;
  server: Server;
  close(): Promise<void>;
}> {
  const root = await realpath(directory);
  const server = createServer(async (request, response) => {
    try {
      if (!["GET", "HEAD"].includes(request.method ?? "")) {
        response.writeHead(405).end();
        return;
      }
      const url = new URL(request.url ?? "/", "http://localhost");
      const pathname = decodeURIComponent(url.pathname);
      const path = await realpath(
        resolve(
          root,
          "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname),
        ),
      );
      const rel = relative(root, path);
      if (rel === ".." || rel.startsWith(".." + sep) || rel.startsWith(sep)) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(path);
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript",
        ".json": "application/json",
        ".css": "text/css",
      };
      response.writeHead(200, {
        "content-type": mime[extname(path)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      if (!response.headersSent) response.writeHead(404).end("Not found");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Cannot start fixture");
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
