import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin } from "./native-editor-helpers";
test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error("Math revision acceptance uses isolated staging.");
});
test("math milestones retain source and rendering settings through a guarded restore", async ({
  browser,
}) => {
  const f = await fixture(browser, "Math revision fixture.\n");
  try {
    const resource = await (
      await f.member.request.get("/api/v1/resources/" + f.note.id)
    ).json();
    const created = await f.member.request.post("/api/v1/tools", {
      headers: { origin },
      data: {
        kind: "math",
        spaceId: resource.space_id,
        name: "Reviewable equation",
        source: "x^2",
        mutationId: randomUUID(),
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const project = await created.json(),
      base = "/api/v1/resources/" + project.id + "/history";
    await f.page.goto("/workbench/notes/" + project.id);
    await expect(f.page.locator(".studio-status")).toContainText(
      "Saved on server",
    );
    const checkpoint = await f.member.request.post(base, {
      headers: { origin },
      data: { label: "Original equation", mutationId: randomUUID() },
    });
    expect(checkpoint.ok(), await checkpoint.text()).toBe(true);
    const reference = (await checkpoint.json()).id;
    await f.page
      .getByRole("button", { name: "Rendering settings", exact: true })
      .click();
    const dialog = f.page.getByRole("dialog");
    const color = dialog.getByLabel("Ink color"),
      originalColor = await color.inputValue();
    await color.fill("#345678");
    await f.page.keyboard.press("Escape");
    await f.page
      .getByRole("button", { name: "Checkpoint", exact: true })
      .click();
    await expect(f.page.locator(".ws-notice")).toContainText(
      "Named checkpoint saved",
    );
    const milestones = await (await f.member.request.get(base)).json();
    const latest = await (
      await f.member.request.get(base + "/" + milestones.items[0].id)
    ).json();
    expect(latest.settings.foreground).toBe("#345678");
    const source = f.page.getByLabel("LaTeX source");
    await source.click();
    await source.press("ControlOrMeta+a");
    await f.page.keyboard.insertText("x^3 + y");
    await expect(f.page.locator(".studio-status")).toContainText(
      "Saved on server",
    );
    await f.page
      .getByRole("button", { name: "Checkpoint history", exact: true })
      .click();
    const history = f.page.getByRole("region", { name: "Version history" });
    await history
      .getByRole("combobox", { name: "Before revision" })
      .selectOption(reference);
    await expect(
      history.locator(".revision-equation [data-math-state=ready]"),
    ).toHaveCount(2);
    await history
      .getByRole("button", { name: "Restore before", exact: true })
      .click();
    await f.page
      .getByRole("dialog")
      .getByRole("button", { name: "Restore revision", exact: true })
      .click();
    await expect(history).not.toBeVisible();
    await expect(source).toContainText("x^2");
    await expect(source).not.toContainText("x^3");
    await f.page
      .getByRole("button", { name: "Rendering settings", exact: true })
      .click();
    await expect(
      f.page.getByRole("dialog").getByLabel("Ink color"),
    ).toHaveValue(originalColor);
    const saved = await (
      await f.member.request.get("/api/v1/tools/" + project.id)
    ).json();
    expect(saved.settings.foreground).toBe(originalColor);
    await f.page.keyboard.press("Escape");
    await f.page
      .getByRole("button", { name: "Review suggestions", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "Suggest edits", exact: true })
      .click();
    const proposal = f.page.getByRole("region", {
      name: "Suggesting edits",
      exact: true,
    });
    await proposal.getByRole("button", { name: "Source", exact: true }).click();
    const proposedSource = proposal.getByLabel("LaTeX source");
    await proposedSource.click();
    await proposedSource.press("ControlOrMeta+a");
    await f.page.keyboard.insertText("x^2 + z");
    await proposal
      .getByRole("button", { name: "Publish proposal", exact: true })
      .click();
    await expect(proposal.getByRole("status")).toContainText("published");
    expect(
      (await (await f.member.request.get(base + "/current")).json()).body,
    ).toBe("x^2");
    await proposal
      .getByRole("button", { name: "Return to accepted document", exact: true })
      .click();
    const review = f.page.getByRole("region", {
      name: "Review suggestions",
      exact: true,
    });
    await review.getByRole("button", { name: "Refresh suggestions" }).click();
    await review.getByRole("button", { name: "Accept", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await f.member.request.get(base + "/current")).json()).body,
      )
      .toBe("x^2 + z");
  } finally {
    await f.close();
  }
});
