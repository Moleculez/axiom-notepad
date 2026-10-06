import { test, expect, type APIRequestContext } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { fixture, origin, replaceSource } from "./native-editor-helpers";
import { defaults } from "../../packages/shared/src/appearance";
import { interfaceStyleIds } from "../../packages/shared/src/interface-styles";
test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error(
      "Grounding acceptance requires isolated 3004 staging and the loopback provider fixture.",
    );
});
async function call(
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) {
  const response = await request.fetch(`/api/v1/${path}`, {
    method,
    data,
    headers: { origin },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function setup(f: Awaited<ReturnType<typeof fixture>>) {
  const space = (await call(f.member.request, "spaces")).find(
    (s: any) => s.group_id === f.group.id && s.kind === "team",
  );
  await call(f.owner.request, `group-admin/${f.group.id}/providers`, {
    name: "Grounding acceptance fixture",
    kind: "private",
    endpoint: "http://127.0.0.1:8096/v1/",
    model: "synthetic-only",
    credential: "assistant-fixture-token",
    capabilities: ["assistant"],
    enabled: true,
    dailyLimit: 100,
  });
  const provider = (
    await call(f.member.request, `spaces/${space.id}/assistant/providers`)
  )[0];
  const start = async (prompt: string, discover = false, maxRounds = 8) => {
    const conversation = await call(
      f.member.request,
      `spaces/${space.id}/assistant/conversations`,
      { id: randomUUID(), title: prompt.slice(0, 120) },
    );
    const preview = await call(
      f.member.request,
      `spaces/${space.id}/assistant/contexts`,
      {
        conversationId: conversation.id,
        providerId: provider.id,
        providerVersion: provider.version,
        prompt,
        selections: [],
        agent: {
          mode: "ask",
          discover,
          budget: { maxRounds, maxOutputTokens: 1024 },
        },
      },
    );
    const job = await call(
      f.member.request,
      `assistant/conversations/${conversation.id}/turns`,
      {
        contextId: preview.id,
        fingerprint: preview.fingerprint,
        consent: true,
        mutationId: randomUUID(),
      },
    );
    const turn = async () =>
      (
        await call(
          f.member.request,
          `assistant/conversations/${conversation.id}`,
        )
      ).turns.find((t: any) => t.id === job.id);
    return { id: job.id, conversation, turn };
  };
  return { space, start };
}
const providerCalls = async (request: APIRequestContext) =>
  (await request.get("http://127.0.0.1:8096/calls")).json();
test("each exact batch is held locally, narrowing/exclusion invalidates consent, source inspection preserves captured identity", async ({
  browser,
}, info) => {
  test.setTimeout(240000);
  const body =
      "# Synthetic source\n\nTwo observations do not establish reproducibility.\n",
    f = await fixture(browser, body),
    s = await setup(f);
  try {
    const run = await s.start(`productivity-evidence ${f.note.id}`, true);
    await expect
      .poll(async () => (await run.turn()).status, { timeout: 45000 })
      .toBe("awaiting-review");
    const baseline = await providerCalls(f.member.request);
    await f.page.waitForTimeout(1800);
    expect((await providerCalls(f.member.request)).calls).toBe(baseline.calls);
    expect(
      (
        await f.owner.request.get(`/api/v1/assistant/runs/${run.id}/review`)
      ).status(),
    ).toBe(404);
    let review = await call(
      f.member.request,
      `assistant/runs/${run.id}/review`,
    );
    const e = review.evidence.find((e: any) =>
      review.newEvidenceKeys.includes(e.key),
    );
    expect(e.source).toBe(body);
    expect(e.hash).toBe(createHash("sha256").update(body).digest("hex"));
    expect(e.generation).toBeTruthy();
    expect(review.ordinal).toBe(2);
    expect(review.usage.requests).toBe(1);
    const old = review.fingerprint;
    review = await call(
      f.member.request,
      `assistant/runs/${run.id}/review/refresh`,
      { fingerprint: old, excerpts: [{ key: e.key, from: 0, to: 18 }] },
    );
    expect(review.evidence.find((v: any) => v.key === e.key).source).toBe(
      body.slice(0, 18),
    );
    expect(review.fingerprint).not.toBe(old);
    const stale = await f.member.request.post(
      `/api/v1/assistant/runs/${run.id}/review/approve`,
      {
        headers: { origin },
        data: { fingerprint: old, consent: true, mutationId: randomUUID() },
      },
    );
    expect(stale.status()).toBe(409);
    for (const style of interfaceStyleIds)
      for (const mode of ["light", "dark"] as const) {
        const current = await call(f.member.request, "me/preferences");
        await call(
          f.member.request,
          "me/preferences",
          {
            mutationId: randomUUID(),
            version: current.version,
            preferences: {
              ...defaults,
              interfaceStyle: style,
              mode,
              uiSize: 22,
              radius: 0,
              shadows: "none",
              motion: "none",
            },
          },
          "PATCH",
        );
        await f.page.reload();
        await f.page
          .getByRole("button", { name: "Ask about this note", exact: true })
          .click();
        const panel = f.page.getByRole("complementary", {
          name: "Workspace research assistant",
        });
        await panel
          .getByRole("button", { name: "Conversation history", exact: true })
          .click();
        await panel
          .getByRole("button", { name: run.conversation.title, exact: true })
          .click();
        await panel
          .getByRole("button", { name: "Review next batch", exact: true })
          .click();
        const dialog = f.page.getByRole("dialog", {
          name: "Review next outgoing batch",
          exact: true,
        });
        await expect(dialog).toBeVisible();
        await dialog
          .locator(".assistant-review-excerpts summary")
          .first()
          .click();
        await expect(
          dialog.getByRole("button", { name: "Send this batch", exact: true }),
        ).toBeDisabled();
        await expect(
          dialog.getByRole("button", { name: "Close review", exact: true }),
        ).toBeInViewport();
        expect(
          await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
        await f.page.screenshot({
          path: info.outputPath(`batch-review-${style}-${mode}-large-text.png`),
        });
        await dialog
          .getByRole("button", { name: "Close review", exact: true })
          .click();
      }
    await f.page.emulateMedia({
      forcedColors: "active",
      reducedMotion: "reduce",
    });
    const panel = f.page.getByRole("complementary", {
      name: "Workspace research assistant",
    });
    await panel
      .getByRole("button", { name: "Review next batch", exact: true })
      .click();
    const dialog = f.page.getByRole("dialog", {
      name: "Review next outgoing batch",
      exact: true,
    });
    await expect(
      dialog.getByText("New evidence · captured locally", { exact: true }),
    ).toBeVisible();
    await dialog.locator(".assistant-review-excerpts summary").first().click();
    await dialog
      .getByLabel("From character (0-based)", { exact: true })
      .focus();
    await f.page.keyboard.press("Tab");
    await expect(
      dialog.getByLabel("To character (exclusive)", { exact: true }),
    ).toBeFocused();
    const consent = dialog.getByRole("checkbox", {
      name: /I approve this exact batch and output limit/,
    });
    await consent.focus();
    await f.page.keyboard.press("Space");
    await expect(
      dialog.getByRole("button", { name: "Send this batch", exact: true }),
    ).toBeEnabled();
    await f.page.keyboard.press("Space");
    await expect(
      dialog.getByRole("button", { name: "Send this batch", exact: true }),
    ).toBeDisabled();
    await f.page.screenshot({
      path: info.outputPath("batch-review-forced-colors-reduced-motion.png"),
    });
    await f.page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    const exactHash = createHash("sha256")
        .update(JSON.stringify(review.messages))
        .digest("hex"),
      receipt = {
        fingerprint: review.fingerprint,
        consent: true,
        mutationId: randomUUID(),
      };
    await call(
      f.member.request,
      `assistant/runs/${run.id}/review/approve`,
      receipt,
    );
    await call(
      f.member.request,
      `assistant/runs/${run.id}/review/approve`,
      receipt,
    );
    await expect
      .poll(async () => (await run.turn()).status, { timeout: 45000 })
      .toBe("complete");
    const calls = await providerCalls(f.member.request);
    expect(calls.calls).toBe(baseline.calls + 1);
    expect(calls.requests.at(-1)).toEqual({
      hash: exactHash,
      maxOutputTokens: 1024,
    });
    const done = await run.turn(),
      key = done.evidence.find((e: any) => e.source === body.slice(0, 18)).key;
    await replaceSource(f.page, "# New accepted source\n");
    await expect.poll(f.source).toBe("# New accepted source\n");
    const captured = await call(
      f.member.request,
      `assistant/conversations/${run.conversation.id}/turns/${run.id}/evidence/${key}`,
    );
    expect(captured.freshness).toBe("changed");
    expect(captured.evidence.source).toBe(body.slice(0, 18));
    const omitted = await s.start(`productivity-evidence ${f.note.id}`, true);
    await expect
      .poll(async () => (await omitted.turn()).status, { timeout: 45000 })
      .toBe("awaiting-review");
    const initial = await call(
      f.member.request,
      `assistant/runs/${omitted.id}/review`,
    );
    const excluded = await call(
      f.member.request,
      `assistant/runs/${omitted.id}/review/refresh`,
      {
        fingerprint: initial.fingerprint,
        excludeKeys: initial.newEvidenceKeys,
      },
    );
    expect(excluded.newEvidenceKeys).toHaveLength(0);
    expect(JSON.stringify(excluded.messages)).not.toContain(
      "New accepted source",
    );
    await call(
      f.member.request,
      `assistant/conversations/${omitted.conversation.id}/turns/${omitted.id}/cancel`,
      {},
    );
  } finally {
    await f.close();
  }
});
test("revocation prevents approval; invented citations remain inert; missing usage stays unknown; uncertain calls cannot recover", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const f = await fixture(browser, "# Synthetic access boundary\n"),
    s = await setup(f);
  try {
    const missing = await s.start("productivity-missing-usage");
    await expect
      .poll(async () => (await missing.turn()).status, { timeout: 45000 })
      .toBe("complete");
    expect((await missing.turn()).usage).toMatchObject({
      requests: 1,
      inputTokens: null,
      outputTokens: null,
      missingUsage: 1,
    });
    const unknown = await s.start("productivity-unknown");
    await expect
      .poll(async () => (await unknown.turn()).status, { timeout: 45000 })
      .toBe("complete");
    expect((await unknown.turn()).grounding.unknownKeys).toEqual(["Eunknown"]);
    expect((await unknown.turn()).changeSetId).toBeUndefined();
    const uncertain = await s.start("productivity-disconnect");
    await expect
      .poll(async () => (await uncertain.turn()).status, { timeout: 45000 })
      .toBe("uncertain");
    const review = await call(
      f.member.request,
      `assistant/runs/${uncertain.id}/review`,
    );
    expect(
      (
        await f.member.request.post(
          `/api/v1/assistant/runs/${uncertain.id}/review/recover`,
          {
            headers: { origin },
            data: { fingerprint: review.fingerprint, mutationId: randomUUID() },
          },
        )
      ).status(),
    ).toBe(409);
    const revoked = await s.start(`productivity-evidence ${f.note.id}`, true);
    await expect
      .poll(async () => (await revoked.turn()).status, { timeout: 45000 })
      .toBe("awaiting-review");
    const pending = await call(
      f.member.request,
      `assistant/runs/${revoked.id}/review`,
    );
    const resource = await call(f.member.request, `resources/${f.note.id}`);
    await call(f.member.request, `resources/${f.note.id}/trash`, {
      version: resource.version,
      mutationId: randomUUID(),
    });
    const before = await providerCalls(f.member.request);
    expect(
      (
        await f.member.request.post(
          `/api/v1/assistant/runs/${revoked.id}/review/approve`,
          {
            headers: { origin },
            data: {
              fingerprint: pending.fingerprint,
              consent: true,
              mutationId: randomUUID(),
            },
          },
        )
      ).status(),
    ).toBe(403);
    await f.page.waitForTimeout(1800);
    expect((await providerCalls(f.member.request)).calls).toBe(before.calls);
    await call(
      f.member.request,
      `assistant/conversations/${revoked.conversation.id}/turns/${revoked.id}/cancel`,
      {},
    );
  } finally {
    await f.close();
  }
});
