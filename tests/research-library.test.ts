import { describe, it, expect } from "vitest";
import {
  parseReferenceImport,
  formatRis,
  duplicateReference,
  referenceIdentityKeys,
  libraryDraftSchema,
  libraryScopeSchema,
  type GraphNode,
  type GraphEdge,
} from "../packages/shared/src/research-library";
import {
  layoutResearchGraph,
  graphNeighborhood,
} from "../packages/shared/src/research-graph";
import { tabRoute, tabTitle } from "../packages/shared/src/application-tabs";
import {
  workspaceResearchRoute,
  researchCommandRoute,
} from "../packages/shared/src/research-navigation";
import { workspaceLocation } from "../packages/shared/src/workspace-location";
const source =
  "@inproceedings{demo, title={A {Quantum} Result}, author={A. Author},year={2026},booktitle={Research Meeting},custom={retain {nested} data}, doi={10.5555/demo}}";
describe("research library interoperability", () => {
  it("uses workspace ownership and strips client-supplied group context from navigation", () => {
    const spaceId = "00000000-0000-4000-8000-000000000001";
    expect(libraryScopeSchema.safeParse({ spaceId }).success).toBe(true);
    expect(libraryScopeSchema.safeParse({ groupId: spaceId }).success).toBe(
      false,
    );
    expect(
      workspaceResearchRoute(spaceId, {
        view: "library",
        groupId: "untrusted",
        space: "other",
        q: "physics",
      }),
    ).toBe(`/workspaces/${spaceId}/research?view=library&q=physics`);
    expect(workspaceResearchRoute(spaceId, { view: "invalid" })).toContain(
      "view=overview",
    );
    expect(researchCommandRoute("/research?view=graph", spaceId)).toBe(
      `/workspaces/${spaceId}/research?view=graph`,
    );
    expect(researchCommandRoute("/research?view=graph")).toBe(
      "/workspaces?research=graph",
    );
    expect(tabRoute("/workspaces?research=graph")).toBe(
      "/workspaces?research=graph",
    );
    expect(researchCommandRoute("/docs", spaceId)).toBe("/docs");
    expect(
      workspaceLocation({
        route: `/workspaces/${spaceId}/research?view=library`,
        space: { id: spaceId, name: "Spectral Lab" },
      }).crumbs.map((c) => c.label),
    ).toEqual(["Workspaces", "Spectral Lab", "Research", "Library"]);
  });
  it("keeps uncommon BibTeX fields and duplicate keys without overwriting", () => {
    const r = parseReferenceImport(source + "\n" + source, "bib");
    expect(r.items).toHaveLength(2);
    expect(r.items[1].citeKey).toBe("demo-2");
    expect(r.items[1].bibtex).toContain("custom={retain {nested} data}");
    expect(r.items[1].bibtex).toMatch(/^@inproceedings\{demo-2,/);
    expect(r.items[1].raw).toBe(source);
    expect(r.warnings).toHaveLength(1);
  });
  it("round trips RIS author lists, tags, type and unmapped provenance fields", () => {
    const raw =
      "TY  - BOOK\nID  - research2026\nTI  - A research workflow\nAU  - Example, A\nAU  - Example, B\nPY  - 2026\nKW  - physics\nKW  - review\nAB  - A multiline\n abstract.\nSP  - 12\nAN  - arXiv:2601.00001\nC2  - PMC12345\nER  -";
    const r = parseReferenceImport(raw, "ris").items[0];
    expect(r.authors).toBe("Example, A and Example, B");
    const exported = formatRis({
      ...r,
      cite_key: r.citeKey,
      import_source: { format: "ris", raw },
      title: "Reviewed title",
    });
    expect(exported).toContain("TY  - BOOK");
    expect(exported).toContain("AB  - A multiline\n abstract.");
    expect(exported).toContain("SP  - 12");
    expect(exported).toContain("C2  - PMC12345");
    expect(parseReferenceImport(exported, "ris").items[0]).toMatchObject({
      citeKey: "research2026",
      title: "Reviewed title",
      authors: r.authors,
      tags: ["physics", "review"],
      arxiv: "2601.00001",
    });
  });
  it("recognizes DOI/arXiv versions but keeps title matches conservative", () => {
    const r = parseReferenceImport(source, "bib").items[0];
    expect(
      duplicateReference(r, {
        ...r,
        doi: "https://doi.org/10.5555/DEMO",
        title: "different",
      }),
    ).toBe(true);
    expect(
      referenceIdentityKeys({
        ...r,
        arxiv: "https://arxiv.org/abs/2601.00001v3",
      }),
    ).toContain("arxiv:2601.00001");
    expect(
      duplicateReference(
        { ...r, doi: "", title: "Introduction" },
        { ...r, doi: "", title: "Introduction" },
      ),
    ).toBe(false);
    expect(
      duplicateReference(
        { ...r, doi: "" },
        { ...r, doi: "", authors: "Different author" },
      ),
    ).toBe(false);
  });
  it("rejects unclosed, empty, unsafe and oversized imports", () => {
    for (const s of ["", source.slice(0, -1), "x".repeat(2_000_001)])
      expect(() => parseReferenceImport(s, "bib")).toThrow();
    expect(() =>
      parseReferenceImport(Array(1001).fill(source).join("\n"), "bib"),
    ).toThrow(/1,000/);
    expect(
      libraryDraftSchema.safeParse({
        ...parseReferenceImport(source, "bib").items[0],
        url: "javascript:alert(1)",
      }).success,
    ).toBe(false);
  });
  it("canonicalizes legacy research routes and retains local view filters", () => {
    expect(tabRoute("/workbench/research/references?group=g&q=paper")).toBe(
      "/research?groupId=g&q=paper&view=library",
    );
    expect(tabRoute("/research/graph?focus=note:demo&hops=2")).toBe(
      "/research?focus=note%3Ademo&hops=2&view=graph",
    );
    expect(tabTitle("/research?view=library")).toBe("Reference library");
  });
});
describe("bounded deterministic graph layout", () => {
  const nodes: GraphNode[] = Array.from({ length: 1000 }, (_, i) => ({
    id: `note:${i}`,
    kind: "note",
    title: `Node ${i}`,
    tags: [],
    collections: [],
    route: `/notes/${i}`,
    detail: "",
  }));
  const edges: GraphEdge[] = Array.from({ length: 999 }, (_, i) => ({
    id: `edge:${i}`,
    source: nodes[i].id,
    target: nodes[i + 1].id,
    kind: "link",
  }));
  it("is stable regardless of input order, preserves dragged positions and omits removed nodes", () => {
    const a = layoutResearchGraph(nodes.slice(0, 5), edges.slice(0, 4));
    expect(
      layoutResearchGraph(nodes.slice(0, 5).reverse(), edges.slice(0, 4)),
    ).toEqual(a);
    a[nodes[0].id] = { x: 40, y: 60 };
    const b = layoutResearchGraph(nodes.slice(0, 3), edges.slice(0, 4), a);
    expect(b[nodes[0].id]).toEqual({ x: 40, y: 60 });
    expect(b[nodes[4].id]).toBeUndefined();
  });
  it("limits neighborhoods and handles disconnected nodes", () => {
    expect(
      graphNeighborhood(edges, "note:0", Number.POSITIVE_INFINITY).size,
    ).toBe(3);
    expect([...graphNeighborhood(edges, "note:0", 1)]).toEqual([
      "note:0",
      "note:1",
    ]);
    expect(graphNeighborhood(edges, "note:0", 2).size).toBe(3);
    expect(graphNeighborhood(edges, "unconnected", 2).size).toBe(1);
  });
  it("lays out 1,000 nodes without nonfinite positions or quadratic all-pairs work", () => {
    const start = performance.now(),
      points = layoutResearchGraph(nodes, edges);
    expect(Object.keys(points)).toHaveLength(1000);
    expect(
      Object.values(points).every(
        (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
      ),
    ).toBe(true);
    expect(performance.now() - start).toBeLessThan(10000);
  });
});
