import { describe, expect, it } from "vitest";
import {
  changeSetLifecycle,
  changeSetReceipt,
} from "../packages/shared/src/change-set-lifecycle";

describe("reviewed change-set lifecycle", () => {
  it.each([
    "draft",
    "queued",
    "applying",
    "complete",
    "partial",
    "cancelled",
    "undone",
  ])("only an unapproved draft needs approval (%s)", (status) => {
    const value = changeSetLifecycle(status);
    expect(value.requiresApproval).toBe(status === "draft");
    expect(value.processing).toBe(["queued", "applying"].includes(status));
    expect(value.nextStep === "review").toBe(status === "draft");
    expect(value.nextStep === "wait").toBe(value.processing);
  });
  it("distinguishes approved waiting from completed writes and stopped work", () => {
    expect(changeSetLifecycle("queued").message).toContain("Approval received");
    expect(changeSetLifecycle("applying").message).toContain("you approved");
    expect(changeSetLifecycle("complete").nextStep).toBe("open_results");
    expect(changeSetLifecycle("partial").nextStep).toBe("inspect_results");
    expect(changeSetLifecycle("partial").message).toContain(
      "Inspect completed results",
    );
  });
  it.each(["pending", "future_status", "__proto__", "constructor"])(
    "unknown states do not claim completion, authorization or retryability (%s)",
    (status) => {
      expect(changeSetLifecycle(status)).toMatchObject({
        label: "Unknown status",
        nextStep: "inspect_status",
        processing: false,
        requiresApproval: false,
      });
    },
  );
  it("preserves the same review destination across repeat-safe state changes", () => {
    const id = "10000000-0000-4000-8000-000000000003";
    const origin = "https://research.axiom.test";
    for (const status of ["draft", "queued", "applying", "complete", "partial"])
      expect(changeSetReceipt({ id, status }, origin)).toMatchObject({
        changeSetId: id,
        approvalUrl: `${origin}/workbench/settings/connections?review=${id}`,
        requiresApproval: status === "draft",
      });
  });
});
