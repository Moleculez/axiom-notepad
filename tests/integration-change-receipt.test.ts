import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntegrationConnection } from "../packages/shared/src/integration-security";
const f = vi.hoisted(() => ({ query: vi.fn(), create: vi.fn() }));
vi.mock("../packages/shared/src/db", () => ({ query: f.query }));
vi.mock("../packages/shared/src/auth", () => ({
  appUrl: "https://research.axiom.test",
}));
vi.mock("../packages/shared/src/workspace-change-sets", () => ({
  createChangeSet: f.create,
}));
import { prepareIntegrationChange } from "../packages/shared/src/integration-change-sets";
const id = "10000000-0000-4000-8000-000000000003";
const spaceId = "10000000-0000-4000-8000-000000000001";
const connection: IntegrationConnection = {
  id: "10000000-0000-4000-8000-000000000004",
  user_id: "fixture-owner",
  client_id: "fixture-client",
  name: "Synthetic MCP client",
  scopes: ["workspace:read", "workspace:write"],
  space_ids: [spaceId],
  grant_version: "revision-1",
  revoked_at: null,
  created_at: "",
  updated_at: "",
};
beforeEach(() => {
  vi.resetAllMocks();
  f.query.mockResolvedValue([]);
});
describe("single-operation MCP receipts", () => {
  it.each(["draft", "queued", "applying", "complete", "partial", "cancelled"])(
    "retries keep identity and never claim another review is needed (%s)",
    async (status) => {
      const result = status === "complete" ? { id: "created-file" } : undefined;
      f.create.mockResolvedValue({
        id,
        status,
        actions: [
          {
            data: { key: "action" },
            state: result ? "complete" : "pending",
            result,
          },
        ],
      });
      const receipt = await prepareIntegrationChange(
        connection,
        "file_create",
        {
          spaceId,
          payload: {
            type: "markdown",
            name: "Synthetic note",
            source: "# Evidence",
            mutationId: id,
          },
        },
      );
      expect(receipt).toMatchObject({
        changeSetId: id,
        approvalId: id,
        status,
        approvalUrl: `https://research.axiom.test/workbench/settings/connections?review=${id}`,
        requiresApproval: status === "draft",
        results: [
          { key: "action", status: result ? "complete" : "pending", result },
        ],
      });
      expect(f.create.mock.calls[0][1].mutationId).toBe(id);
      expect(receipt.pollingInstructions).toContain(
        "do not ask for approval again",
      );
      if (status === "queued")
        expect(receipt.message).toContain("Approval received");
      // The only SQL here records a review receipt, not an approved workspace write.
      expect(f.query).toHaveBeenCalledTimes(1);
      expect(f.query.mock.calls[0][0]).toContain(
        "INSERT INTO integration_calls",
      );
    },
  );
});
