import { pool, query } from "./db";
import type pg from "pg";

type Subscriber = { refresh: (access: boolean) => void; close: () => void };
type Hub = {
  subscribers: Set<Subscriber>;
  connection?: Promise<pg.PoolClient>;
};
const processState = globalThis as typeof globalThis & { axiomEventHub?: Hub };
const hub = (processState.axiomEventHub ??= { subscribers: new Set() });
async function listen() {
  if (!hub.connection)
    hub.connection = (async () => {
      const client = await pool.connect();
      try {
        await client.query("LISTEN axiom_refresh");
        await client.query("LISTEN axiom_access");
      } catch (error) {
        client.release();
        throw error;
      }
      client.on("notification", (message) => {
        for (const subscriber of hub.subscribers)
          subscriber.refresh(message.channel === "axiom_access");
      });
      client.on("error", () => {
        hub.connection = undefined;
        for (const subscriber of [...hub.subscribers]) subscriber.close();
        client.release(true);
      });
      return client;
    })().catch((error) => {
      hub.connection = undefined;
      throw error;
    });
  return hub.connection;
}
/** A single DB listener fans out identity-free invalidations. Every actual read
 * is separately authorized; revoked sessions are closed on the next heartbeat. */
export async function workspaceEvents(
  request: Request,
  identity: { userId: string; sessionId: string },
) {
  await listen();
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false,
        debounce: ReturnType<typeof setTimeout> | undefined,
        accessChanged = false;
      const write = (value: string) => {
        if (!closed)
          try {
            controller.enqueue(encoder.encode(value));
          } catch {
            cleanup();
          }
      };
      const subscriber: Subscriber = {
        refresh(access) {
          accessChanged ||= access;
          if (!debounce)
            debounce = setTimeout(() => {
              write(`data: ${JSON.stringify({ access: accessChanged })}\n\n`);
              accessChanged = false;
              debounce = undefined;
            }, 300);
        },
        close() {
          if (closed) return;
          closed = true;
          clearInterval(timer);
          clearTimeout(debounce);
          hub.subscribers.delete(subscriber);
          request.signal.removeEventListener("abort", cleanup);
          try {
            controller.close();
          } catch {
            /* Client already left. */
          }
        },
      };
      cleanup = () => subscriber.close();
      const timer = setInterval(() => {
        void query(
          "SELECT id FROM session WHERE id=$1 AND user_id=$2 AND expires_at>now()",
          [identity.sessionId, identity.userId],
        )
          .then((rows) => {
            if (!rows.length) {
              write('data: {"access":true}\n\n');
              cleanup();
            } else write(": heartbeat\n\n");
          })
          .catch(cleanup);
      }, 25000);
      hub.subscribers.add(subscriber);
      request.signal.addEventListener("abort", cleanup);
      write("retry: 4000\n: connected\n\n");
      if (request.signal.aborted) cleanup();
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "private, no-store",
      "x-accel-buffering": "no",
    },
  });
}
