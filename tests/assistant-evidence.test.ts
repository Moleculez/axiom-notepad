import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const f = vi.hoisted(() => ({
  sql: vi.fn(),
  scopes: vi.fn(),
  capture: vi.fn(),
  access: vi.fn(),
  revision: vi.fn(),
  source: vi.fn(),
  require: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("../packages/shared/src/db", () => ({
  transaction: (work: (db: unknown) => unknown) => work({ query: f.sql }),
}));
vi.mock("../packages/shared/src/assistant-service", async () => ({
  assistantScopes: f.scopes,
  captureAssistantEvidence: f.capture,
  ...(await import("../packages/shared/src/assistant-hash")),
}));
vi.mock("../packages/shared/src/access", async () => ({
  ...(await vi.importActual("../packages/shared/src/access")),
  resourceAccess: f.access,
}));
vi.mock("../packages/shared/src/workspace-service", () => ({
  requireScope: f.require,
}));
vi.mock("../packages/shared/src/revision-api", () => ({
  currentRevisionDoc: f.revision,
}));
vi.mock("../packages/shared/src/document-format", () => ({
  documentSource: f.source,
}));
import {
  searchAssistantEvidence,
  readAssistantEvidence,
} from "../packages/shared/src/assistant-evidence-service";
import { sourceHash } from "../packages/shared/src/document-commands";
const space = randomUUID(),
  id = randomUUID(),
  note = randomUUID();
beforeEach(() => {
  vi.resetAllMocks();
  f.scopes.mockResolvedValue([space]);
  f.access.mockResolvedValue({
    resource: { id, space_id: space, note_id: note },
  });
  f.revision.mockResolvedValue({
    format: "markdown",
    doc: { destroy: f.destroy },
  });
  f.source.mockReturnValue("# Synthetic\n");
  f.capture.mockResolvedValue({
    evidence: [
      {
        key: "Esource",
        kind: "document",
        id,
        spaceId: space,
        source: "Synthetic",
        hash: "a".repeat(64),
      },
    ],
  });
  f.sql.mockResolvedValue({ rows: [], rowCount: 1 });
});
describe("permission-filtered bounded native evidence (mocked DB)", () => {
  it("treats wildcards literally, bounds summaries and rechecks scope inside the read transaction", async () => {
    f.sql.mockResolvedValue({
      rows: [
        { id, updated_at: "2026-10-06T00:00:00.000001Z" },
        { id: randomUUID(), updated_at: "2026-10-06T00:00:00.000000Z" },
      ],
      rowCount: 2,
    });
    const result = await searchAssistantEvidence("owner", space, [space], {
      q: "100%_\\",
      limit: 1,
    });
    expect(f.sql.mock.calls[0][1]).toEqual([
      [space],
      "%100\\%\\_\\\\%",
      null,
      null,
      2,
      0,
    ]);
    expect(f.scopes).toHaveBeenCalledTimes(2);
    expect(result.items).toHaveLength(1);
    expect(result.excerptKind).toBe("summary-preview");
    expect(result.pagination).toBe("live");
    await searchAssistantEvidence("owner", space, [space], {
      q: "100%_\\",
      limit: 1,
      cursor: result.nextCursor,
      offset: 999,
    });
    expect(f.sql.mock.calls[1][1].slice(2)).toEqual([
      "2026-10-06T00:00:00.000001Z",
      id,
      2,
      0,
    ]);
    await expect(
      searchAssistantEvidence("owner", space, [space], {
        q: "different",
        cursor: result.nextCursor,
      }),
    ).rejects.toThrow(/another query/);
    f.scopes.mockResolvedValueOnce([randomUUID()]);
    await expect(
      searchAssistantEvidence("owner", space, [space], {
        q: "100%_\\",
        cursor: result.nextCursor,
      }),
    ).rejects.toThrow(/scope/);
  });
  it("does not read rows after a revoked scope or accept unbounded search options", async () => {
    f.scopes.mockRejectedValue(new Error("Revoked"));
    await expect(
      searchAssistantEvidence("owner", space, [space], { q: "test" }),
    ).rejects.toThrow(/Revoked/);
    expect(f.sql).not.toHaveBeenCalled();
    for (const input of [
      { limit: 31 },
      { offset: 10001 },
      { q: "x".repeat(201) },
      { cursor: "invalid" },
      { source: "injected" },
    ])
      await expect(
        searchAssistantEvidence("owner", space, [space], input),
      ).rejects.toThrow();
  });
  it("uses the canonical capture path, preserving exact version/hash-bound ranges", async () => {
    const read = { kind: "document", id, from: 2, to: 8, hash: "a".repeat(64) };
    const result = await readAssistantEvidence("owner", [space], read);
    expect(result.evidence?.key).toBe("Esource");
    expect(f.capture).toHaveBeenCalledWith(
      "owner",
      space,
      [
        {
          kind: "document",
          id,
          from: 2,
          to: 8,
          hash: read.hash,
          editable: false,
        },
      ],
      [space],
    );
    expect(f.destroy).toHaveBeenCalledOnce();
    expect(f.scopes).toHaveBeenCalled();
    await expect(
      readAssistantEvidence("owner", [space], {
        kind: "document",
        id,
        from: 2,
        to: 8,
      }),
    ).rejects.toThrow();
  });
  it("rejects outside-workspace files, nonnative formats and oversized excerpts without truncating", async () => {
    f.access.mockResolvedValueOnce({
      resource: { id, space_id: randomUUID(), note_id: note },
    });
    await expect(
      readAssistantEvidence("owner", [space], { kind: "document", id }),
    ).rejects.toThrow(/outside/);
    f.access.mockResolvedValueOnce({
      resource: { id, space_id: space, note_id: null },
    });
    await expect(
      readAssistantEvidence("owner", [space], { kind: "document", id }),
    ).rejects.toThrow(/PDF\/Office/);
    f.capture.mockResolvedValueOnce({
      evidence: [{ source: "x".repeat(30001) }],
    });
    await expect(
      readAssistantEvidence("owner", [space], { kind: "document", id }),
    ).rejects.toThrow(/nothing was truncated/);
  });
  it("never recursively reads linked Canvas files or ignores requested text ranges", async () => {
    const canvas = JSON.stringify({
      nodes: [{ id: "one", type: "file", file: "never-read" }],
      edges: [],
    });
    f.revision.mockResolvedValue({
      format: "canvas",
      doc: { destroy: f.destroy },
    });
    f.source.mockReturnValue(canvas);
    await readAssistantEvidence("owner", [space], { kind: "document", id });
    expect(f.capture).toHaveBeenCalledExactlyOnceWith(
      "owner",
      space,
      [{ kind: "canvas", id, nodeIds: ["one"], hash: sourceHash(canvas) }],
      [space],
    );
    await expect(
      readAssistantEvidence("owner", [space], {
        kind: "document",
        id,
        from: 0,
        to: 1,
        hash: sourceHash(canvas),
      }),
    ).rejects.toThrow(/card selections/);
    f.source.mockReturnValue(
      JSON.stringify({
        nodes: Array.from({ length: 51 }, (_, i) => ({ id: String(i) })),
        edges: [],
      }),
    );
    await expect(
      readAssistantEvidence("owner", [space], { kind: "document", id }),
    ).rejects.toThrow(/50 Canvas/);
  });
  it("requires explicit task subsets for large plans instead of silently slicing", async () => {
    f.sql.mockResolvedValueOnce({
      rows: Array.from({ length: 101 }, () => ({ id: randomUUID() })),
    });
    await expect(
      readAssistantEvidence("owner", [space], { kind: "planning", id: space }),
    ).rejects.toThrow(/100 planning tasks/);
    await readAssistantEvidence("owner", [space], {
      kind: "planning",
      id: space,
      taskIds: [id],
    });
    expect(f.capture).toHaveBeenCalledWith(
      "owner",
      space,
      [{ kind: "planning", id: space, taskIds: [id] }],
      [space],
    );
    await expect(
      readAssistantEvidence("owner", [space], {
        kind: "planning",
        id: randomUUID(),
        taskIds: [id],
      }),
    ).rejects.toThrow(/outside/);
  });
});
