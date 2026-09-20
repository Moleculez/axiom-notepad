import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin } from "./native-editor-helpers";
test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error(
      "Assistant acceptance requires isolated port 3004 and the loopback provider fixture.",
    );
});
async function call(
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) {
  const r = await request.fetch(`/api/v1/${path}`, {
    method,
    data,
    headers: { origin },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
async function setup(f: Awaited<ReturnType<typeof fixture>>) {
  const spaces = await call(f.member.request, "spaces"),
    space = spaces.find(
      (s: any) => s.group_id === f.group.id && s.kind === "team",
    );
  await call(f.owner.request, `group-admin/${f.group.id}/providers`, {
    name: "Local acceptance provider",
    kind: "private",
    endpoint: "http://127.0.0.1:8096/v1/",
    model: "deterministic-research",
    credential: "assistant-fixture-token",
    capabilities: ["assistant"],
    enabled: true,
    dailyLimit: 100,
  });
  const provider = (
    await call(f.member.request, `spaces/${space.id}/assistant/providers`)
  )[0];
  const conversation = await call(
    f.member.request,
    `spaces/${space.id}/assistant/conversations`,
    { id: randomUUID(), title: "Private research synthesis" },
  );
  const prepare = (
    prompt = "Propose a precise revision and draft an action item.",
    selections: unknown[] = [
      { kind: "document", id: f.note.id, editable: true },
    ],
    allowTaskCreate = true,
  ) =>
    call(f.member.request, `spaces/${space.id}/assistant/contexts`, {
      conversationId: conversation.id,
      providerId: provider.id,
      providerVersion: provider.version,
      prompt,
      selections,
      allowTaskCreate,
    });
  const submit = (p: any, mutationId = randomUUID()) =>
    call(f.member.request, `assistant/conversations/${conversation.id}/turns`, {
      contextId: p.id,
      fingerprint: p.fingerprint,
      consent: true,
      mutationId,
    });
  const result = async (job: string, status = "complete") => {
    let state: any;
    await expect
      .poll(
        async () => {
          state = await call(
            f.member.request,
            `assistant/conversations/${conversation.id}`,
          );
          return state.turns.find((t: any) => t.id === job)?.status;
        },
        { timeout: 30000 },
      )
      .toBe(status);
    return state.turns.find((t: any) => t.id === job);
  };
  return { space, provider, conversation, prepare, submit, result };
}
test("private context consent, idempotent task proposals, version conflicts and source revocation", async ({
  browser,
}) => {
  test.setTimeout(150000);
  const f = await fixture(
      browser,
      "# Research assumptions\n\nEnergy depends on the model assumptions.\n",
    ),
    s = await setup(f);
  try {
    const p = await s.prepare();
    expect(p.messages.at(-1).content).toContain("Energy depends");
    expect(JSON.stringify(p)).not.toContain("assistant-fixture-token");
    expect(
      (
        await f.owner.request.get(
          `/api/v1/assistant/conversations/${s.conversation.id}`,
        )
      ).status(),
    ).toBe(404);
    const denied = await f.member.request.post(
      `/api/v1/assistant/conversations/${s.conversation.id}/turns`,
      {
        headers: { origin },
        data: {
          contextId: p.id,
          fingerprint: "0".repeat(64),
          consent: true,
          mutationId: randomUUID(),
        },
      },
    );
    expect(denied.status()).toBe(409);
    const key = randomUUID(),
      submitted = await s.submit(p, key);
    expect((await s.submit(p, key)).id).toBe(submitted.id);
    const turn = await s.result(submitted.id);
    expect(turn.answer).toContain("Evidence and interpretation");
    expect(turn.proposals).toHaveLength(2);
    expect(
      (
        await f.member.request.get(`/api/v1/tool-jobs/${submitted.id}`)
      ).status(),
    ).toBe(404);
    expect(await f.source()).not.toContain("experimentally");
    const proposal = turn.proposals.find(
        (p: any) => p.data.kind === "task-create",
      ),
      preview = await call(
        f.member.request,
        `assistant/proposals/${proposal.id}/preview`,
        proposal.data,
      );
    const input = { receiptId: preview.id, fingerprint: preview.fingerprint },
      applied = await call(
        f.member.request,
        `assistant/proposals/${proposal.id}/apply`,
        input,
      );
    expect(
      (
        await call(
          f.member.request,
          `assistant/proposals/${proposal.id}/apply`,
          input,
        )
      ).id,
    ).toBe(applied.id);
    expect(
      (await call(f.member.request, `tasks/${applied.id}`)).title,
    ).toContain("Verify");
    await call(
      f.member.request,
      `tasks/${applied.id}`,
      {
        title: "Peer changed this task",
        version: applied.version,
        mutationId: randomUUID(),
      },
      "PATCH",
    );
    const undo = await f.member.request.post(
      `/api/v1/assistant/proposals/${proposal.id}/undo`,
      { headers: { origin }, data: input },
    );
    expect(undo.status()).toBe(409);
    const p2 = await s.prepare("Draft another action item.", [], true),
      j2 = await s.submit(p2),
      t2 = await s.result(j2.id),
      pTask = t2.proposals[0],
      r2 = await call(
        f.member.request,
        `assistant/proposals/${pTask.id}/preview`,
        pTask.data,
      );
    const undoInput = { receiptId: r2.id, fingerprint: r2.fingerprint },
      saved = await call(
        f.member.request,
        `assistant/proposals/${pTask.id}/apply`,
        undoInput,
      );
    await call(
      f.member.request,
      `assistant/proposals/${pTask.id}/undo`,
      undoInput,
    );
    await call(
      f.member.request,
      `assistant/proposals/${pTask.id}/undo`,
      undoInput,
    );
    expect(
      (await call(f.member.request, `tasks/${saved.id}`)).deleted_at,
    ).toBeTruthy();
    // Both the source turn and derived follow-up must be withheld after Trash.
    const resource = await call(f.member.request, `resources/${f.note.id}`);
    await call(f.member.request, `resources/${f.note.id}/trash`, {
      version: resource.version,
      mutationId: randomUUID(),
    });
    const withheld = await call(
      f.member.request,
      `assistant/conversations/${s.conversation.id}`,
    );
    expect(
      withheld.turns.every(
        (t: any) => t.unavailable && !t.answer && !t.evidence,
      ),
    ).toBe(true);
    expect(
      (
        await f.member.request.get(
          `/api/v1/assistant/conversations/${s.conversation.id}/export`,
        )
      ).status(),
    ).toBe(403);
    await call(
      f.member.request,
      `assistant/conversations/${s.conversation.id}`,
      undefined,
      "DELETE",
    );
  } finally {
    await f.close();
  }
});
test("assistant panel reviews exact context, preserves the editor and keeps document drafts private until Publish", async ({
  browser,
}, info) => {
  test.setTimeout(180000);
  const f = await fixture(
      browser,
      "# Experiment\n\nCheck the mathematical model.\n",
    ),
    _setup = await setup(f);
  try {
    const page = f.page;
    await page
      .getByRole("button", { name: "Ask about this note", exact: true })
      .click();
    const panel = page.getByRole("complementary", {
      name: "Workspace research assistant",
    });
    await expect(panel).toBeVisible();
    await expect(panel.locator(".assistant-task-consent")).toHaveCSS(
      "flex-direction",
      "row",
    );
    await expect(panel.getByLabel("Assistant provider")).toContainText(
      "Local acceptance provider",
    );
    await panel.getByLabel("Allow proposal", { exact: true }).check();
    await panel
      .getByLabel("Assistant request")
      .fill("Propose a precise improvement to this text.");
    await panel.getByRole("button", { name: "Review & send" }).click();
    const outgoing = page.getByRole("dialog", {
      name: "Review outgoing context",
    });
    await expect(outgoing).toBeVisible();
    await expect(outgoing).toContainText("Check the mathematical model");
    await expect(
      outgoing.getByRole("button", { name: "Send approved context" }),
    ).toBeDisabled();
    await outgoing.getByRole("checkbox").check();
    await outgoing
      .getByRole("button", { name: "Send approved context" })
      .click();
    await expect(panel.locator(".assistant-answer")).toContainText(
      "Evidence and interpretation",
      { timeout: 45000 },
    );
    await expect(panel.locator('[data-math-state="ready"]')).toBeVisible();
    expect(await f.source()).toBe(
      "# Experiment\n\nCheck the mathematical model.\n",
    );
    await page.screenshot({ path: info.outputPath("assistant-research.png") });
    await panel.locator(".assistant-citations button").first().click();
    const source = page.getByRole("dialog", { name: "Native editor study" });
    await expect(source).toContainText("Check the mathematical model");
    await source.getByRole("button", { name: "Close dialog" }).click();
    await panel.getByRole("button", { name: "Review draft" }).click();
    const review = page.getByRole("dialog", {
      name: "Review proposed changes",
    });
    await review.getByRole("button", { name: "Preview exact changes" }).click();
    await expect(review.locator("ins")).toContainText("experimentally");
    await review
      .getByRole("button", { name: "Open suggestion editor" })
      .click();
    const editor = page.getByRole("region", {
      name: "Suggesting edits",
      exact: true,
    });
    await expect(editor).toBeVisible();
    await expect(editor).toContainText("Private AI-assisted draft");
    await page.waitForTimeout(2200);
    expect(
      await call(f.member.request, `resources/${f.note.id}/suggestions`),
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath("assistant-private-proposal.png"),
    });
    await page.reload();
    await expect(editor).toBeVisible();
    await expect(editor).toContainText("Private AI-assisted draft");
    await page.waitForTimeout(2200);
    expect(
      await call(f.member.request, `resources/${f.note.id}/suggestions`),
    ).toEqual([]);
    await editor.getByRole("button", { name: "Publish proposal" }).click();
    await expect
      .poll(
        async () =>
          (await call(f.member.request, `resources/${f.note.id}/suggestions`))
            .length,
      )
      .toBe(1);
    expect(await f.source()).not.toContain("experimentally");
    await editor
      .getByRole("button", { name: "Return to accepted document" })
      .click();
    await page.getByRole("button", { name: "Open research assistant" }).click();
    await expect(panel).toBeVisible();
    await panel
      .getByLabel("Assistant request")
      .fill("Retain this unsent private prompt.");
    await panel.getByRole("button", { name: "Close assistant" }).click();
    await page.getByRole("button", { name: "Open research assistant" }).click();
    await expect(page.getByLabel("Assistant request")).toHaveValue(
      "Retain this unsent private prompt.",
    );
    await page.setViewportSize({ width: 1180, height: 800 });
    await expect(
      page.getByRole("dialog", { name: "Research assistant", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("assistant-constrained-desktop.png"),
    });
  } finally {
    await f.close();
  }
});
test("provider changes invalidate consent; cancellation and malformed responses never execute writes", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const f = await fixture(browser, "# Model\n\nBounded source.\n"),
    s = await setup(f);
  try {
    const p = await s.prepare(
      "Explain this slowly.",
      [{ kind: "document", id: f.note.id }],
      false,
    );
    await call(
      f.owner.request,
      `group-admin/${f.group.id}/providers/${s.provider.id}`,
      {
        name: s.provider.name,
        kind: "private",
        endpoint: "http://127.0.0.1:8096/v1/",
        model: "changed-model",
        capabilities: ["assistant"],
        enabled: true,
        dailyLimit: 100,
        version: s.provider.version,
      },
      "PATCH",
    );
    const changed = await f.member.request.post(
      `/api/v1/assistant/conversations/${s.conversation.id}/turns`,
      {
        headers: { origin },
        data: {
          contextId: p.id,
          fingerprint: p.fingerprint,
          consent: true,
          mutationId: randomUUID(),
        },
      },
    );
    expect(changed.status()).toBe(409);
    s.provider.version++;
    const slow = await s.prepare(
        "Explain slowly.",
        [{ kind: "document", id: f.note.id }],
        false,
      ),
      job = await s.submit(slow);
    await expect
      .poll(
        async () =>
          (
            await call(
              f.member.request,
              `assistant/conversations/${s.conversation.id}`,
            )
          ).turns.find((t: any) => t.id === job.id)?.status,
      )
      .toBe("running");
    await call(
      f.member.request,
      `assistant/conversations/${s.conversation.id}/turns/${job.id}/cancel`,
      {},
    );
    await s.result(job.id, "cancelled");
    const invalid = await s.prepare("Return malformed output.", [], false),
      j = await s.submit(invalid),
      turn = await s.result(j.id);
    expect(turn.proposals).toEqual([]);
    expect(turn.warning).toContain("valid structured");
    const broken = await s.prepare("disconnect", [], false),
      uncertain = await s.submit(broken);
    await s.result(uncertain.id, "uncertain");
    expect(await f.source()).toBe("# Model\n\nBounded source.\n");
  } finally {
    await f.close();
  }
});

test("excerpt selection is exact, rejects changed source and never sends a superseded preview", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const f = await fixture(
      browser,
      "# Private heading\n\nSelected research passage.\n\nUnselected appendix.\n",
    ),
    s = await setup(f);
  try {
    const current = await call(
      f.member.request,
      `resources/${f.note.id}/history/current`,
    );
    const forged = await f.member.request.post(
      `/api/v1/spaces/${s.space.id}/assistant/contexts`,
      {
        headers: { origin },
        data: {
          conversationId: s.conversation.id,
          providerId: s.provider.id,
          providerVersion: s.provider.version,
          prompt: "Explain",
          selections: [
            {
              kind: "document",
              id: f.note.id,
              from: 0,
              to: 10,
              hash: "0".repeat(64),
            },
          ],
        },
      },
    );
    expect(forged.status()).toBe(409);
    const p = await s.prepare(
      "Explain the passage",
      [
        {
          kind: "document",
          id: f.note.id,
          from: 19,
          to: 45,
          hash: current.hash,
        },
      ],
      false,
    );
    expect(p.evidence[0].source).toBe(current.body.slice(19, 45));
    expect(p.messages.at(-1).content).not.toContain("Private heading");
    const page = f.page;
    await page
      .getByRole("button", { name: "Ask about this note", exact: true })
      .click();
    const panel = page.getByRole("complementary", {
      name: "Workspace research assistant",
    });
    await panel.getByRole("button", { name: "Choose excerpt 1" }).click();
    const picker = page.getByRole("dialog", {
      name: "Choose document excerpt",
    });
    await picker.getByLabel("Excerpt from line").fill("3");
    await picker.getByLabel("Excerpt through line").fill("3");
    await picker.getByRole("button", { name: "Use selected excerpt" }).click();
    await panel.getByLabel("Assistant request").fill("Explain this excerpt.");
    await panel.getByRole("button", { name: "Review & send" }).click();
    const review = page.getByRole("dialog", {
      name: "Review outgoing context",
    });
    await expect(review).toContainText("Selected research passage.");
    await expect(review).not.toContainText("Unselected appendix");
    await expect(review).not.toContainText("Private heading");
    await review.getByRole("button", { name: "Back", exact: true }).click();
    let release!: () => void, ready!: () => void;
    const waiting = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/assistant/contexts", async (route) => {
      const response = await route.fetch();
      ready();
      await held;
      await route.fulfill({ response });
    });
    await panel.getByRole("button", { name: "Review & send" }).click();
    await waiting;
    await panel
      .getByLabel("Assistant request")
      .fill("A newer unsent question.");
    release();
    await expect(
      panel.getByRole("button", { name: "Review & send" }),
    ).toBeEnabled();
    await expect(review).not.toBeVisible();
    await expect(panel.getByLabel("Assistant request")).toHaveValue(
      "A newer unsent question.",
    );
    await page.unroute("**/assistant/contexts");
  } finally {
    await f.close();
  }
});

test("recovered document drafts cannot publish after dismissal or private conversation deletion", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const f = await fixture(browser, "# Retained note\n\nResearch evidence.\n"),
    s = await setup(f);
  try {
    const prepared = await s.prepare("Propose a revision.", undefined, false),
      job = await s.submit(prepared),
      turn = await s.result(job.id);
    const proposal = turn.proposals[0];
    const receipt = await call(
      f.member.request,
      `assistant/proposals/${proposal.id}/preview`,
      proposal.data,
    );
    const draft = await call(
      f.member.request,
      `assistant/proposals/${proposal.id}/draft?receipt=${receipt.id}`,
    );
    expect(draft.manualPublish).toBe(true);
    expect(draft.assistantContextId).toBe(prepared.id);
    const payload = {
      id: draft.id,
      mutationId: randomUUID(),
      version: 0,
      generation: draft.generation,
      hunks: draft.hunks,
      message: draft.message,
      assistantContextId: draft.assistantContextId,
    };
    await call(
      f.member.request,
      `assistant/proposals/${proposal.id}/dismiss`,
      {},
    );
    expect(
      (
        await f.member.request.post(
          `/api/v1/resources/${f.note.id}/suggestions`,
          { headers: { origin }, data: payload },
        )
      ).status(),
    ).toBe(403);
    await call(
      f.member.request,
      `assistant/conversations/${s.conversation.id}`,
      undefined,
      "DELETE",
    );
    expect(
      (
        await f.member.request.post(
          `/api/v1/resources/${f.note.id}/suggestions`,
          { headers: { origin }, data: payload },
        )
      ).status(),
    ).toBe(403);
    expect(
      await call(f.member.request, `resources/${f.note.id}/suggestions`),
    ).toEqual([]);
    expect(await f.source()).not.toContain("experimentally");
  } finally {
    await f.close();
  }
});

test("deleting a running conversation cannot resurrect its response", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const f = await fixture(browser, "# Model\n\nPrivate evidence.\n"),
    s = await setup(f);
  try {
    const prepared = await s.prepare(
        "Slowly propose an improvement.",
        undefined,
        false,
      ),
      job = await s.submit(prepared);
    await expect
      .poll(
        async () =>
          (
            await call(
              f.member.request,
              `assistant/conversations/${s.conversation.id}`,
            )
          ).turns.find((t: any) => t.id === job.id)?.status,
      )
      .toBe("running");
    await call(
      f.member.request,
      `assistant/conversations/${s.conversation.id}`,
      undefined,
      "DELETE",
    );
    await f.page.waitForTimeout(6500);
    expect(
      (
        await f.member.request.get(
          `/api/v1/assistant/conversations/${s.conversation.id}`,
        )
      ).status(),
    ).toBe(404);
    expect(
      await call(
        f.member.request,
        `spaces/${s.space.id}/assistant/conversations`,
      ),
    ).toEqual([]);
    expect(
      await call(f.member.request, `resources/${f.note.id}/suggestions`),
    ).toEqual([]);
    expect(await f.source()).not.toContain("experimentally");
  } finally {
    await f.close();
  }
});

test("task proposals preserve newer work, preview identity and guarded Undo", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const f = await fixture(browser, "# Planning evidence\n"),
    s = await setup(f);
  try {
    const task = await call(f.member.request, `spaces/${s.space.id}/tasks`, {
      title: "Reproduce the experiment",
      body: "Keep the original protocol.",
      mutationId: randomUUID(),
    });
    const prepared = await s.prepare(
      "Propose an improvement to this task.",
      [{ kind: "task", id: task.id, editable: true }],
      false,
    );
    const job = await s.submit(prepared),
      turn = await s.result(job.id),
      proposal = turn.proposals[0];
    expect(proposal.data.kind).toBe("task-update");
    const old = await call(
      f.member.request,
      `assistant/proposals/${proposal.id}/preview`,
      proposal.data,
    );
    const reviewed = {
      ...proposal.data,
      fields: { ...proposal.data.fields, status: "in_review" },
    };
    const current = await call(
      f.member.request,
      `assistant/proposals/${proposal.id}/preview`,
      reviewed,
    );
    const rejected = await f.member.request.post(
      `/api/v1/assistant/proposals/${proposal.id}/apply`,
      {
        headers: { origin },
        data: { receiptId: old.id, fingerprint: old.fingerprint },
      },
    );
    expect(rejected.status()).toBe(409);
    const approval = {
      receiptId: current.id,
      fingerprint: current.fingerprint,
    };
    const applied = await call(
      f.member.request,
      `assistant/proposals/${proposal.id}/apply`,
      approval,
    );
    const updated = await call(f.member.request, `tasks/${task.id}`);
    expect(updated.status).toBe("in_review");
    expect(updated.priority).toBe("high");
    expect(updated.body).toBe(task.body);
    expect(applied.id).toBe(task.id);
    await call(
      f.member.request,
      `assistant/proposals/${proposal.id}/undo`,
      approval,
    );
    const restored = await call(f.member.request, `tasks/${task.id}`);
    expect(restored.title).toBe(task.title);
    expect(restored.priority).toBe(task.priority);
    const next = await s.prepare(
      "Propose another improvement.",
      [{ kind: "task", id: task.id, editable: true }],
      false,
    );
    const nextJob = await s.submit(next),
      nextTurn = await s.result(nextJob.id),
      nextProposal = nextTurn.proposals[0];
    await call(
      f.member.request,
      `tasks/${task.id}`,
      {
        title: "Changed by a colleague",
        version: restored.version,
        mutationId: randomUUID(),
      },
      "PATCH",
    );
    expect(
      (
        await f.member.request.post(
          `/api/v1/assistant/proposals/${nextProposal.id}/preview`,
          { headers: { origin }, data: nextProposal.data },
        )
      ).status(),
    ).toBe(409);
  } finally {
    await f.close();
  }
});

test("unused previews are bounded and consent never authorizes a different conversation", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const f = await fixture(browser, "# Bounded context\n"),
    s = await setup(f);
  try {
    const preview = await s.prepare("Explain.", [], false);
    const another = await call(
      f.member.request,
      `spaces/${s.space.id}/assistant/conversations`,
      { id: randomUUID(), title: "Other chat" },
    );
    expect(
      (
        await f.member.request.post(
          `/api/v1/assistant/conversations/${another.id}/turns`,
          {
            headers: { origin },
            data: {
              contextId: preview.id,
              fingerprint: preview.fingerprint,
              consent: true,
              mutationId: randomUUID(),
            },
          },
        )
      ).status(),
    ).toBe(409);
    for (let i = 1; i < 20; i++) await s.prepare("Explain.", [], false);
    expect(
      (
        await f.member.request.post(
          `/api/v1/spaces/${s.space.id}/assistant/contexts`,
          {
            headers: { origin },
            data: {
              conversationId: s.conversation.id,
              providerId: s.provider.id,
              providerVersion: s.provider.version,
              prompt: "Another preview",
              selections: [],
            },
          },
        )
      ).status(),
    ).toBe(429);
    await call(
      f.member.request,
      `assistant/conversations/${s.conversation.id}`,
      undefined,
      "DELETE",
    );
  } finally {
    await f.close();
  }
});

test("math drafts use the existing suggestion surface without changing the accepted equation", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const f = await fixture(browser, "# Equation evidence\n"),
    s = await setup(f);
  try {
    const math = await call(f.member.request, "tools", {
      kind: "math",
      spaceId: s.space.id,
      name: "Reviewed equation",
      source: "x^2",
      mutationId: randomUUID(),
    });
    const prepared = await s.prepare(
      "Propose a clarification.",
      [{ kind: "document", id: math.id, editable: true }],
      false,
    );
    const submitted = await s.submit(prepared),
      turn = await s.result(submitted.id),
      proposal = turn.proposals[0];
    const preview = await call(
      f.member.request,
      `assistant/proposals/${proposal.id}/preview`,
      { ...proposal.data, source: "x^2 + y" },
    );
    let releaseSync!: () => void;
    const syncGate = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    await f.page.route(
      `**/api/v1/notes/${math.id}/sync-token`,
      async (route) => {
        await syncGate;
        await route.continue();
      },
    );
    await f.page.goto(
      `/workbench/notes/${math.id}?assistantDraft=${proposal.id}&assistantReceipt=${preview.id}`,
    );
    const editor = f.page.getByRole("region", {
      name: "Suggesting edits",
      exact: true,
    });
    await expect(
      f.page.getByText(
        "Waiting for the collaborative document before opening this private proposal…",
      ),
    ).toBeVisible();
    await expect(editor).not.toBeVisible();
    releaseSync();
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: "Source", exact: true }).click();
    await expect(editor.getByLabel("LaTeX source")).toContainText("x^2 + y");
    await expect(editor).toContainText("Private AI-assisted draft");
    expect(
      await call(f.member.request, `resources/${math.id}/suggestions`),
    ).toEqual([]);
    await expect(
      editor.getByRole("button", { name: "Publish proposal" }),
    ).toBeEnabled();
    await editor.getByRole("button", { name: "Publish proposal" }).click();
    await expect
      .poll(
        async () =>
          (await call(f.member.request, `resources/${math.id}/suggestions`))
            .length,
      )
      .toBe(1);
    expect(
      (await call(f.member.request, `resources/${math.id}/history/current`))
        .body,
    ).toBe("x^2");
  } finally {
    await f.close();
  }
});

test("viewer access allows evidence but not task or document proposals", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const f = await fixture(browser, "# Read-only evidence\n"),
    s = await setup(f);
  try {
    const members = await call(
        f.owner.request,
        `group-admin/${f.group.id}/members`,
      ),
      member = members.items.find((m: any) => m.name === "Native Researcher");
    const change = await call(
      f.owner.request,
      `group-admin/${f.group.id}/members`,
      {
        items: [{ id: member.id, version: member.version }],
        contentRole: "viewer",
        mutationId: randomUUID(),
      },
      "PATCH",
    );
    expect(change.results[0].ok).toBe(true);
    const p = await s.prepare(
      "Explain this research.",
      [{ kind: "document", id: f.note.id }],
      false,
    );
    expect(p.evidence[0].editable).toBe(false);
    for (const [editable, allowTaskCreate] of [
      [true, false],
      [false, true],
    ]) {
      const denied = await f.member.request.post(
        `/api/v1/spaces/${s.space.id}/assistant/contexts`,
        {
          headers: { origin },
          data: {
            conversationId: s.conversation.id,
            providerId: s.provider.id,
            providerVersion: s.provider.version,
            prompt: "Propose changes",
            selections: [{ kind: "document", id: f.note.id, editable }],
            allowTaskCreate,
          },
        },
      );
      expect(denied.status()).toBe(404);
    }
    const job = await s.submit(p),
      answer = await s.result(job.id);
    expect(answer.proposals).toEqual([]);
    const latest = (
      await call(f.owner.request, `group-admin/${f.group.id}/members`)
    ).items.find((m: any) => m.id === member.id);
    await call(
      f.owner.request,
      `group-admin/${f.group.id}/members`,
      {
        items: [{ id: member.id, version: latest.version }],
        remove: true,
        mutationId: randomUUID(),
      },
      "PATCH",
    );
    expect(
      (
        await f.member.request.get(
          `/api/v1/assistant/conversations/${s.conversation.id}`,
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await f.member.request.get(
          `/api/v1/assistant/conversations/${s.conversation.id}/export`,
        )
      ).status(),
    ).toBe(404);
  } finally {
    await f.close();
  }
});
