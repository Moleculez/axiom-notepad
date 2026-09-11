import { expect, test, type BrowserContext } from "@playwright/test";
import { signInOwner } from "../e2e/auth";

const origin = "http://localhost:8080";
let cookies: Awaited<ReturnType<BrowserContext["cookies"]>>;
let groupId: string;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ baseURL: origin });
  try {
    const login = await signInOwner(context.request, origin);
    expect(
      login.status(),
      "Use the existing account; never seed live data",
    ).toBe(200);
    cookies = await context.cookies();
    const response = await context.request.get("/api/v1/me");
    expect(response.ok()).toBe(true);
    const session = (await response.json()) as {
      groups: { id: string; role: string }[];
    };
    const group = session.groups.find((item) =>
      ["owner", "admin"].includes(item.role),
    );
    expect(group, "An existing administrable group is required").toBeDefined();
    groupId = group!.id;
  } finally {
    await context.close();
  }
});

test.beforeEach(async ({ context, page }) => {
  await context.addCookies(cookies);
  // Filtering must not update group membership, research content or preferences.
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      await route.abort("blockedbyclient");
      throw new Error(
        `Empty-state smoke refused a ${request.method()} mutation`,
      );
    }
    await route.continue();
  });
});

for (const section of ["members", "invitations", "activity", "people"]) {
  test(`8080 renders the ${section} empty state without invalid HTML nesting`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(
      section === "people"
        ? "/workbench/people"
        : `/workbench/admin/${groupId}/${section}`,
    );
    await page
      .getByRole("textbox", {
        name: section === "people" ? "Search researchers" : `Search ${section}`,
      })
      .fill("__axiom_empty_state_regression_no_match__");

    const empty = page.locator(".ws-empty");
    await expect(
      empty.getByRole("heading", {
        name: `No matching ${section === "people" ? "researchers" : section}`,
      }),
    ).toBeVisible();
    expect(errors).toEqual([]);
    const description = empty.locator(":scope > .ws-empty-description");
    await expect(description).toHaveText(
      section === "people"
        ? "Try another name or research topic."
        : "Try another filter or clear the search.",
    );
    await expect(empty.locator("p p, p div, p ul, p ol")).toHaveCount(0);
    if (section !== "people") {
      await expect(description.locator(":scope > p")).toHaveCount(1);
    }
  });
}
