import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { signInOwner } from "./auth";

export const origin =
  process.env.TEST_APP_URL || process.env.APP_URL || "http://localhost:8080";
let ownerState: Awaited<ReturnType<BrowserContext["storageState"]>>;
export async function fixture(browser: Browser, body: string) {
  const owner = await browser.newContext({
    baseURL: origin,
    extraHTTPHeaders: { "X-Axiom-Appearance-Schema": "5" },
    storageState: ownerState,
  });
  if (!ownerState) {
    const response = await signInOwner(owner.request, origin);
    expect(response.ok()).toBeTruthy();
    ownerState = await owner.storageState();
  }
  const post = async (path: string, data: unknown) => {
    const response = await owner.request.post("/api/v1/" + path, {
      headers: { origin },
      data,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const group = await post("groups", {
    name: "Native editor " + randomUUID().slice(0, 8),
  });
  const invitation = await post("invitations", {
    groupId: group.id,
    email: "native-" + randomUUID() + "@axiom.test",
  });
  const member = await browser.newContext({
    baseURL: origin,
    extraHTTPHeaders: { "X-Axiom-Appearance-Schema": "5" },
    serviceWorkers: "block",
  });
  const response = await member.request.post("/api/v1/register", {
    headers: { origin },
    data: {
      token: new URL(invitation.link).searchParams.get("invite"),
      name: "Native Researcher",
      password: "NativeEditorVerification2026!",
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const created = await member.request.post("/api/v1/notes", {
    headers: { origin },
    data: { groupId: group.id, title: "Native editor study", body },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const note = await created.json();
  const page = await member.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/workbench/notes/" + note.id);
  await expect(page.getByTestId("note-editor")).toBeVisible();
  await expect(page.locator(".ws-document-status")).toContainText(
    "Saved on server",
  );
  const source = async () =>
    (await (await member.request.get("/api/v1/notes/" + note.id)).json())
      .body as string;
  return {
    owner,
    member,
    page,
    note,
    group,
    source,
    errors,
    async close() {
      expect(errors).toEqual([]);
      await member.close();
      await owner.close();
    },
  };
}
export async function caret(locator: Locator, offset?: number) {
  await locator.evaluate((element, at) => {
    const root = element.closest<HTMLElement>("[data-testid='note-editor']")!;
    root.focus();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes: Node[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (
        !node.parentElement?.closest(
          '[data-native-ui], [contenteditable="false"]',
        )
      )
        nodes.push(node);
    let text = nodes.at(-1)!,
      offset = text.textContent!.length;
    if (at !== undefined) {
      let remaining = at;
      for (const node of nodes) {
        if (remaining <= node.textContent!.length) {
          text = node;
          offset = remaining;
          break;
        }
        remaining -= node.textContent!.length;
      }
    }
    const range = document.createRange();
    range.setStart(text, offset);
    range.collapse(true);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, offset);
}
export async function replaceSource(page: Page, source: string) {
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const editor = page.getByTestId("note-editor");
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await page.keyboard.insertText(source);
}
