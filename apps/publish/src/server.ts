import "dotenv/config";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { publicSiteRequest } from "../../../packages/shared/src/site-http";
import { pool, query } from "../../../packages/shared/src/db";
import { pendingDatabaseMigrations } from "../../../packages/shared/src/schema-readiness";
const host = process.env.PUBLISH_HOST || "127.0.0.1";
const server = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.url === "/health") {
        if ((await pendingDatabaseMigrations()).length) {
          res.writeHead(503, {
            "content-type": "application/json",
            "cache-control": "no-store",
          });
          res.end(
            '{"status":"unavailable","reason":"database_upgrade_required"}',
          );
          return;
        }
        await query("SELECT 1");
        res.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        res.end('{"status":"ok","service":"publish"}');
        return;
      }
      if (!["GET", "HEAD", "POST"].includes(req.method ?? "")) {
        res.writeHead(405);
        res.end();
        return;
      }
      const url = new URL(
          req.url ?? "/",
          `http://${req.headers.host || "localhost"}`,
        ),
        headers = new Headers();
      for (const key of [
        "range",
        "if-none-match",
        "origin",
        "content-type",
        "content-length",
        "user-agent",
        "dnt",
        "sec-gpc",
      ])
        if (typeof req.headers[key] === "string")
          headers.set(key, req.headers[key]);
      let body: Buffer | undefined;
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 4096) {
            res.writeHead(413);
            res.end();
            return;
          }
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks);
      }
      const response = await publicSiteRequest(
        new Request(url, {
          method: req.method,
          headers,
          body: body ? new Uint8Array(body) : undefined,
        }),
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body)
        await pipeline(
          Readable.fromWeb(
            response.body as import("node:stream/web").ReadableStream,
          ),
          res,
        );
      else res.end();
    } catch {
      if (!res.headersSent) res.writeHead(503, { "cache-control": "no-store" });
      res.end("Publication temporarily unavailable.");
    }
  },
);
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(Number(process.env.PUBLISH_PORT || 3001), host, () =>
  console.log("Axiom publication server ready."),
);
// Separate internal listener: never proxy this port to the public internet.
const control = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://internal"),
      domain = url.searchParams.get("domain");
    const allowed =
      domain &&
      /^[a-z0-9.-]{1,253}$/.test(domain) &&
      (await query(
        "SELECT 1 FROM site_domains d JOIN workspace_sites s ON s.id=d.site_id WHERE d.hostname=$1 AND d.status='verified' AND s.enabled AND axiom_space_state(s.space_id) IN ('active','archived')",
        [domain],
      ));
    res.writeHead(
      req.method === "GET" &&
        url.pathname === "/tls" &&
        allowed &&
        allowed.length
        ? 200
        : 403,
    );
    res.end();
  } catch {
    res.writeHead(403);
    res.end();
  }
});
control.listen(Number(process.env.PUBLISH_CONTROL_PORT || 3002), host);
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    const timeout = setTimeout(() => process.exit(1), 15000).unref();
    void Promise.all(
      [server, control].map(
        (listener) => new Promise<void>((done) => listener.close(() => done())),
      ),
    )
      .then(() => pool.end())
      .finally(() => clearTimeout(timeout));
  });
