import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mutationTestTarget } from "../../packages/shared/src/test-target";
import { APPEARANCE_SCHEMA } from "../../packages/shared/src/appearance";
import { interfaceStyleIds } from "../../packages/shared/src/interface-styles";
import { localDay } from "../../packages/shared/src/planning-lab";
import { signInOwner } from "./auth";
const origin = "http://localhost:3004";
test.use({
  trace: "off",
  serviceWorkers: "block",
  extraHTTPHeaders: { "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA) },
});
test.beforeAll(() => {
  const target = mutationTestTarget(process.env, process.env.AXIOM_TEST_ROOT);
  if (target.profile !== "reliability")
    throw new Error(
      "Lab-planning mutation acceptance requires attested reliability staging, never the working dataset.",
    );
});
async function write(
  request: APIRequestContext,
  path: string,
  data: Record<string, unknown>,
  method = "POST",
  ok = true,
) {
  const r = await request.fetch(`/api/v1/${path}`, {
    method,
    headers: { origin },
    data: { mutationId: randomUUID(), ...data },
  });
  if (ok) expect(r.ok(), await r.text()).toBeTruthy();
  return r;
}
async function read<T = any>(
  request: APIRequestContext,
  path: string,
): Promise<T> {
  const r = await request.get(`/api/v1/${path}`);
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
async function fixture(request: APIRequestContext) {
  const login = await signInOwner(request, origin);
  expect(login.ok(), await login.text()).toBeTruthy();
  const group = await (
    await write(request, "groups", {
      name: `Lab gate ${randomUUID().slice(0, 8)}`,
    })
  ).json();
  const space = await (
    await write(request, "spaces", {
      groupId: group.id,
      name: "Research planning laboratory",
      audience: "group",
      timezone: "UTC",
    })
  ).json();
  return { id: space.id, base: `spaces/${space.id}` };
}
test("lab planning fields preserve legacy updates, clear explicitly and fence archives/schema", async ({
  request,
}) => {
  const f = await fixture(request);
  let defs = await read(request, `${f.base}/planning-fields`);
  const created = await (
    await write(request, `${f.base}/planning-fields`, {
      name: "Mass",
      kind: "number",
      unit: "mg",
      fieldsVersion: defs.version,
    })
  ).json();
  const field = created.item;
  let task = await (
    await write(request, `${f.base}/tasks`, {
      title: "Experiment",
      customFields: { [field.id]: 0 },
      fieldsVersion: created.fieldsVersion,
    })
  ).json();
  expect(
    (await read(request, `${f.base}/tasks/${task.id}`)).custom_fields[field.id],
  ).toBe(0);
  task = await (
    await write(
      request,
      `${f.base}/tasks/${task.id}`,
      { version: task.version, title: "Renamed experiment" },
      "PATCH",
    )
  ).json();
  expect(task.custom_fields[field.id]).toBe(0);
  expect(
    (
      await write(
        request,
        `${f.base}/tasks/${task.id}`,
        {
          version: task.version,
          customFields: { [field.id]: "bad" },
          fieldsVersion: created.fieldsVersion,
        },
        "PATCH",
        false,
      )
    ).ok(),
  ).toBe(false);
  defs = await read(request, `${f.base}/planning-fields`);
  await write(request, `${f.base}/planning-fields`, {
    name: "Reviewer note",
    kind: "text",
    fieldsVersion: defs.version,
  });
  expect(
    (
      await write(
        request,
        `${f.base}/tasks/${task.id}`,
        {
          version: task.version,
          customFields: { [field.id]: 2 },
          fieldsVersion: created.fieldsVersion,
        },
        "PATCH",
        false,
      )
    ).status(),
  ).toBe(409);
  defs = await read(request, `${f.base}/planning-fields`);
  task = await (
    await write(
      request,
      `${f.base}/tasks/${task.id}`,
      {
        version: task.version,
        customFields: { [field.id]: 2 },
        fieldsVersion: defs.version,
      },
      "PATCH",
    )
  ).json();
  const filter = encodeURIComponent(
    JSON.stringify([{ fieldId: field.id, op: "gte", value: 2 }]),
  );
  const page = await read(
    request,
    `${f.base}/planning?fieldFilters=${filter}&includeFields=${field.id}&sortField=${field.id}`,
  );
  expect(page.total).toBe(1);
  expect(page.items[0]).not.toHaveProperty("custom_fields");
  expect(page.items[0].field_summaries[field.id].value).toBe(2);
  expect(
    (
      await write(
        request,
        `${f.base}/planning-fields/${field.id}`,
        { version: field.version, fieldsVersion: defs.version, kind: "text" },
        "PATCH",
        false,
      )
    ).status(),
  ).toBe(409);
  await write(
    request,
    `${f.base}/planning-fields/${field.id}`,
    { version: field.version, fieldsVersion: defs.version, archived: true },
    "PATCH",
  );
  const blocked = await request.get(
    `/api/v1/${f.base}/planning?fieldFilters=${filter}`,
  );
  expect(blocked.status()).toBe(409);
  expect(
    (await read(request, `${f.base}/tasks/${task.id}`)).custom_fields[field.id],
  ).toBe(2);
});
test("lab planning time has explicit corrections/history, cursor totals, and no schedule changes", async ({
  request,
}) => {
  const f = await fixture(request),
    task = await (
      await write(request, `${f.base}/tasks`, {
        title: "Verified task",
        estimateHours: 3,
      })
    ).json(),
    today = localDay("UTC"),
    before = await read(request, `${f.base}/planning`);
  const first = await (
    await write(request, `${f.base}/planning-time`, {
      taskId: task.id,
      spentOn: today,
      minutes: 90,
      note: "A".repeat(350),
    })
  ).json();
  const report = await read(
    request,
    `${f.base}/planning-time?from=${today}&to=${today}&limit=1`,
  );
  expect(report.totals.minutes).toBe(90);
  expect(report.items[0]).not.toHaveProperty("note");
  expect(report.items[0].note_preview).toHaveLength(200);
  expect(report.items[0].note_truncated).toBe(true);
  expect(
    (await read(request, `${f.base}/planning-time/${first.item.id}`)).item.note,
  ).toHaveLength(350);
  expect((await read(request, `${f.base}/planning`)).version).toBe(
    before.version,
  );
  expect((await read(request, `${f.base}/tasks/${task.id}`)).version).toBe(
    task.version,
  );
  const changed = await (
    await write(
      request,
      `${f.base}/planning-time/${first.item.id}`,
      {
        taskId: task.id,
        spentOn: today,
        minutes: 120,
        note: "Corrected",
        version: first.item.version,
      },
      "PATCH",
    )
  ).json();
  expect(
    (
      await write(
        request,
        `${f.base}/planning-time/${first.item.id}`,
        {
          taskId: task.id,
          spentOn: today,
          minutes: 15,
          version: first.item.version,
        },
        "PATCH",
        false,
      )
    ).status(),
  ).toBe(409);
  const withdrawn = await (
    await write(request, `${f.base}/planning-time/${first.item.id}/withdraw`, {
      version: changed.item.version,
    })
  ).json();
  expect(
    (await read(request, `${f.base}/planning-time?from=${today}&to=${today}`))
      .total,
  ).toBe(0);
  await write(request, `${f.base}/planning-time/${first.item.id}/restore`, {
    version: withdrawn.item.version,
  });
  const history = await read(
    request,
    `${f.base}/planning-time/${first.item.id}/history?limit=1`,
  );
  expect(history.total).toBe(4);
  expect(history.nextCursor).toBeTruthy();
  expect(
    (
      await read(
        request,
        `${f.base}/planning-time/export?from=${today}&to=${today}`,
      )
    ).items[0].note,
  ).toBe("Corrected");
  await write(
    request,
    `${f.base}/tasks/${task.id}`,
    { version: task.version, deleted: true },
    "PATCH",
  );
  expect(
    (await read(request, `${f.base}/planning-time?from=${today}&to=${today}`))
      .total,
  ).toBe(1);
});
test("lab planning proposals require selection preview, keep skipped tasks and guard Undo", async ({
  request,
}) => {
  const f = await fixture(request),
    defs = await read(request, `${f.base}/planning-fields`),
    a = await (await write(request, `${f.base}/tasks`, { title: "A" })).json(),
    b = await (await write(request, `${f.base}/tasks`, { title: "B" })).json();
  let rule = await (
    await write(request, `${f.base}/planning-automations`, {
      name: "Reviewed triage",
      trigger: "changed",
      conditions: [{ field: "status", op: "eq", value: "todo" }],
      actions: [{ kind: "priority", value: "high" }],
      fieldsVersion: defs.version,
    })
  ).json();
  expect(rule.item.enabled).toBe(false);
  expect(
    (
      await write(
        request,
        `${f.base}/planning-automations/${rule.item.id}/run`,
        { version: rule.item.version },
        "POST",
        false,
      )
    ).status(),
  ).toBe(409);
  rule = await (
    await write(
      request,
      `${f.base}/planning-automations/${rule.item.id}`,
      {
        version: rule.item.version,
        enabled: true,
        fieldsVersion: defs.version,
      },
      "PATCH",
    )
  ).json();
  const prepared = await (
    await write(request, `${f.base}/planning-automations/${rule.item.id}/run`, {
      version: rule.item.version,
    })
  ).json();
  expect(prepared.status).toBe("pending");
  const run = (
    await read(request, `${f.base}/planning-automation-runs/${prepared.id}`)
  ).item;
  expect((await read(request, `${f.base}/tasks/${a.id}`)).priority).toBe(
    "normal",
  );
  expect(
    (
      await write(
        request,
        `${f.base}/planning-automation-runs/${run.id}/apply`,
        { version: run.version, selected: [a.id] },
        "POST",
        false,
      )
    ).status(),
  ).toBe(409);
  const preview = await (
    await write(
      request,
      `${f.base}/planning-automation-runs/${run.id}/preview`,
      { version: run.version, selected: [a.id] },
    )
  ).json();
  const applied = await (
    await write(request, `${f.base}/planning-automation-runs/${run.id}/apply`, {
      version: preview.version,
      selected: [a.id],
      previewId: preview.preview.id,
    })
  ).json();
  expect((await read(request, `${f.base}/tasks/${a.id}`)).priority).toBe(
    "high",
  );
  expect((await read(request, `${f.base}/tasks/${b.id}`)).priority).toBe(
    "normal",
  );
  expect(applied.item.changes).toHaveLength(2);
  await write(request, `${f.base}/planning-automations/${rule.item.id}/pause`, {
    version: rule.item.version,
  });
  await write(request, `${f.base}/planning-automation-runs/${run.id}/undo`, {
    version: applied.item.version,
  });
  expect((await read(request, `${f.base}/tasks/${a.id}`)).priority).toBe(
    "normal",
  );
});
test("lab planning native forms retain draft panels and fit all interface styles", async ({
  page,
}, info) => {
  const f = await fixture(page.request);
  await page.goto(`/workbench/workspaces/${f.id}/settings/planning`);
  await expect(
    page.getByRole("heading", { name: "Task fields", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New field", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Name", { exact: true })
    .fill(
      "Very long research property name for consistent enlarged label alignment",
    );
  await dialog.getByLabel("Type", { exact: true }).selectOption("number");
  await dialog.getByLabel("Unit", { exact: true }).fill("mg");
  for (const style of interfaceStyleIds)
    for (const mode of ["light", "dark"]) {
      await page.evaluate(
        ({ style, mode }) => {
          document.documentElement.dataset.interfaceStyle = style;
          document.documentElement.dataset.theme = mode;
          document.documentElement.style.setProperty("--size-ui", "22px");
          document.documentElement.style.setProperty("--radius", "0px");
          document.documentElement.style.setProperty("--shadow", "none");
        },
        { style, mode },
      );
      await expect(
        dialog.getByRole("button", { name: "Save field", exact: true }),
      ).toBeInViewport();
      await page.screenshot({
        path: info.outputPath(`lab-field-${style}-${mode}.png`),
      });
    }
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await dialog.getByLabel("Unit", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Save field", exact: true }),
  ).toBeInViewport();
  await dialog.getByRole("button", { name: "Save field", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.goto(`/workbench/workspaces/${f.id}/planning?task=new`);
  const inspector = page.getByRole("complementary", { name: "New task" });
  await inspector.getByLabel("Title", { exact: true }).fill("Draft task");
  const property = inspector.getByLabel(
    "Very long research property name for consistent enlarged label alignment",
    { exact: true },
  );
  await property.fill("-0");
  await expect(property).toHaveValue("-0");
  await property.press("End");
  await property.press(".");
  await expect(property).toHaveValue("-0.");
  await expect(
    inspector.getByRole("button", { name: "Save task", exact: true }),
  ).toBeDisabled();
  await property.press("1");
  await property.press("0");
  await expect(property).toHaveValue("-0.10");
  await expect(
    inspector.getByRole("button", { name: "Save task", exact: true }),
  ).toBeEnabled();
  await inspector
    .getByRole("button", { name: "Save task", exact: true })
    .click();
  await expect(inspector).toHaveCount(0);
  await page.getByRole("button", { name: "Draft task", exact: true }).click();
  const details = page.getByRole("complementary", { name: "Task details" });
  await details
    .getByLabel("Title", { exact: true })
    .fill("Local retained draft");
  await details.getByRole("button", { name: "Time", exact: true }).click();
  await expect(
    details.getByRole("heading", { name: "Time ledger", exact: true }),
  ).toBeVisible();
  await details
    .getByRole("button", { name: "Properties", exact: true })
    .click();
  await expect(details.getByLabel("Title", { exact: true })).toHaveValue(
    "Local retained draft",
  );
  const retained = details.getByLabel(
    "Very long research property name for consistent enlarged label alignment",
    { exact: true },
  );
  await retained.fill("1.00e-3");
  await expect(retained).toHaveValue("1.00e-3");
  await details.getByRole("button", { name: "Time", exact: true }).click();
  await details
    .getByRole("button", { name: "Properties", exact: true })
    .click();
  await expect(retained).toHaveValue("1.00e-3");
});
