import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../apps/web/lib/client", () => ({ api: f.api }));
import {
  readUploadStatuses,
  uploadStatusLabel,
  verificationWaitMessage,
} from "../apps/web/lib/upload-status";
beforeEach(() => vi.resetAllMocks());
describe("upload status reads", () => {
  it("reads exact active IDs in bounded batches, even beyond the recent feed", async () => {
    f.api.mockResolvedValue([{ status: "complete" }]);
    const result = await readUploadStatuses(
      Array.from({ length: 201 }, (_, i) => String(i)),
      new AbortController().signal,
    );
    expect(f.api).toHaveBeenCalledTimes(3);
    expect(
      f.api.mock.calls.map(([path]) => path.split("=")[1].split(",").length),
    ).toEqual([100, 100, 1]);
    expect(f.api.mock.calls[2][0]).toBe("uploads?ids=200");
    expect(result).toHaveLength(3);
    expect(f.api.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it("does not fetch after its account/unmount signal aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readUploadStatuses(["id"], controller.signal),
    ).rejects.toThrow();
    expect(f.api).not.toHaveBeenCalled();
  });
  it("propagates a read failure instead of inventing a terminal upload state", async () => {
    f.api.mockRejectedValue(new Error("Network down"));
    await expect(
      readUploadStatuses(["id"], new AbortController().signal),
    ).rejects.toThrow("Network down");
  });
  it("aborts status requests on a bounded deadline", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      f.api.mockResolvedValue([]);
      await readUploadStatuses(["id"], new AbortController().signal);
      expect(timeout).toHaveBeenCalledWith(15_000);
    } finally {
      timeout.mockRestore();
    }
  });
});
describe("honest verification feedback", () => {
  it("distinguishes queued, running, retry and lost jobs", () => {
    expect(
      uploadStatusLabel({ status: "verifying", verification_state: "queued" }),
    ).toContain("waiting");
    expect(
      uploadStatusLabel({ status: "verifying", verification_state: "running" }),
    ).toContain("Verifying");
    expect(
      uploadStatusLabel({
        status: "verifying",
        verification_state: "retrying",
      }),
    ).toContain("retry scheduled");
    expect(
      uploadStatusLabel({
        status: "verifying",
        verification_state: "unavailable",
      }),
    ).toContain("recheck");
    expect(uploadStatusLabel({ status: "complete" })).toBe("complete");
  });
  it("explains waiting without declaring a slow running job failed", () => {
    const now = Date.now();
    const item = {
      status: "verifying",
      updated_at: new Date(now - 60_000).toISOString(),
    };
    expect(
      verificationWaitMessage({ ...item, verification_state: "queued" }, now),
    ).toContain("restart the workspace worker");
    expect(
      verificationWaitMessage({ ...item, verification_state: "running" }, now),
    ).toBe("");
    expect(
      verificationWaitMessage(
        {
          ...item,
          verification_state: "queued",
          updated_at: new Date(now).toISOString(),
        },
        now,
      ),
    ).toBe("");
    expect(
      verificationWaitMessage(
        { ...item, status: "complete", verification_state: "queued" },
        now,
      ),
    ).toBe("");
  });
});
