import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  assistantSelectionSchema,
  assistantProposalSchema,
  assistantTaskSchema,
  parseAssistantResponse,
  validateAssistantBudget,
  assistantCitationKeys,
  type AssistantEvidence,
} from "../packages/shared/src/assistant";
import { assistantAnswerHtml } from "../apps/web/components/assistant/AssistantAnswer";
const evidence: AssistantEvidence = {
  key: "E123_1",
  kind: "document",
  id: randomUUID(),
  title: "Research",
  source: "A = B",
  hash: "a".repeat(64),
  capturedAt: new Date().toISOString(),
  editable: true,
  format: "markdown",
  generation: 1,
  from: 0,
  to: 5,
};
const task = {
  title: "Reproduce result",
  body: "Check assumptions",
  status: "todo",
  priority: "normal",
  assigneeId: null,
  labels: [],
  estimateHours: null,
};
describe("private assistant contracts", () => {
  it("validates kind-specific context and disallows arbitrary supplied native source", () => {
    expect(
      assistantSelectionSchema.safeParse({
        kind: "document",
        id: evidence.id,
        source: "fake",
      }).success,
    ).toBe(false);
    expect(
      assistantSelectionSchema.safeParse({
        kind: "pdf",
        id: evidence.id,
        versionId: randomUUID(),
        page: 1,
        text: "Extracted",
      }).success,
    ).toBe(true);
    expect(
      assistantSelectionSchema.safeParse({
        kind: "pdf",
        id: evidence.id,
        versionId: randomUUID(),
        page: 0,
        text: "Extracted",
      }).success,
    ).toBe(false);
  });
  it("requires a complete hash-bound excerpt rather than ambiguous source offsets", () => {
    for (const selection of [
      { from: 0, to: 5 },
      { from: 0, hash: evidence.hash },
      { from: 5, to: 0, hash: evidence.hash },
      { from: 0, to: 0, hash: evidence.hash },
      { from: 0, to: 5, hash: "invalid" },
    ])
      expect(
        assistantSelectionSchema.safeParse({
          kind: "document",
          id: evidence.id,
          ...selection,
        }).success,
      ).toBe(false);
    expect(
      assistantSelectionSchema.safeParse({
        kind: "document",
        id: evidence.id,
        from: 0,
        to: 5,
        hash: evidence.hash,
      }).success,
    ).toBe(true);
  });
  it("accepts only explicitly enabled, format-compatible, non-duplicated targets", () => {
    const proposal = {
      kind: "document",
      evidenceKey: evidence.key,
      source: "A ≈ B",
      explanation: "State uncertainty",
    };
    const parsed = parseAssistantResponse(
      JSON.stringify({
        answer: "Use caution [[E123_1]].",
        proposals: [
          proposal,
          proposal,
          { ...proposal, evidenceKey: "Eother" },
          { kind: "task-create", fields: task, explanation: "Act" },
        ],
      }),
      [evidence],
      false,
    );
    expect(parsed.proposals).toHaveLength(1);
    expect(parsed.warning).toContain("discarded");
    expect(
      parseAssistantResponse(
        JSON.stringify({ answer: "Draft", proposals: [proposal] }),
        [{ ...evidence, editable: false }],
        true,
      ).proposals,
    ).toEqual([]);
    expect(
      parseAssistantResponse(
        JSON.stringify({ answer: "Draft", proposals: [proposal] }),
        [{ ...evidence, format: "text" }],
        true,
      ).proposals,
    ).toEqual([]);
  });
  it("never interprets malformed output or tools as executable proposals", () => {
    for (const text of [
      "Just an answer",
      '{"answer":"hello",',
      JSON.stringify({
        answer: "Hello",
        proposals: [{ kind: "delete-files" }],
      }),
    ]) {
      const result = parseAssistantResponse(text, [evidence], true);
      expect(result.answer).toBe(text);
      expect(result.proposals).toEqual([]);
    }
    expect(() =>
      parseAssistantResponse("x".repeat(30001), [], false),
    ).toThrow();
  });
  it("rejects unapproved task fields, administration and scheduling", () => {
    expect(assistantTaskSchema.parse(task)).toEqual(task);
    for (const field of [
      "startOn",
      "dueOn",
      "deleted",
      "dependencies",
      "spaceId",
      "position",
    ])
      expect(
        assistantProposalSchema.safeParse({
          kind: "task-create",
          fields: { ...task, [field]: "forbidden" },
          explanation: "",
        }).success,
      ).toBe(false);
  });
  it("enforces complete-payload limits without truncation", () => {
    expect(() =>
      validateAssistantBudget([{ ...evidence, source: "x".repeat(30001) }], []),
    ).toThrow(/30,000/);
    expect(() =>
      validateAssistantBudget(Array(21).fill(evidence), []),
    ).toThrow();
    expect(() =>
      validateAssistantBudget(
        [],
        [{ role: "system", content: "x".repeat(60001) }],
      ),
    ).toThrow(/60,000/);
    expect(
      validateAssistantBudget(
        [evidence],
        [{ role: "user", content: "Question" }],
      ),
    ).toBe(8);
  });
  it("extracts only evidence-key citations and deduplicates", () =>
    expect(
      assistantCitationKeys(
        "[[E123_1]] [[E123_1]] [[Ebad]] [p. 2] [[javascript:boom]]",
      ),
    ).toEqual(["E123_1", "Ebad"]));
  it("renders ordinary research content without network-loaded or executable markup", () => {
    const html = assistantAnswerHtml(
      "# Research\n\n**Important** $x^2$\n\n![leak](https://example.test/x) [link](javascript:alert(1))\n\n<script>alert(1)</script>\n\n```mermaid\ngraph TD; A-->B;\n```",
    );
    expect(html).toContain("Important");
    expect(html).not.toMatch(/<(img|script|iframe)|data-mermaid|href=/i);
    expect(html).toContain("x^2");
  });
  it("keeps numbered citations and nested model links inert", () => {
    const html = assistantAnswerHtml(
      "An observation [[E123_1]]. [**linked text**](https://example.test/leak)\n\n> ![embedded](https://example.test/image)\n\n$$\\int_0^1 x^2 dx$$",
    );
    expect(html).toContain("[1]");
    expect(html).toContain("linked text");
    expect(html).toContain("data-math-request");
    expect(html).not.toMatch(/<(a|img|iframe)\b/i);
  });
});
