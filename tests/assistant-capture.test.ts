import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import * as Y from "yjs";
const f = vi.hoisted(() => ({
  query: vi.fn(),
  sql: vi.fn(),
  resource: vi.fn(),
  file: vi.fn(),
  revision: vi.fn(),
  planning: vi.fn(),
}));
vi.mock("../packages/shared/src/db", () => ({
  query: f.query,
  transaction: (work: (db: unknown) => unknown) => work({ query: f.sql }),
}));
vi.mock("../packages/shared/src/access", async () => ({
  ...(await vi.importActual("../packages/shared/src/access")),
  resourceAccess: f.resource,
  fileAccess: f.file,
}));
vi.mock("../packages/shared/src/revision-api", () => ({
  currentRevisionDoc: f.revision,
}));
vi.mock("../packages/shared/src/planning-api", () => ({
  planningTasks: f.planning,
}));
import {
  captureAssistantEvidence,
  assistantMaintenance,
} from "../packages/shared/src/assistant-service";
import { sourceHash } from "../packages/shared/src/document-commands";
const space = randomUUID(),
  id = randomUUID(),
  source = "# Synthetic snapshot\r\n\r\nα + β = γ\r\n";
beforeEach(() => {
  vi.resetAllMocks();
  f.resource.mockResolvedValue({
    resource: {
      id,
      space_id: space,
      note_id: id,
      name: "Synthetic note",
      version: 7,
    },
  });
  f.revision.mockImplementation(async () => {
    const doc = new Y.Doc();
    doc.getText("markdown").insert(0, source);
    return { doc, format: "markdown", generation: 3 };
  });
  f.sql.mockResolvedValue({ rows: [], rowCount: 1 });
  f.query.mockResolvedValue([{ present: true }]);
});
describe("captured source identity and retention (mocked DB with native CRDT source)", () => {
  it("keeps the full canonical hash distinct from an exact excerpt hash", async () => {
    const {
      evidence: [e],
    } = await captureAssistantEvidence("owner", space, [
      {
        kind: "document",
        id,
        editable: true,
        from: 2,
        to: 20,
        hash: sourceHash(source),
      },
    ]);
    expect(e).toMatchObject({
      source: source.slice(2, 20),
      hash: sourceHash(source),
      excerptHash: sourceHash(source.slice(2, 20)),
      version: 7,
      generation: 3,
      from: 2,
      to: 20,
    });
    expect(e.hash).not.toBe(e.excerptHash);
  });
  it("never shifts a stale excerpt or accepts stale hashes", async () => {
    await expect(
      captureAssistantEvidence("owner", space, [
        {
          kind: "document",
          id,
          editable: false,
          from: 2,
          to: 20,
          hash: "a".repeat(64),
        },
      ]),
    ).rejects.toThrow(/changed/);
  });
  it("redacts duplicate private envelopes and provider responses while retaining quota receipts", async () => {
    await assistantMaintenance();
    const sql = f.sql.mock.calls.map(([sql]) => String(sql));
    expect(
      sql.find((s) => s.startsWith("UPDATE assistant_run_reviews")),
    ).toContain("envelope='{}',prefix_messages='[]',read_results='[]'");
    expect(
      sql.find((s) => s.startsWith("UPDATE assistant_run_steps")),
    ).toContain("response=NULL");
    expect(
      sql.some((s) => s.startsWith("DELETE FROM assistant_run_steps")),
    ).toBe(false);
    expect(sql.find((s) => s.startsWith("UPDATE tool_jobs"))).toContain(
      "awaiting-review",
    );
  });
});
