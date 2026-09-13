import { test, expect, type ConsoleMessage } from "@playwright/test";
import { fixture, origin } from "./native-editor-helpers";

test("sharing preserves sections without duplicate keys across loading, search and reopen", async ({
  browser,
}, info) => {
  if (origin !== "http://localhost:3004")
    throw new Error("Use isolated staging for dialog acceptance.");
  const f = await fixture(
    browser,
    "# Sharing regression\n\nKeep this note unchanged.\n",
  );
  const warnings: string[] = [];
  const capture = (message: ConsoleMessage) => {
    if (
      ["error", "warning"].includes(message.type()) &&
      /same key|unique.*key/i.test(message.text())
    )
      warnings.push(message.text());
  };
  f.page.on("console", capture);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const access = /\/api\/v1\/resources\/[^/]+\/access\?/;
  await f.page.route(access, async (route) => {
    await gate;
    await route.continue();
  });
  try {
    const trigger = f.page.getByRole("button", { name: "Share", exact: true });
    await trigger.click();
    const dialog = f.page.getByRole("dialog", {
      name: "Sharing & collaboration",
    });
    await expect(
      dialog.getByText("Checking access…", { exact: true }),
    ).toBeVisible();
    release();
    await expect(dialog.getByLabel("Link to this file")).toHaveValue(
      `${origin}/workbench/notes/${f.note.id}`,
    );
    await f.page.unroute(access);
    await expect(dialog.locator(":scope > .dialog-body")).toHaveCount(1);
    await expect(dialog.locator(":scope > .dialog-footer")).toHaveCount(1);
    await expect(
      dialog.getByRole("region", { name: "File access" }),
    ).toHaveCount(1);
    await expect(
      dialog.getByRole("list", { name: "People with access" }),
    ).toHaveCount(1);
    const search = dialog.getByLabel("Find a collaborator");
    await search.fill("no such collaborator");
    await expect(dialog.getByText("No matching collaborators.")).toBeVisible();
    await expect(search).toHaveValue("no such collaborator");
    await search.fill("");
    await expect(
      dialog.getByRole("list", { name: "People with access" }),
    ).toContainText("Native Researcher");
    await f.page.screenshot({ path: info.outputPath("sharing-dialog.png") });
    await f.page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(dialog.getByLabel("Link to this file")).toBeVisible();
    await expect(dialog.locator(".sharing-access-summary")).toHaveCount(1);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(warnings).toEqual([]);
    expect(await f.source()).toBe(
      "# Sharing regression\n\nKeep this note unchanged.\n",
    );
  } finally {
    release();
    await f.page.unroute(access);
    f.page.off("console", capture);
    await f.close();
  }
});
