import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin } from "./native-editor-helpers";
test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error("Cloud image acceptance uses isolated staging.");
});
test("working drafts save shared layers without changing the published version", async ({
  browser,
}) => {
  const f = await fixture(browser, "Unchanged note.\n");
  try {
    const resource = await (
      await f.member.request.get("/api/v1/resources/" + f.note.id)
    ).json();
    const created = await f.member.request.post("/api/v1/files/new", {
      headers: { origin },
      data: {
        type: "image",
        spaceId: resource.space_id,
        name: "Cloud figure",
        mutationId: randomUUID(),
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const project = await created.json(),
      base = "/api/v1/tools/" + project.id;
    const original = await (await f.member.request.get(base)).json();
    await f.page.goto("/workbench/notes/" + project.id);
    await expect(
      f.page.getByRole("button", { name: "Add layer", exact: true }),
    ).toBeEnabled();
    await f.page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Cloud annotated layer");
    await expect(f.page.locator(".studio-status")).toContainText(
      "Working draft saved to cloud",
      { timeout: 20000 },
    );
    const head = await (await f.member.request.get(base + "/draft")).json();
    expect(head.manifest.project.layers[0].name).toBe("Cloud annotated layer");
    expect(
      (await (await f.member.request.get(base)).json()).current_version_id,
    ).toBe(original.current_version_id);
    expect(
      (await (await f.owner.request.get(base + "/draft")).json()).revision,
    ).toBe(head.revision);
    const file = await (
      await f.member.request.get("/api/v1/resources/" + project.id)
    ).json();
    const unsafeRestore = await f.member.request.post(
      "/api/v1/files/" + project.id + "/restore-version",
      {
        headers: { origin },
        data: {
          versionId: original.current_version_id,
          version: file.version,
          mutationId: randomUUID(),
        },
      },
    );
    expect(unsafeRestore.status(), await unsafeRestore.text()).toBe(409);
    expect((await unsafeRestore.json()).error).toContain(
      "Image Studio history",
    );
    const uploads: string[] = [];
    f.page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/draft/assets/"))
        uploads.push(r.url());
    });
    await f.page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Metadata only");
    await expect
      .poll(
        async () =>
          (await (await f.member.request.get(base + "/draft")).json())?.manifest
            .project.layers[0].name,
        { timeout: 20000 },
      )
      .toBe("Metadata only");
    expect(uploads).toHaveLength(0);
    const later = await (await f.member.request.get(base + "/draft")).json();
    expect(later.previousManifest.project.layers[0].name).toBe(
      "Cloud annotated layer",
    );
    await f.page
      .getByRole("button", {
        name: "Recover previous cloud draft",
        exact: true,
      })
      .click();
    await f.page
      .getByRole("dialog")
      .getByRole("button", { name: "Recover previous draft", exact: true })
      .click();
    await expect(
      f.page.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue("Cloud annotated layer");
    await expect
      .poll(
        async () =>
          (await (await f.member.request.get(base + "/draft")).json())?.manifest
            .project.layers[0].name,
        { timeout: 20000 },
      )
      .toBe("Cloud annotated layer");
    await f.page
      .getByRole("button", { name: "Save version", exact: true })
      .click();
    await expect(f.page.locator(".studio-status")).toContainText(
      "Saved as a new cloud version",
    );
    expect(
      await (await f.member.request.get(base + "/draft")).json(),
    ).toBeNull();
    expect(
      (await (await f.member.request.get(base)).json()).current_version_id,
    ).not.toBe(original.current_version_id);
    await f.page.getByRole("button", { name: "Image version history" }).click();
    await expect(f.page.locator(".revision-image-pair img")).toHaveCount(2);
    await expect
      .poll(() =>
        f.page
          .locator(".revision-image-pair img")
          .evaluateAll((images: any[]) =>
            images.every((i) => i.complete && i.naturalWidth > 0),
          ),
      )
      .toBe(true);
    await f.page.screenshot({
      path: test.info().outputPath("image-version-comparison.png"),
    });
  } finally {
    await f.close();
  }
});

test("image history restores atomically and preserves the working draft as a milestone", async ({
  browser,
}) => {
  const f = await fixture(browser, "Image restore evidence.\n");
  try {
    const resource = await (
      await f.member.request.get("/api/v1/resources/" + f.note.id)
    ).json();
    const created = await f.member.request.post("/api/v1/files/new", {
      headers: { origin },
      data: {
        type: "image",
        spaceId: resource.space_id,
        name: "Restorable figure",
        mutationId: randomUUID(),
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const project = await created.json(),
      base = "/api/v1/tools/" + project.id;
    const initial = await (await f.member.request.get(base)).json();
    await f.page.goto("/workbench/notes/" + project.id);
    const name = f.page.getByRole("textbox", { name: "Name", exact: true });
    await expect(name).toBeEnabled();
    const original = await name.inputValue();
    await name.fill("Unsaved milestone draft");
    await f.page
      .getByRole("button", { name: "Image version history", exact: true })
      .click();
    const history = f.page.getByRole("region", { name: "Version history" });
    await expect(
      history.getByRole("combobox", { name: "After revision" }),
    ).toContainText("Current cloud working draft");
    await history
      .getByRole("combobox", { name: "Before revision" })
      .selectOption("file:" + initial.current_version_id);
    await history
      .getByRole("button", { name: "Restore before", exact: true })
      .click();
    await f.page
      .getByRole("dialog")
      .getByRole("button", { name: "Restore revision", exact: true })
      .click();
    await expect(history).not.toBeVisible();
    await expect(name).toHaveValue(original);
    const list = await (
      await f.member.request.get("/api/v1/resources/" + project.id + "/history")
    ).json();
    expect(list.items.some((v: any) => v.label === "Before restore")).toBe(
      true,
    );
    expect(list.items.some((v: any) => v.label?.startsWith("Restored"))).toBe(
      true,
    );
    expect(
      await (await f.member.request.get(base + "/draft")).json(),
    ).toBeNull();
    await f.page.reload();
    await expect(name).toHaveValue(original);
  } finally {
    await f.close();
  }
});
