import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, expect, type APIRequestContext } from "@playwright/test";
import { APPEARANCE_SCHEMA } from "../../packages/shared/src/appearance";

const origin = process.env.DOCS_APP_URL ?? "http://localhost:3004";
if (origin !== "http://localhost:3004" || process.env.NODE_ENV === "production")
  throw new Error(
    "Documentation capture requires isolated local staging on port 3004, never a working instance.",
  );
const output = "docs/assets/showcase";
await mkdir(output, { recursive: true });
await mkdir("data/documentation-showcase", { recursive: true });
await mkdir("apps/web/public/brand", { recursive: true });
const browser = await chromium.launch();
async function api(
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = data ? "POST" : "GET",
) {
  const response = await request.fetch(`/api/v1/${path}`, {
    method,
    data,
    headers: { origin },
  });
  if (!response.ok())
    throw new Error(
      `${method} ${path}: ${response.status()} ${await response.text()}`,
    );
  return response.json();
}
const contextOptions = {
  baseURL: origin,
  viewport: { width: 1600, height: 1040 },
  deviceScaleFactor: 1,
  serviceWorkers: "block" as const,
  extraHTTPHeaders: { "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA) },
};
const owner = await browser.newContext(contextOptions);
try {
  const signedIn = await owner.request.post("/api/auth/sign-in/email", {
    headers: { origin },
    data: {
      email: process.env.TEST_OWNER_EMAIL ?? "researcher@axiom.local",
      password: process.env.TEST_OWNER_PASSWORD ?? "AxiomResearch2026!",
    },
  });
  if (!signedIn.ok())
    throw new Error(
      "Sign in to the isolated staging owner failed. Configure TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD; do not seed the working instance.",
    );
  const group = await api(owner.request, "groups", {
    name: "Spectral Lab",
    description:
      "Fictional demonstration workspace for the Axiom documentation.",
  });
  async function researcher(name: string) {
    const invitation = await api(owner.request, "invitations", {
      groupId: group.id,
      email: `${randomUUID()}@axiom.test`,
    });
    const context = await browser.newContext(contextOptions);
    await api(context.request, "register", {
      token: new URL(invitation.link).searchParams.get("invite"),
      name,
      password: randomUUID() + "Aa1!",
    });
    return context;
  }
  const member = await researcher("Mira Chen"),
    colleague = await researcher("Elias Ray");
  const space = (await api(member.request, "spaces")).find(
    (s: { kind: string; group_id: string }) =>
      s.kind === "team" && s.group_id === group.id,
  );
  const body = `A working note on learning from structure, linking mathematical intuition to reproducible experiments. See [[Diffusion experiments|our experiment notebook]].

## A shared representation

Let the graph encode relationships between observations. A useful representation should preserve local structure while remaining stable under small perturbations.

$$
L_{\\mathrm{sym}} = I - D^{-1/2} A D^{-1/2}, \\qquad L u_k = \\lambda_k u_k.
$$

> [!note] Research question
> Which spectral features transfer when the graph changes?

## From theory to evidence

| Representation | Signal | Next step |
| --- | --- | --- |
| Laplacian eigenvectors | Global geometry | Check stability |
| Diffusion coordinates | Local neighborhoods | Compare scales |
| Learned features | Task structure | Measure transfer |

Keep the assumptions visible. Record seeds, parameter choices and failed trials alongside the result.

## Reproducible protocol

- [x] Define the graph and normalization
- [x] Save the baseline configuration
- [ ] Compare results across random seeds

\`\`\`python
laplacian = identity - d_inv @ adjacency @ d_inv
values, vectors = eigh(laplacian)
embedding = vectors[:, 1:9]
\`\`\`

## Discussion

Compare the assumptions before comparing the metrics. These values and people are fictional demonstration content.
`;
  const note = await api(member.request, "notes", {
    groupId: group.id,
    title: "Spectral graph methods",
    body,
  });
  const evidence = await api(member.request, "notes", {
    groupId: group.id,
    title: "Diffusion experiments",
    body: "## Evidence notebook\n\nKeep assumptions, measurements and interpretation together.\n\n- Fixed random seeds\n- Versioned configurations\n- Shared review notes\n\n**Next:** compare neighborhood preservation across scales.",
  });
  const canvas = await api(member.request, "files/new", {
    type: "canvas",
    name: "Connected evidence",
    spaceId: space.id,
    mutationId: randomUUID(),
    source: JSON.stringify({
      schemaVersion: 1,
      nodes: [
        {
          id: "question",
          type: "text",
          title: "The question",
          x: 20,
          y: 20,
          width: 310,
          height: 210,
          color: "#216c78",
          text: "## What should transfer?\n\nPreserve the structure that matters, even when observations change.\n\n**Hypothesis** · local geometry is the signal.",
        },
        {
          id: "operator",
          type: "text",
          title: "Mathematical model",
          x: 440,
          y: 20,
          width: 340,
          height: 210,
          text: "## A common language\n\n$$\nL = I - D^{-1/2} A D^{-1/2}\n$$\n\nConnect the model to explicit assumptions.",
        },
        {
          id: "experiment",
          type: "text",
          title: "Reproducible protocol",
          x: 440,
          y: 345,
          width: 340,
          height: 215,
          color: "#627c9f",
          text: "## Test the idea\n\n- Fix seeds and normalization\n- Compare diffusion scales\n- Record unsuccessful trials\n\n**Review together.** Keep the evidence attached.",
        },
        {
          id: "evidence",
          type: "file",
          title: "Shared evidence",
          x: 20,
          y: 345,
          width: 310,
          height: 215,
          file: "Diffusion experiments",
          resourceId: evidence.id,
        },
      ],
      edges: [
        {
          id: "model",
          fromNode: "question",
          fromSide: "right",
          toNode: "operator",
          toSide: "left",
          label: "formalize",
        },
        {
          id: "test",
          fromNode: "operator",
          fromSide: "bottom",
          toNode: "experiment",
          toSide: "top",
          label: "test",
        },
        {
          id: "record",
          fromNode: "experiment",
          fromSide: "left",
          toNode: "evidence",
          toSide: "right",
          label: "record",
        },
        {
          id: "refine",
          fromNode: "evidence",
          fromSide: "top",
          toNode: "question",
          toSide: "bottom",
          label: "refine",
          color: "#216c78",
        },
      ],
    }),
  });
  const page = await member.newPage(),
    peer = await colleague.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await peer.goto(`/workbench/notes/${note.id}`);
  await expect(peer.getByTestId("note-editor")).toBeVisible();
  for (const mode of ["light", "dark"] as const) {
    const bundle = await api(member.request, "me/preferences-bundle");
    await api(
      member.request,
      "me/preferences-bundle",
      {
        editor: bundle.editor,
        appearance: {
          version: bundle.appearance.version,
          preferences: {
            ...bundle.appearance.preferences,
            mode,
            themePack: "default",
            proseSize: 18,
            lineHeight: 1.7,
            readingWidth: 70,
            minimap: {
              ...bundle.appearance.preferences.minimap,
              enabled: true,
              width: 90,
              slider: "always",
            },
          },
        },
        mutationId: randomUUID(),
      },
      "PATCH",
    );
    await page.goto(`/workbench/notes/${note.id}`);
    await expect(page.getByTestId("note-editor")).toBeVisible();
    await expect(page.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
    await expect(
      page.locator(".axiom-prose mjx-container").first(),
    ).toBeVisible();
    if (mode === "light") {
      await page
        .locator(".editor-mount .axiom-prose p")
        .filter({ hasText: "Let the graph encode" })
        .hover();
      await page
        .getByRole("button", { name: "Paragraph reading actions", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "Add annotation", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Annotation title", exact: true })
        .fill("Check the assumptions");
      await page.getByTestId("annotation-editor").click();
      await page.keyboard.insertText(
        "Compare the normalized and unnormalized operators before interpreting the embedding. Keep the graph construction fixed.",
      );
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Share annotation", exact: true }),
      ).toBeEnabled();
    } else {
      await page
        .getByRole("button", { name: "bookmarks panel", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Annotations", exact: true })
        .click();
      await page
        .locator(".annotation-list-card")
        .filter({ hasText: "Check the assumptions" })
        .click();
    }
    await page.mouse.move(1550, 1000);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `${output}/editor-${mode}.png`,
      animations: "disabled",
    });
    await page.goto(`/workbench/canvas/${canvas.id}`);
    await expect(page.locator(".canvas-status")).toContainText(
      "Saved on server",
    );
    await expect(page.locator(".canvas-card")).toHaveCount(4);
    await expect(
      page.locator(".canvas-card mjx-container").first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Zoom to fit", exact: true })
      .click();
    await page.mouse.move(1550, 1000);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `${output}/canvas-${mode}.png`,
      animations: "disabled",
    });
  }
  expect((await api(member.request, `notes/${note.id}`)).body).toBe(body);
  expect(errors).toEqual([]);
  await writeFile(
    "data/documentation-showcase/latest.json",
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        group: group.id,
        note: note.id,
        canvas: canvas.id,
        origin,
      },
      null,
      2,
    ),
  );
  const layout = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  });
  const art = await layout.newPage();
  for (const mode of ["light", "dark"] as const) {
    await art.goto(
      pathToFileURL(resolve("docs/assets/banner.html")).href + `?theme=${mode}`,
    );
    await art.evaluate(() => document.fonts.ready);
    await expect(art.locator("img")).toHaveCount(3);
    expect(
      await art
        .locator("img")
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete &&
              (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    ).toBe(true);
    await art.screenshot({ path: `${output}/banner-${mode}.png` });
  }
  await art.setViewportSize({ width: 1200, height: 630 });
  await art.goto(
    pathToFileURL(resolve("docs/assets/banner.html")).href + "?social=1",
  );
  await art.evaluate(() => document.fonts.ready);
  await art.screenshot({ path: `${output}/social-preview.png` });
  await writeFile(
    "apps/web/public/brand/social-preview.png",
    await readFile(`${output}/social-preview.png`),
  );
  console.log(
    "Captured fictional editor/Canvas views, light/dark banners and social preview. Private workspace receipt: data/documentation-showcase/latest.json",
  );
} finally {
  await browser.close();
}
