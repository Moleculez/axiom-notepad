import { test, expect } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { fixture, origin } from "./native-editor-helpers";
import { mutationTestTarget } from "../../packages/shared/src/test-target";

// SQL faults are injected only into the registered isolated staging dataset.
const target = mutationTestTarget(process.env, process.env.AXIOM_TEST_ROOT);
test("lost/terminal verification jobs recover without re-uploading or duplicating files", async ({
  browser,
}) => {
  const f = await fixture(browser, "Verification recovery\n\n");
  const database = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });
  await database.connect();
  try {
    expect(
      (await database.query("SELECT current_database() AS name")).rows[0].name,
    ).toBe(target.databaseName);
    const api = async (path: string, data?: unknown) => {
      const response = await f.member.request.fetch("/api/v1/" + path, {
        method: data === undefined ? "GET" : "POST",
        data,
        headers: { origin },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json();
    };
    const spaceId = (await api("resources/" + f.note.id)).space_id;
    for (const state of ["missing", "done", "failed"] as const) {
      const id = randomUUID(),
        bytes = Buffer.from("Retained upload parts: " + state);
      await api("uploads", {
        id,
        spaceId,
        name: `recovered-${state}.txt`,
        bytes: bytes.length,
      });
      const chunk = await f.member.request.put(
        `/api/v1/uploads/${id}/chunks/1`,
        {
          headers: { origin, "content-type": "application/octet-stream" },
          data: bytes,
        },
      );
      expect(chunk.ok()).toBeTruthy();
      // Model a crash between status/enqueue or a terminal dedupe from a prior
      // attempt; no normal worker can claim this newly prepared fixture yet.
      await database.query("UPDATE upload_sessions SET status=$2 WHERE id=$1", [
        id,
        state === "failed" ? "failed" : "verifying",
      ]);
      if (state !== "missing")
        await database.query(
          "INSERT INTO workspace_jobs(kind,dedupe_key,payload,status,attempts) VALUES('complete-upload',$1,$2,$3,5)",
          ["upload:" + id, JSON.stringify({ id }), state],
        );
      const listed = await api(`uploads?ids=${id}`);
      expect(listed[0].status).toBe(
        state === "failed" ? "failed" : "verifying",
      );
      if (state !== "failed")
        expect(listed[0].verification_state).toBe("unavailable");
      await api(`uploads/${id}/complete`, {});
      await expect
        .poll(async () => (await api(`uploads/${id}`)).status, {
          timeout: 45_000,
        })
        .toBe("complete");
      const completed = await api(`uploads/${id}`);
      const rechecked = await api(`uploads/${id}/complete`, {});
      expect(rechecked).toMatchObject({
        status: "complete",
        resourceId: completed.resourceId,
        versionId: completed.versionId,
      });
      const versions = await api(`files/${completed.resourceId}/versions`);
      expect(versions).toHaveLength(1);
      expect(versions[0].sha256).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
      const jobs = (
        await database.query(
          "SELECT attempts FROM workspace_jobs WHERE dedupe_key=$1",
          ["upload:" + id],
        )
      ).rows;
      expect(jobs).toHaveLength(1);
      expect(jobs[0].attempts).toBe(1);
    }
  } finally {
    await database.end();
    await f.close();
  }
});

test("resumed verification survives a failed status read and refreshes Explorer after reload", async ({
  browser,
}, info) => {
  const f = await fixture(browser, "Upload status recovery\n\n");
  try {
    const id = randomUUID(),
      fileId = randomUUID(),
      versionId = randomUUID();
    const transfer = {
      id,
      space_id: randomUUID(),
      parent_id: null,
      name: "retained-paper.pdf",
      bytes: "1024",
      received: "1024",
      status: "verifying",
      verification_state: "queued",
      updated_at: new Date(Date.now() - 60_000).toISOString(),
    };
    let polls = 0,
      finished = false,
      rechecks = 0,
      refreshes = 0;
    f.page.on("request", (r) => {
      if (finished && /\/api\/v1\/spaces(?:\?|$)/.test(r.url())) refreshes++;
    });
    await f.page.route(/\/api\/v1\/uploads(?:\?|$)/, async (route) => {
      if (new URL(route.request().url()).searchParams.has("ids")) {
        if (++polls === 1) {
          await route.fulfill({
            status: 503,
            json: { error: "Temporary outage" },
          });
          return;
        }
      }
      await route.fulfill({
        json: [
          finished
            ? {
                ...transfer,
                status: "complete",
                completed_resource_id: fileId,
                completed_version_id: versionId,
              }
            : transfer,
        ],
      });
    });
    await f.page.route(`**/api/v1/uploads/${id}/complete`, async (route) => {
      rechecks++;
      finished = true;
      await route.fulfill({ status: 202, json: { status: "verifying" } });
    });
    await f.page.reload();
    await f.page
      .getByRole("button", { name: "Activity & recovery", exact: true })
      .click();
    const activity = f.page.getByRole("region", {
      name: "Activity & recovery",
    });
    await expect(
      activity.getByText("retained-paper.pdf", { exact: true }),
    ).toBeVisible();
    await expect(activity).toContainText("Could not check verification");
    await expect(activity).toContainText("workspace worker");
    await expect.poll(() => polls).toBeGreaterThanOrEqual(2);
    await expect(activity).not.toContainText("Could not check verification");
    await f.page.screenshot({
      path: info.outputPath("verification-waiting.png"),
    });
    await activity
      .getByRole("button", { name: "Recheck retained-paper.pdf", exact: true })
      .click();
    await expect(
      activity.getByRole("button", {
        name: "Open retained-paper.pdf",
        exact: true,
      }),
    ).toBeVisible();
    expect(rechecks).toBe(1);
    await expect.poll(() => refreshes).toBeGreaterThan(0);
    await f.page.screenshot({
      path: info.outputPath("verification-complete.png"),
    });
  } finally {
    await f.close();
  }
});
