import { Server, type Connection } from "@hocuspocus/server";
import type pg from "pg";
import * as Y from "yjs";
import { query, pool, transaction } from "@axiom/shared/db";
import {
  verifySyncToken,
  validateConnection,
  spaceAccessEpoch,
} from "@axiom/shared/access";
import { indexNote, flushPendingReferenceIndex } from "@axiom/shared/documents";
import { installAuditContext } from "@axiom/shared/audit-context";
import { saveDueCheckpoints } from "@axiom/shared/document-checkpoints";
import {
  documentSource,
  validateDocument,
} from "@axiom/shared/document-format";
import {
  documentCommandSchema,
  applyDocumentCommand,
  sourceHash,
} from "@axiom/shared/document-commands";
import {
  activeConnection,
  connectionAllowsSpace,
} from "@axiom/shared/integration-security";
import { requireScope } from "@axiom/shared/workspace-service";
import { HttpError } from "@axiom/shared/access";
import { revisionCommandSchema } from "@axiom/shared/revisions";
import { executeRevisionCommand } from "@axiom/shared/revision-command";
const committedCommand = Symbol("durably-committed-command");

type Context = {
  userId: string;
  sessionId: string;
  room: string;
  exp: number;
  accessEpoch: string;
};
const queues = new Map<string, Promise<unknown>>();
const roomGates = new Map<string, Promise<void>>();
const writeLocks = new Map<
  Connection<Context>,
  { client: pg.PoolClient; release: () => void; writes: Promise<unknown>[] }
>();
/** Serialize applying an update and taking a saved snapshot. A lifecycle
 * transition also takes the space row lock held until this update is journaled. */
async function acquireRoom(room: string) {
  const previous = roomGates.get(room);
  let unlock!: () => void;
  const next = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  roomGates.set(room, next);
  await previous;
  return () => {
    unlock();
    if (roomGates.get(room) === next) roomGates.delete(room);
  };
}
function enqueue<T>(room: string, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(room) ?? Promise.resolve())
    .catch(() => {})
    .then(work);
  queues.set(room, next);
  void next
    .finally(() => {
      if (queues.get(room) === next) queues.delete(room);
    })
    .catch(() => {});
  return next;
}
async function persist(room: string, document: Y.Doc) {
  await enqueue(room, async () => {
    const release = await acquireRoom(room);
    try {
      await transaction(async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock_shared(hashtext('axiom:file-references'))",
        );
        // A loaded room may outlive a completed purge notification. Never recreate
        // a removed document or append orphan journal entries from that room.
        if (
          !(
            await client.query(
              "SELECT 1 FROM notes WHERE id=$1 AND generation=$2",
              [room.split(":")[0], Number(room.split(":")[1])],
            )
          ).rowCount
        )
          return;
        const latest = await client.query(
          "SELECT greatest(coalesce((SELECT revision FROM documents WHERE room=$1),0),coalesce(max(id),0)) AS revision,count(*)::int AS pending FROM document_updates WHERE room=$1",
          [room],
        );
        // Nothing changed: do not serialize, overwrite the binary state or
        // rebuild search/link indexes. In particular deletion-only revisions
        // are identified by the durable journal, never by a Yjs state vector.
        if (!latest.rows[0].pending) return;
        const state = Buffer.from(Y.encodeStateAsUpdate(document));
        await client.query(
          "INSERT INTO documents(room,note_id,state,revision) VALUES($1,$2,$3,$4) ON CONFLICT(room) DO UPDATE SET state=excluded.state,revision=excluded.revision,updated_at=now()",
          [room, room.split(":")[0], state, latest.rows[0].revision],
        );
        await client.query(
          "DELETE FROM document_updates WHERE room=$1 AND id<=$2",
          [room, latest.rows[0].revision],
        );
        const {
          rows: [metadata],
        } = await client.query("SELECT source_format FROM notes WHERE id=$1", [
          room.split(":")[0],
        ]);
        await indexNote(
          room,
          documentSource(document, metadata.source_format),
          client,
        );
      });
    } finally {
      release();
    }
  });
}
const server = new Server<Context>({
  name: "Axiom",
  port: Number(process.env.SYNC_PORT ?? 1234),
  address: process.env.SYNC_HOST ?? "127.0.0.1",
  debounce: 1500,
  maxDebounce: 5000,
  quiet: true,
  stopOnSignals: false,
  websocketOptions: { maxPayload: 8 * 1024 * 1024 },
  maxPendingDocuments: 10,
  async onAuthenticate({
    token,
    documentName,
    requestHeaders,
    connectionConfig,
  }) {
    const origin = requestHeaders.get("origin");
    if (origin && origin !== (process.env.APP_URL ?? "http://localhost:3000"))
      throw new Error("Origin is not allowed.");
    const context = verifySyncToken(token);
    if (context.room !== documentName) throw new Error("Invalid room.");
    const note = await validateConnection(context, documentName);
    connectionConfig.readOnly = note.role !== "editor";
    return context;
  },
  async onTokenSync({ token, documentName, connectionConfig, connection }) {
    const ctx = verifySyncToken(token);
    if (ctx.room !== documentName) throw new Error("Invalid room");
    const note = await validateConnection(ctx, documentName);
    connectionConfig.readOnly = note.role !== "editor";
    connection.readOnly = note.role !== "editor";
    return ctx;
  },
  async beforeHandleMessage({ context, documentName, update, connection }) {
    const note = await validateConnection(context, documentName);
    if (
      update.byteLength >
      (note.source_format === "canvas" ? 8 : 2) * 1024 * 1024
    )
      throw new Error("Update exceeds document limit.");
    connection.readOnly = note.role !== "editor";
  },
  async beforeSync({
    document,
    documentName,
    context,
    connection,
    type,
    payload,
  }) {
    if (type !== 0) {
      const release = await acquireRoom(documentName);
      let client: pg.PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        await installAuditContext(client, { actorId: context.userId });
        // Fence new journals against permanent cleanup too, not only snapshots.
        await client.query(
          "SELECT pg_advisory_xact_lock_shared(hashtext('axiom:file-references'))",
        );
        const {
          rows: [scope],
        } = await client.query(
          "SELECT s.id FROM spaces s JOIN resources r ON r.space_id=s.id WHERE r.note_id=$1 FOR KEY SHARE OF s",
          [documentName.split(":")[0]],
        );
        const {
          rows: [access],
        } = await client.query(
          "SELECT axiom_space_role($1,$2) AS role,EXISTS(SELECT 1 FROM session WHERE id=$3 AND user_id=$1 AND expires_at>now()) AS session,EXISTS(SELECT 1 FROM notes WHERE id=$4 AND generation=$5 AND deleted_at IS NULL) AS note",
          [
            context.userId,
            scope?.id ?? null,
            context.sessionId,
            documentName.split(":")[0],
            Number(documentName.split(":")[1]),
          ],
        );
        if (!access?.role || !access.session || !access.note)
          throw new Error(
            "Document access has changed. Retain local edits for recovery.",
          );
        if (context.accessEpoch !== (await spaceAccessEpoch(scope.id, client)))
          throw new Error(
            "Workspace access changed. Retain the old draft before synchronizing.",
          );
        connection.readOnly = access.role !== "editor";
        if (connection.readOnly) {
          await client.query("COMMIT");
          client.release();
          release();
          return;
        }
        const candidate = new Y.Doc();
        try {
          Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document));
          Y.applyUpdate(candidate, payload);
          const {
            rows: [metadata],
          } = await client.query(
            "SELECT source_format FROM notes WHERE id=$1",
            [documentName.split(":")[0]],
          );
          validateDocument(candidate, metadata.source_format);
        } finally {
          candidate.destroy();
        }
        writeLocks.set(connection, { client, release, writes: [] });
      } catch (error) {
        if (client) {
          await client.query("ROLLBACK").catch(() => {});
          client.release();
        }
        release();
        throw error;
      }
    }
  },
  async afterHandleMessage({ connection }) {
    const lock = writeLocks.get(connection);
    if (!lock) return;
    writeLocks.delete(connection);
    try {
      await Promise.all(lock.writes);
      await lock.client.query("COMMIT");
    } catch (error) {
      await lock.client.query("ROLLBACK");
      connection.sendStateless(JSON.stringify({ type: "save-error" }));
      throw error;
    } finally {
      lock.client.release();
      lock.release();
    }
  },
  async onLoadDocument({ documentName, document }) {
    const release = await acquireRoom(documentName);
    try {
      const [saved] = await query("SELECT state FROM documents WHERE room=$1", [
        documentName,
      ]);
      if (!saved) throw new Error("Document version unavailable.");
      Y.applyUpdate(document, new Uint8Array(saved.state));
      for (const update of await query(
        "SELECT data FROM document_updates WHERE room=$1 ORDER BY id",
        [documentName],
      ))
        Y.applyUpdate(document, new Uint8Array(update.data));
      return document;
    } finally {
      release();
    }
  },
  async onChange({ documentName, update, connection, transactionOrigin }) {
    if (transactionOrigin === committedCommand) return;
    const lock = connection && writeLocks.get(connection);
    if (lock) {
      const write = lock.client.query(
        "INSERT INTO document_updates(room,data) VALUES($1,$2)",
        [documentName, Buffer.from(update)],
      );
      lock.writes.push(write);
      await write;
      return;
    }
    await enqueue(documentName, async () => {
      await query("INSERT INTO document_updates(room,data) VALUES($1,$2)", [
        documentName,
        Buffer.from(update),
      ]);
    });
  },
  async onStoreDocument({ documentName, document }) {
    await persist(documentName, document);
  },
  async onStateless({ payload, documentName, document, connection }) {
    if (payload.length > 1024) return;
    let message: { type?: string; id?: string };
    try {
      message = JSON.parse(payload);
    } catch {
      return;
    }
    if (
      message.type === "save-check" &&
      typeof message.id === "string" &&
      message.id.length < 100
    ) {
      try {
        await persist(documentName, document);
        connection.sendStateless(
          JSON.stringify({ type: "persisted", id: message.id }),
        );
      } catch {
        connection.sendStateless(
          JSON.stringify({ type: "save-error", id: message.id }),
        );
      }
    }
  },
  async onRequest({ request, response, instance }) {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/health") {
      try {
        await query("SELECT 1");
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "ok", service: "sync" }));
      } catch {
        response.writeHead(503);
        response.end("Database unavailable");
      }
      throw null;
    }
    if (
      url.pathname === "/internal/revision-command" &&
      request.method === "POST"
    ) {
      if (
        !process.env.SYNC_SECRET ||
        request.headers.authorization !== "Bearer " + process.env.SYNC_SECRET
      ) {
        response.writeHead(403);
        response.end();
        throw null;
      }
      try {
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > 100_000)
            throw new HttpError(413, "Revision command is too large.");
          chunks.push(Buffer.from(chunk));
        }
        const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (
          typeof input.actorId !== "string" ||
          typeof input.sessionId !== "string"
        )
          throw new HttpError(401, "A signed-in user is required.");
        const command = revisionCommandSchema.parse(input.command);
        const room = command.noteId + ":" + command.generation;
        const result = await enqueue(room, async () => {
          const release = await acquireRoom(room);
          try {
            const loaded = instance.documents.get(room);
            const applied = await transaction((client) =>
              executeRevisionCommand(
                client,
                loaded,
                input.actorId,
                input.sessionId,
                command,
              ),
            );
            if (loaded && applied.update && !applied.restore)
              Y.applyUpdate(loaded, applied.update, committedCommand);
            return applied.result;
          } finally {
            release();
          }
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(result));
      } catch (e) {
        response.writeHead(e instanceof HttpError ? e.status : 409, {
          "content-type": "application/json",
        });
        response.end(
          JSON.stringify({
            error: e instanceof Error ? e.message : "Revision action failed.",
          }),
        );
      }
      throw null;
    }
    if (
      url.pathname === "/internal/document-command" &&
      request.method === "POST"
    ) {
      if (
        !process.env.SYNC_SECRET ||
        request.headers.authorization !== `Bearer ${process.env.SYNC_SECRET}`
      ) {
        response.writeHead(403);
        response.end();
        throw null;
      }
      try {
        let bytes = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > 5_500_000)
            throw new HttpError(413, "Document command is too large.");
          chunks.push(Buffer.from(chunk));
        }
        const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (
          typeof input.actorId !== "string" ||
          typeof input.connectionId !== "string"
        )
          throw new HttpError(
            400,
            "A verified integration principal is required.",
          );
        const command = documentCommandSchema.parse(input.command),
          room = `${command.noteId}:${command.generation}`;
        const result = await enqueue(room, async () => {
          const release = await acquireRoom(room),
            candidate = new Y.Doc();
          let update: Uint8Array | undefined;
          try {
            const result = await transaction(async (client) => {
              if (typeof input.grantVersion !== "string")
                throw new HttpError(
                  403,
                  "Reconnect this application before editing.",
                );
              const grant = await activeConnection(
                input.connectionId,
                input.actorId,
                "workspace:write",
                client,
                input.grantVersion,
              );
              await installAuditContext(client, {
                actorId: input.actorId,
                operationId: command.mutationId,
                integrationId: grant.id,
                integrationClient: grant.client_id,
                integrationScope: "workspace:write",
                integrationVersion: grant.grant_version,
              });
              const {
                rows: [resource],
              } = await client.query(
                "SELECT space_id FROM resources WHERE id=$1 AND deleted_at IS NULL",
                [command.noteId],
              );
              if (!resource) throw new HttpError(404, "Document unavailable.");
              connectionAllowsSpace(grant, resource.space_id);
              await requireScope(
                client,
                input.actorId,
                resource.space_id,
                "edit",
              );
              const {
                rows: [locked],
              } = await client.query(
                "SELECT space_id FROM resources WHERE id=$1 AND deleted_at IS NULL FOR SHARE",
                [command.noteId],
              );
              if (!locked || locked.space_id !== resource.space_id)
                throw new HttpError(
                  409,
                  "Document moved. Read its current location first.",
                );
              const {
                rows: [note],
              } = await client.query(
                "SELECT generation,source_format FROM notes WHERE id=$1 AND deleted_at IS NULL FOR SHARE",
                [command.noteId],
              );
              if (!note || note.generation !== command.generation)
                throw new HttpError(
                  409,
                  "Document generation changed. Read the current version before editing.",
                );
              const hash = sourceHash(
                JSON.stringify({
                  actorId: input.actorId,
                  connectionId: input.connectionId,
                  command,
                }),
              );
              const {
                rows: [previous],
              } = await client.query(
                "SELECT * FROM document_command_receipts WHERE id=$1",
                [command.mutationId],
              );
              if (previous) {
                if (
                  previous.actor_id !== input.actorId ||
                  previous.request_hash !== hash
                )
                  throw new HttpError(
                    409,
                    "This retry identifier belongs to another edit.",
                  );
                return previous.result;
              }
              const {
                rows: [saved],
              } = await client.query(
                "SELECT state FROM documents WHERE room=$1",
                [room],
              );
              if (!saved)
                throw new HttpError(409, "Document state is unavailable.");
              Y.applyUpdate(candidate, new Uint8Array(saved.state));
              for (const journal of (
                await client.query(
                  "SELECT data FROM document_updates WHERE room=$1 ORDER BY id",
                  [room],
                )
              ).rows)
                Y.applyUpdate(candidate, new Uint8Array(journal.data));
              const loaded = instance.documents.get(room);
              if (loaded)
                Y.applyUpdate(candidate, Y.encodeStateAsUpdate(loaded));
              const vector = Y.encodeStateVector(candidate);
              try {
                applyDocumentCommand(candidate, note.source_format, command);
              } catch (e) {
                throw new HttpError(409, (e as Error).message);
              }
              update = Y.encodeStateAsUpdate(candidate, vector);
              await client.query(
                "SELECT pg_advisory_xact_lock_shared(hashtext('axiom:file-references'))",
              );
              await client.query(
                "INSERT INTO document_updates(room,data) VALUES($1,$2)",
                [room, Buffer.from(update)],
              );
              await indexNote(
                room,
                documentSource(candidate, note.source_format),
                client,
              );
              const result = {
                noteId: command.noteId,
                generation: command.generation,
                hash: sourceHash(documentSource(candidate, note.source_format)),
                mutationId: command.mutationId,
              };
              await client.query(
                "INSERT INTO document_command_receipts(id,actor_id,note_id,request_hash,result) VALUES($1,$2,$3,$4,$5)",
                [
                  command.mutationId,
                  input.actorId,
                  command.noteId,
                  hash,
                  JSON.stringify(result),
                ],
              );
              return result;
            });
            // Broadcast only after the durable journal and receipt commit.
            const loaded = instance.documents.get(room);
            if (loaded && update)
              Y.applyUpdate(loaded, update, committedCommand);
            return result;
          } finally {
            candidate.destroy();
            release();
          }
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(result));
      } catch (e) {
        response.writeHead(e instanceof HttpError ? e.status : 400, {
          "content-type": "application/json",
        });
        response.end(
          JSON.stringify({
            error: e instanceof Error ? e.message : "Document command failed.",
          }),
        );
      }
      throw null;
    }
    if (url.pathname === "/internal/flush" && request.method === "POST") {
      if (
        !process.env.SYNC_SECRET ||
        request.headers.authorization !== `Bearer ${process.env.SYNC_SECRET}`
      ) {
        response.writeHead(403);
        response.end();
        throw null;
      }
      const room = url.searchParams.get("room") ?? "",
        doc = instance.documents.get(room);
      try {
        if (doc) await persist(room, doc);
        else
          await enqueue(room, async () => {
            const release = await acquireRoom(room),
              recovered = new Y.Doc();
            try {
              await transaction(async (client) => {
                await client.query(
                  "SELECT pg_advisory_xact_lock_shared(hashtext('axiom:file-references'))",
                );
                const {
                  rows: [saved],
                } = await client.query(
                  "SELECT d.state,d.revision,n.source_format FROM documents d JOIN notes n ON n.id=d.note_id WHERE d.room=$1 AND n.generation=$2",
                  [room, Number(room.split(":")[1])],
                );
                const { rows: updates } = await client.query(
                  "SELECT id,data FROM document_updates WHERE room=$1 ORDER BY id",
                  [room],
                );
                if (!updates.length) return;
                if (!saved)
                  throw new Error(
                    "Journal retained for recovery: document generation unavailable.",
                  );
                Y.applyUpdate(recovered, new Uint8Array(saved.state));
                for (const update of updates)
                  Y.applyUpdate(recovered, new Uint8Array(update.data));
                const revision = String(
                  BigInt(saved.revision) > BigInt(updates.at(-1)!.id)
                    ? saved.revision
                    : updates.at(-1)!.id,
                );
                await client.query(
                  "UPDATE documents SET state=$2,revision=$3,updated_at=now() WHERE room=$1",
                  [
                    room,
                    Buffer.from(Y.encodeStateAsUpdate(recovered)),
                    revision,
                  ],
                );
                await indexNote(
                  room,
                  documentSource(recovered, saved.source_format),
                  client,
                );
                await client.query(
                  "DELETE FROM document_updates WHERE room=$1 AND id<=$2",
                  [room, revision],
                );
              });
            } finally {
              recovered.destroy();
              release();
            }
          });
        response.writeHead(200);
        response.end("Saved");
      } catch {
        response.writeHead(503);
        response.end("Persistence unavailable");
      }
      throw null;
    }
  },
});
await server.listen();
const listener = await pool.connect();
await listener.query("LISTEN axiom_access");
await listener.query("LISTEN axiom_refresh");
listener.on("notification", (msg) => {
  if (msg.channel === "axiom_access") server.hocuspocus.closeConnections();
  else
    for (const doc of server.hocuspocus.documents.values())
      doc.broadcastStateless(JSON.stringify({ type: "workspace-changed" }));
});
let maintaining = false;
const maintenance = setInterval(async () => {
  if (maintaining) return;
  maintaining = true;
  try {
    const dirty = await query<{ room: string }>(
      "SELECT DISTINCT room FROM document_updates LIMIT 100",
    );
    for (const { room } of dirty) {
      const doc = server.hocuspocus.documents.get(room);
      if (doc) await persist(room, doc);
    }
    await flushPendingReferenceIndex();
    await saveDueCheckpoints();
  } catch (error) {
    console.error(
      "Maintenance failed:",
      error instanceof Error ? error.message : error,
    );
  } finally {
    maintaining = false;
  }
}, 15000);
console.log(`Axiom synchronization listening on ${server.webSocketURL}`);
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  clearInterval(maintenance);
  await server.destroy();
  await Promise.allSettled(queues.values());
  listener.release();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
