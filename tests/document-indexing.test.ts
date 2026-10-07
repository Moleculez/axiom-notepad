import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { parseMarkdown } from "@axiom/markdown";
import { parseCanvas } from "../packages/shared/src/canvas";
import { indexNote } from "../packages/shared/src/documents";

vi.mock("@axiom/markdown", async (original) => {
  const module = await original<typeof import("@axiom/markdown")>();
  return { ...module, parseMarkdown: vi.fn(module.parseMarkdown) };
});
vi.mock("../packages/shared/src/canvas", async (original) => {
  const module =
    await original<typeof import("../packages/shared/src/canvas")>();
  return { ...module, parseCanvas: vi.fn(module.parseCanvas) };
});
const note = "00000000-0000-4000-8000-000000000001";
const target = "00000000-0000-4000-8000-000000000002";
function fixture(
  format = "markdown",
  before = "",
  resolutions: Record<string, string | null> = {},
) {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => ({
    rows: sql.startsWith("SELECT body,source_format")
      ? [{ body: before, source_format: format }]
      : sql.startsWith("SELECT input.target")
        ? (values?.[1] as string[]).map((key) => ({
            target: key,
            target_id: resolutions[key] ?? null,
          }))
        : [],
    rowCount: 1,
  }));
  return { query, client: { query } as unknown as PoolClient };
}
beforeEach(() => vi.clearAllMocks());
describe("bounded source-backed document indexing", () => {
  it.each(["unique", "repeated"])(
    "uses two link statements for 100 %s wiki links",
    async (kind) => {
      const db = fixture();
      const source = Array.from(
        { length: 100 },
        (_, i) => `[[${kind === "unique" ? `Target ${i}` : "Target"}]]`,
      ).join("\n");
      await indexNote(`${note}:1`, source, db.client);
      expect(db.query).toHaveBeenCalledTimes(9);
      expect(vi.mocked(parseMarkdown)).toHaveBeenCalledOnce();
      const insert = db.query.mock.calls.find(([sql]) =>
        sql.startsWith("INSERT INTO note_links"),
      )!;
      expect(insert[0]).toContain("unnest($2::text[],$3::uuid[])");
      expect((insert[1]![1] as string[]).length).toBe(
        kind === "unique" ? 100 : 1,
      );
      expect(
        db.query.mock.calls.filter(([sql]) =>
          sql.startsWith("SELECT input.target"),
        ),
      ).toHaveLength(1);
    },
  );
  it("retains exact fragment/case targets while resolving each distinct base once", async () => {
    const db = fixture("markdown", "", { Target: target, Ambiguous: null });
    await indexNote(
      `${note}:1`,
      "[[Target#one]] [[Target#two]] [[Target#one]] [[Ambiguous]] [[Missing]] [web](https://example.test) [anchor](#local)",
      db.client,
    );
    const resolve = db.query.mock.calls.find(([sql]) =>
      sql.startsWith("SELECT input.target"),
    )!;
    expect(resolve[1]).toEqual([note, ["Target", "Ambiguous", "Missing"]]);
    expect(resolve[0]).toContain("LIMIT 2");
    expect(resolve[0]).toContain(
      "n.id::text=input.target OR lower(n.title)=lower(input.target)",
    );
    expect(resolve[0]).toContain(
      "r.space_id=(SELECT space_id FROM resources WHERE note_id=$1)",
    );
    const insert = db.query.mock.calls.find(([sql]) =>
      sql.startsWith("INSERT INTO note_links"),
    )!;
    expect(insert[1]).toEqual([
      note,
      ["Target#one", "Target#two", "Ambiguous", "Missing"],
      [target, target, null, null],
    ]);
  });
  it("reindexes unchanged source after transfers without changing timestamps or notifying", async () => {
    const source = "[[Target]]";
    const db = fixture("markdown", source, { Target: target });
    await indexNote(`${note}:3`, source, db.client);
    expect(
      db.query.mock.calls.find(([sql]) =>
        sql.startsWith("INSERT INTO note_links"),
      ),
    ).toBeDefined();
    expect(
      db.query.mock.calls.some(
        ([sql]) =>
          sql.startsWith("UPDATE resources") ||
          sql.startsWith("SELECT pg_notify"),
      ),
    ).toBe(false);
  });
  it("parses Canvas once and does not parse raw source as Markdown", async () => {
    const source = JSON.stringify({
      nodes: [
        {
          id: "card-a",
          type: "file",
          file: "note.md",
          resourceId: target,
          x: 0,
          y: 0,
          width: 200,
          height: 100,
        },
        {
          id: "card-b",
          type: "file",
          file: "note.md",
          resourceId: target,
          x: 0,
          y: 100,
          width: 200,
          height: 100,
        },
      ],
      edges: [],
    });
    const db = fixture("canvas", "", { [target]: target });
    await indexNote(`${note}:1`, source, db.client);
    expect(vi.mocked(parseCanvas)).toHaveBeenCalledOnce();
    expect(vi.mocked(parseMarkdown)).not.toHaveBeenCalled();
    const insert = db.query.mock.calls.find(([sql]) =>
      sql.startsWith("INSERT INTO note_links"),
    )!;
    expect(insert[1]).toEqual([note, [target], [target]]);
    await indexNote(
      `${note}:1`,
      "literal [[not a link]]",
      fixture("text").client,
    );
    expect(vi.mocked(parseMarkdown)).not.toHaveBeenCalled();
  });
  it("propagates failures to the owning transaction instead of publishing partial success", async () => {
    const db = fixture();
    db.query.mockImplementation(async (sql) => {
      if (sql.startsWith("INSERT INTO note_links"))
        throw new Error("fixture insert failed");
      return {
        rows: sql.startsWith("SELECT body")
          ? [{ body: "", source_format: "markdown" }]
          : [],
        rowCount: 1,
      };
    });
    await expect(
      indexNote(`${note}:1`, "[[Target]]", db.client),
    ).rejects.toThrow("fixture insert failed");
    expect(
      db.query.mock.calls.some(([sql]) => sql.startsWith("SELECT pg_notify")),
    ).toBe(false);
  });
});
