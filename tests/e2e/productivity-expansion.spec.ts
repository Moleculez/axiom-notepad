import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
const { PDFDocument } = createRequire(import.meta.url)(
  "pdf-lib",
) as typeof import("pdf-lib");
import { fixture, origin } from "./native-editor-helpers";
import { wordFixture } from "../helpers/office-fixtures";
test.use({ trace: "off" });
test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error("Use isolated productivity acceptance on port 3004.");
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
  expect(r.ok(), `${path}: ${await r.text()}`).toBeTruthy();
  return r.json();
}
const mutation = (data: object) => ({ mutationId: randomUUID(), ...data });
async function upload(
  request: APIRequestContext,
  spaceId: string,
  name: string,
  bytes: Buffer,
) {
  const id = randomUUID();
  await call(request, "uploads", { id, spaceId, name, bytes: bytes.length });
  const r = await request.put(`/api/v1/uploads/${id}/chunks/1`, {
    headers: { origin, "content-type": "application/octet-stream" },
    data: bytes,
  });
  expect(r.ok()).toBeTruthy();
  await call(request, `uploads/${id}/complete`, {});
  let done: any;
  await expect
    .poll(
      async () => {
        done = await call(request, `uploads/${id}`);
        return done.status;
      },
      { timeout: 60000 },
    )
    .toBe("complete");
  return call(request, `resources/${done.resourceId}`);
}
test("portfolios, baseline comparison, capacity fences and consistent planning surfaces", async ({
  browser,
}) => {
  test.setTimeout(150000);
  const f = await fixture(browser, "# Portfolio evidence\n");
  try {
    const spaces = await call(f.member.request, "spaces"),
      s = spaces.find(
        (s: any) => s.group_id === f.group.id && s.kind === "team",
      ),
      me = await call(f.member.request, "me");
    const restricted = await call(
      f.owner.request,
      "spaces",
      mutation({
        groupId: f.group.id,
        name: "Restricted study",
        audience: "restricted",
      }),
    );
    await call(
      f.owner.request,
      `spaces/${restricted.space_id}/tasks`,
      mutation({ title: "Must stay hidden" }),
    );
    const a = await call(
      f.member.request,
      `spaces/${s.id}/tasks`,
      mutation({
        title: "Measure the system",
        startOn: "2026-09-21",
        dueOn: "2026-09-22",
        estimateHours: 10,
        assigneeId: me.user.id,
      }),
    );
    const b = await call(
      f.member.request,
      `spaces/${s.id}/tasks`,
      mutation({
        title: "Analyze the measurements",
        startOn: "2026-09-23",
        dueOn: "2026-09-24",
        dependencies: [a.id],
        estimateHours: 10,
        assigneeId: me.user.id,
      }),
    );
    const report = await call(
      f.member.request,
      `groups/${f.group.id}/portfolio`,
    );
    expect(JSON.stringify(report)).not.toContain("Restricted study");
    const portfolio = await call(
      f.owner.request,
      `groups/${f.group.id}/portfolios`,
      mutation({ name: "Experiment programme", spaceIds: [s.id], version: 0 }),
    );
    expect(
      (
        await call(
          f.member.request,
          `groups/${f.group.id}/portfolio?portfolio=${portfolio.id}`,
        )
      ).spaces.map((s: any) => s.id),
    ).toEqual([s.id]);
    const analysis = await call(
      f.member.request,
      `spaces/${s.id}/planning-analysis`,
    );
    expect(analysis.tasks.filter((t: any) => t.critical)).toHaveLength(2);
    const baseline = await call(
      f.member.request,
      `spaces/${s.id}/baselines`,
      mutation({ name: "Initial plan", version: analysis.version }),
    );
    const available = {
      weeklyHours: 15,
      workingDays: [1, 2, 3, 4, 5],
      exceptions: [],
    };
    await call(
      f.member.request,
      `groups/${f.group.id}/capacity`,
      mutation({ userId: me.user.id, settings: available, version: 0 }),
      "PATCH",
    );
    const capacity = await call(
      f.member.request,
      `groups/${f.group.id}/capacity?start=2026-09-21&weeks=4`,
    );
    expect(
      capacity.people.find((p: any) => p.id === me.user.id).weeks[0],
    ).toMatchObject({ demand: 20, available: 15 });
    const preview = await call(
      f.member.request,
      `spaces/${s.id}/schedule/preview`,
      mutation({
        changes: [
          {
            id: a.id,
            version: a.version,
            startOn: "2026-09-28",
            dueOn: "2026-09-29",
          },
        ],
      }),
    );
    expect(preview.proposed).toHaveLength(2);
    expect(preview.capacity.proposed.length).toBeGreaterThan(0);
    await call(
      f.member.request,
      `groups/${f.group.id}/capacity`,
      mutation({
        userId: me.user.id,
        settings: { ...available, weeklyHours: 10 },
        version: 1,
      }),
      "PATCH",
    );
    expect(
      (
        await f.member.request.post(`/api/v1/spaces/${s.id}/schedule/apply`, {
          headers: { origin },
          data: mutation({ previewId: preview.id }),
        })
      ).status(),
    ).toBe(409);
    const fresh = await call(
      f.member.request,
      `spaces/${s.id}/schedule/preview`,
      mutation({
        changes: [
          {
            id: a.id,
            version: a.version,
            startOn: "2026-09-28",
            dueOn: "2026-09-29",
          },
        ],
      }),
    );
    await call(
      f.member.request,
      `spaces/${s.id}/schedule/apply`,
      mutation({ previewId: fresh.id }),
    );
    const diff = await call(
      f.member.request,
      `spaces/${s.id}/baselines?baseline=${baseline.id}&compare=current`,
    );
    expect(diff.comparison.items.map((t: any) => t.id).sort()).toEqual(
      [a.id, b.id].sort(),
    );
    expect(diff.comparison.calendarChanged).toBe(false);
    expect(diff.comparison.milestonesChanged).toBe(false);
    expect(diff.snapshot.tasks.find((t: any) => t.id === a.id).start_on).toBe(
      "2026-09-21",
    );
    await call(
      f.member.request,
      `spaces/${s.id}/schedule/undo`,
      mutation({ previewId: fresh.id }),
    );
    expect((await call(f.member.request, `tasks/${a.id}`)).start_on).toBe(
      "2026-09-21",
    );
    const denied = await f.member.request.patch(
      `/api/v1/groups/${f.group.id}/capacity`,
      {
        headers: { origin },
        data: mutation({
          userId: capacity.people.find((p: any) => p.id !== me.user.id).id,
          settings: available,
          version: 0,
        }),
      },
    );
    expect(denied.status()).toBe(403);
    await f.page.goto(
      `/workbench/groups/${f.group.id}/planning?view=capacity&portfolio=${portfolio.id}`,
    );
    await expect(
      f.page.getByRole("table", { name: "Weekly capacity" }),
    ).toBeVisible();
    await f.page
      .getByRole("button", { name: "Availability", exact: true })
      .click();
    const dialog = f.page.getByRole("dialog", { name: /Availability/ });
    await expect(dialog.getByLabel("Weekly hours")).toHaveValue("10");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await f.page.screenshot({
      path: test.info().outputPath("group-capacity.png"),
      animations: "disabled",
    });
    await f.page.goto(`/workbench/workspaces/${s.id}/planning?view=gantt`);
    await f.page.getByRole("button", { name: "Insights & baselines" }).click();
    await expect(
      f.page.getByRole("region", { name: "Schedule insights" }),
    ).toBeVisible();
    await f.page
      .getByLabel("Baseline", { exact: true })
      .selectOption(baseline.id);
    await expect(f.page.locator(".gantt-baseline")).toHaveCount(2);
    await f.page.screenshot({
      path: test.info().outputPath("planning-baselines.png"),
      animations: "disabled",
    });
    await f.page.goto(`/workbench/workspaces/${s.id}/planning?task=${a.id}`);
    const inspector = f.page.locator(".planning-inspector"),
      ask = inspector.getByRole("button", {
        name: "Ask assistant",
        exact: true,
      }),
      title = inspector.getByRole("textbox", { name: "Title", exact: true });
    await title.fill("Unsaved task draft");
    await ask.focus();
    await ask.press("Enter");
    await expect(f.page.locator(".assistant-panel")).toBeVisible();
    await expect(inspector).toBeHidden();
    await f.page.getByRole("button", { name: "Close assistant" }).click();
    await expect(inspector).toBeVisible();
    await expect(title).toHaveValue("Unsaved task draft");
    await expect(ask).toBeFocused();
  } finally {
    await f.close();
  }
});
test("selected group evidence, Office extraction and reviewed schedule apply/undo", async ({
  browser,
}) => {
  test.setTimeout(150000);
  const f = await fixture(browser, "# Group assistant evidence\n");
  try {
    const s = (await call(f.member.request, "spaces")).find(
        (s: any) => s.group_id === f.group.id && s.kind === "team",
      ),
      extra = await call(
        f.owner.request,
        "spaces",
        mutation({
          groupId: f.group.id,
          name: "Companion workspace",
          audience: "group",
        }),
      );
    await call(f.owner.request, `group-admin/${f.group.id}/providers`, {
      name: "Productivity loopback",
      kind: "private",
      endpoint: "http://127.0.0.1:8096/v1/",
      model: "deterministic-research",
      credential: "assistant-fixture-token",
      capabilities: ["assistant"],
      enabled: true,
      dailyLimit: 100,
    });
    const provider = (
      await call(f.member.request, `spaces/${s.id}/assistant/providers`)
    )[0];
    const c = await call(
      f.member.request,
      `spaces/${s.id}/assistant/conversations`,
      {
        id: randomUUID(),
        title: "Group plan",
        spaceIds: [s.id, extra.space_id],
      },
    );
    const t = await call(
      f.member.request,
      `spaces/${extra.space_id}/tasks`,
      mutation({
        title: "Replicate measurement",
        startOn: "2026-09-21",
        dueOn: "2026-09-22",
      }),
    );
    const doc = await upload(
      f.member.request,
      extra.space_id,
      "group-evidence.docx",
      await (await wordFixture()).generateAsync({ type: "nodebuffer" }),
    );
    const canvas = await call(
      f.member.request,
      "tools",
      mutation({
        kind: "canvas",
        spaceId: extra.space_id,
        name: "Selected hypothesis",
        source: JSON.stringify({
          nodes: [
            {
              id: "selected-card",
              type: "text",
              x: 0,
              y: 0,
              width: 280,
              height: 180,
              title: "Hypothesis",
              text: "Control temperature before comparison.",
            },
            {
              id: "unselected-card",
              type: "text",
              x: 350,
              y: 0,
              width: 280,
              height: 180,
              text: "UNSELECTED PRIVATE DRAFT",
            },
          ],
          edges: [],
        }),
      }),
    );
    const canvasRevision = await call(
      f.member.request,
      `resources/${canvas.id}/history/current`,
    );
    const extraction = await call(f.member.request, "assistant/extractions", {
      id: randomUUID(),
      versionId: doc.current_version_id,
      format: "docx",
    });
    let extracted: any;
    await expect
      .poll(
        async () => {
          extracted = await call(
            f.member.request,
            `assistant/extractions/${extraction.id}`,
          );
          return extracted.status;
        },
        { timeout: 40000 },
      )
      .toBe("complete");
    expect(extracted.result.source).toContain("Energy & evidence");
    expect(
      (
        await f.owner.request.get(
          `/api/v1/assistant/extractions/${extraction.id}`,
        )
      ).status(),
    ).toBe(404);
    const prepare = () =>
      call(f.member.request, `spaces/${s.id}/assistant/contexts`, {
        conversationId: c.id,
        providerId: provider.id,
        providerVersion: provider.version,
        prompt: "Propose a schedule for the selected experiment.",
        selections: [
          { kind: "task", id: t.id, editable: true },
          { kind: "planning", id: extra.space_id, taskIds: [t.id] },
          {
            kind: "office",
            id: doc.id,
            versionId: doc.current_version_id,
            extractionId: extraction.id,
            from: 0,
            to: Math.min(500, extracted.result.source.length),
          },
          {
            kind: "canvas",
            id: canvas.id,
            nodeIds: ["selected-card"],
            hash: canvasRevision.hash,
          },
        ],
        allowTaskCreate: false,
      });
    const p = await prepare();
    expect(p.evidence[0].spaceId).toBe(extra.space_id);
    expect(p.evidence[2].source).toBe(extracted.result.source.slice(0, 500));
    expect(p.evidence[3].source).toContain("Control temperature");
    expect(p.evidence[3].source).not.toContain("UNSELECTED PRIVATE DRAFT");
    const job = await call(
      f.member.request,
      `assistant/conversations/${c.id}/turns`,
      {
        contextId: p.id,
        fingerprint: p.fingerprint,
        consent: true,
        mutationId: randomUUID(),
      },
    );
    let conversation: any;
    await expect
      .poll(
        async () => {
          conversation = await call(
            f.member.request,
            `assistant/conversations/${c.id}`,
          );
          return conversation.turns.find((j: any) => j.id === job.id).status;
        },
        { timeout: 40000 },
      )
      .toBe("complete");
    const proposal = conversation.turns.find((j: any) => j.id === job.id)
      .proposals[0];
    expect(proposal.data.kind).toBe("schedule");
    const receipt = await call(
      f.member.request,
      `assistant/proposals/${proposal.id}/preview`,
      proposal.data,
    );
    expect(receipt.spaceId).toBe(extra.space_id);
    expect((await call(f.member.request, `tasks/${t.id}`)).start_on).toBe(
      "2026-09-21",
    );
    const approval = {
      receiptId: receipt.id,
      fingerprint: receipt.fingerprint,
    };
    await call(
      f.member.request,
      `assistant/proposals/${proposal.id}/apply`,
      approval,
    );
    await call(
      f.member.request,
      `assistant/proposals/${proposal.id}/apply`,
      approval,
    );
    expect((await call(f.member.request, `tasks/${t.id}`)).start_on).toBe(
      "2026-10-05",
    );
    await call(
      f.member.request,
      `assistant/proposals/${proposal.id}/undo`,
      approval,
    );
    const current = await call(f.member.request, `tasks/${t.id}`);
    expect(current.start_on).toBe("2026-09-21");
    await call(
      f.member.request,
      `tasks/${t.id}`,
      mutation({ version: current.version, deleted: true }),
      "PATCH",
    );
    expect(
      (await call(f.member.request, `assistant/conversations/${c.id}`)).turns[0]
        .unavailable,
    ).toBe(true);
    const other = await call(f.owner.request, "groups", {
        name: "Other group",
      }),
      foreign = (await call(f.owner.request, "spaces")).find(
        (x: any) => x.group_id === other.id && x.kind === "team",
      );
    expect(
      (
        await f.owner.request.post(
          `/api/v1/spaces/${s.id}/assistant/conversations`,
          {
            headers: { origin },
            data: {
              id: randomUUID(),
              title: "Rejected boundary",
              spaceIds: [s.id, foreign.id],
            },
          },
        )
      ).status(),
    ).toBe(403);
  } finally {
    await f.close();
  }
});
test("PDF links preserve private annotation permissions and local reply drafts recover", async ({
  browser,
}) => {
  test.setTimeout(150000);
  const f = await fixture(browser, "# Paper task evidence\n");
  try {
    const s = (await call(f.member.request, "spaces")).find(
        (s: any) => s.group_id === f.group.id && s.kind === "team",
      ),
      pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = Buffer.from(await pdf.save());
    const file = await upload(f.member.request, s.id, "paper-task.pdf", bytes),
      id = randomUUID();
    const data = {
      kind: "area",
      page: 1,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      rects: [[0.1, 0.2, 0.3, 0.4]],
      body: "Private measurement",
    };
    let mark = await call(
      f.member.request,
      `attachments/${file.current_version_id}/annotations/${id}`,
      { id, version: 0, mutation_id: randomUUID(), data, shared: false },
      "PUT",
    );
    const linked = await call(
      f.member.request,
      `paper-annotations/${id}/paper-links`,
      mutation({
        annotationVersion: mark.version,
        title: "Verify measurement",
      }),
    );
    expect(
      (await call(f.member.request, `tasks/${linked.taskId}/paper-links`))[0],
    ).toMatchObject({ version_id: file.current_version_id, page: 1 });
    expect(
      await call(f.owner.request, `tasks/${linked.taskId}/paper-links`),
    ).toEqual([]);
    expect(
      (await call(f.owner.request, `tasks/${linked.taskId}`)).body,
    ).not.toContain("Private measurement");
    mark = await call(
      f.member.request,
      `attachments/${file.current_version_id}/annotations/${id}`,
      {
        id,
        version: mark.version,
        mutation_id: randomUUID(),
        data,
        shared: true,
      },
      "PUT",
    );
    expect(
      await call(f.owner.request, `tasks/${linked.taskId}/paper-links`),
    ).toHaveLength(1);
    await f.page.goto(
      `/workbench/pdf/${file.id}?version=${file.current_version_id}&annotation=${id}`,
    );
    await f.page.getByRole("button", { name: "Discuss", exact: true }).click();
    let dialog = f.page.getByRole("dialog", { name: "Annotation discussion" });
    await dialog
      .getByLabel("Reply", { exact: true })
      .fill("Recover this unsent research question.");
    await dialog
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await f.page.reload();
    await f.page.getByRole("button", { name: "Discuss", exact: true }).click();
    dialog = f.page.getByRole("dialog", { name: "Annotation discussion" });
    await expect(dialog.getByLabel("Reply", { exact: true })).toHaveValue(
      "Recover this unsent research question.",
    );
    expect(
      (await call(f.member.request, `paper-threads/${id}`)).replies,
    ).toHaveLength(0);
    await dialog
      .getByRole("button", { name: "Add reply", exact: true })
      .click();
    await expect(dialog.getByLabel("Reply", { exact: true })).toHaveValue("");
    expect(
      (await call(f.member.request, `paper-threads/${id}`)).replies,
    ).toHaveLength(1);
    await f.page.screenshot({
      path: test.info().outputPath("pdf-thread-draft.png"),
      animations: "disabled",
    });
  } finally {
    await f.close();
  }
});
