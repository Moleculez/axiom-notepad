import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin } from "./native-editor-helpers";

test("conversation history leads to an exact outgoing review, with no send before consent", async ({
  browser,
}, info) => {
  test.setTimeout(150000);
  if (new URL(origin).port !== "3004")
    throw new Error(
      "Use the isolated extension profile and loopback provider.",
    );
  const source =
    "# History acceptance\n\nA saved, fictional research assumption.\n";
  const f = await fixture(browser, source);
  const call = async (path: string, data?: unknown, owner = false) => {
    const response = await (owner ? f.owner : f.member).request.fetch(
      "/api/v1/" + path,
      {
        method: data === undefined ? "GET" : "POST",
        headers: { origin },
        data,
      },
    );
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const providerCalls = async () =>
    (await (await f.owner.request.get("http://127.0.0.1:8096/calls")).json())
      .calls as number;
  try {
    const spaces = await call("spaces"),
      space = spaces.find(
        (s: any) => s.group_id === f.group.id && s.kind === "team",
      );
    await call(
      `group-admin/${f.group.id}/providers`,
      {
        name: "History acceptance provider",
        kind: "private",
        endpoint: "http://127.0.0.1:8096/v1/",
        model: "deterministic-research",
        credential: "assistant-fixture-token",
        capabilities: ["assistant"],
        enabled: true,
        dailyLimit: 100,
      },
      true,
    );
    const provider = (await call(`spaces/${space.id}/assistant/providers`))[0];
    const conversation = await call(
      `spaces/${space.id}/assistant/conversations`,
      { id: randomUUID(), title: "History review fixture" },
    );
    const context = await call(`spaces/${space.id}/assistant/contexts`, {
      conversationId: conversation.id,
      providerId: provider.id,
      providerVersion: provider.version,
      prompt: "Explain the saved evidence.",
      selections: [{ kind: "document", id: f.note.id, editable: false }],
      allowTaskCreate: false,
    });
    const first = await call(
      `assistant/conversations/${conversation.id}/turns`,
      {
        contextId: context.id,
        fingerprint: context.fingerprint,
        mutationId: randomUUID(),
        consent: true,
      },
    );
    await expect
      .poll(
        async () =>
          (await call(`assistant/conversations/${conversation.id}`)).turns.find(
            (t: any) => t.id === first.id,
          )?.status,
        { timeout: 45000 },
      )
      .toBe("complete");
    await call(`spaces/${space.id}/assistant/conversations`, {
      id: randomUUID(),
      title: "Other private history",
    });
    await f.page.setViewportSize({ width: 1500, height: 960 });
    await f.page
      .getByRole("button", { name: "Ask about this note", exact: true })
      .click();
    const panel = f.page.getByRole("complementary", {
      name: "Workspace research assistant",
    });
    await expect(panel).toBeVisible();
    await panel
      .getByRole("button", { name: "Conversation history", exact: true })
      .click();
    const history = panel.getByRole("region", {
      name: "Private conversation history",
    });
    await expect(
      history.getByRole("button", {
        name: "Other private history",
        exact: true,
      }),
    ).toBeVisible();
    await history
      .getByRole("button", { name: "History review fixture", exact: true })
      .click();
    await expect(panel.locator(".assistant-answer")).toContainText(
      "Evidence and interpretation",
    );
    await panel
      .getByLabel("Assistant mode", { exact: true })
      .selectOption("suggest");
    await panel
      .getByLabel("Assistant request")
      .fill("Compare the follow-up with the earlier answer.");
    const before = await providerCalls();
    await panel
      .getByRole("button", { name: "Review & send", exact: true })
      .click();
    const outgoing = f.page.getByRole("dialog", {
      name: "Review outgoing context",
    });
    await expect(outgoing).toBeVisible();
    await expect(outgoing).toContainText(
      "Compare the follow-up with the earlier answer.",
    );
    await expect(outgoing).toContainText(
      "A saved, fictional research assumption.",
    );
    await outgoing.getByText("Previous answer", { exact: true }).click();
    await expect(outgoing).toContainText("Evidence and interpretation");
    await expect(
      outgoing.getByRole("button", { name: "Send approved context" }),
    ).toBeDisabled();
    expect(await providerCalls()).toBe(before);
    await outgoing.getByRole("button", { name: "Back", exact: true }).click();
    expect(await providerCalls()).toBe(before);
    await panel
      .getByRole("button", { name: "Review & send", exact: true })
      .click();
    await expect(outgoing.getByRole("checkbox")).not.toBeChecked();
    await outgoing.getByRole("checkbox").check();
    await outgoing
      .getByRole("button", { name: "Send approved context" })
      .click();
    await expect
      .poll(
        async () =>
          (
            await call(`assistant/conversations/${conversation.id}`)
          ).turns.filter((t: any) => t.status === "complete").length,
        { timeout: 45000 },
      )
      .toBe(2);
    expect(
      (
        await f.owner.request.get(
          `/api/v1/assistant/conversations/${conversation.id}`,
        )
      ).status(),
    ).toBe(404);
    expect(await f.source()).toBe(source);
    await f.page.screenshot({
      path: info.outputPath("assistant-history-reviewed-context.png"),
    });
  } finally {
    await f.close();
  }
});
