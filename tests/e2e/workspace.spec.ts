import { test, expect } from "@playwright/test";

test("research workspace signs in and renders its live editor", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/auth.png", fullPage: true });
  await page.getByLabel("Email address").fill("researcher@axiom.local");
  await page
    .getByLabel("Password", { exact: false })
    .fill("AxiomResearch2026!");
  for (let attempt = 0; attempt < 2; attempt++) {
    const signedIn = page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/sign-in/email"),
    );
    await page.getByRole("button", { name: "Enter workspace" }).click();
    const response = await signedIn;
    if (response.status() !== 429) {
      expect(response.ok(), await response.text()).toBeTruthy();
      break;
    }
    // Exercise the real UI and respect the shared production auth rate limit.
    await page.waitForTimeout(
      Math.min(
        60,
        Math.max(1, Number(response.headers()["retry-after"] ?? 60)),
      ) *
        1000 +
        100,
    );
  }
  await expect(
    page.getByRole("navigation", { name: "App navigation" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/overview.png", fullPage: true });
  await expect(page).toHaveURL(/\/workbench\/home/);
  const spaces = await (await page.request.get("/api/v1/spaces")).json();
  const personal = spaces.find((space: any) => space.kind === "personal");
  const response = await page.request.post("/api/v1/resources", {
    headers: { origin: new URL(page.url()).origin },
    data: {
      spaceId: personal.id,
      kind: "note",
      name: "Release smoke check",
      body: "# Research workspace\n\nA live document.",
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const note = await response.json();
  await page.goto(`/workbench/notes/${note.id}`);
  await expect(page.getByTestId("note-editor")).toBeVisible();
  await expect(
    page.getByText("Saved on server", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/editor.png", fullPage: true });
  expect(errors).toEqual([]);
});
