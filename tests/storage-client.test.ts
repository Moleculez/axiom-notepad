import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import {
  withStorageS3Client,
  retireStorageClient,
} from "../packages/shared/src/storage-client";

const fixture = vi.hoisted(() => ({
  clients: [] as { config: unknown; destroy: ReturnType<typeof vi.fn> }[],
}));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    destroy = vi.fn();
    constructor(public config: unknown) {
      fixture.clients.push(this);
    }
  },
}));
beforeEach(() => {
  retireStorageClient();
  fixture.clients.length = 0;
  vi.stubEnv("AWS_REGION", "us-west-2");
  vi.stubEnv("S3_ENDPOINT", "");
});
afterEach(() => {
  retireStorageClient();
  vi.unstubAllEnvs();
});
describe("shared S3 client ownership", () => {
  it("reuses one connection pool without pinning credential values", async () => {
    const first = await withStorageS3Client(async (client) => client);
    expect(await withStorageS3Client(async (client) => client)).toBe(first);
    expect(fixture.clients).toHaveLength(1);
    expect(fixture.clients[0].config).toEqual({ region: "us-west-2" });
    expect(fixture.clients[0].destroy).not.toHaveBeenCalled();
  });
  it("replaces changed region/endpoint settings and disposes an idle prior pool", async () => {
    await withStorageS3Client(async () => undefined);
    vi.stubEnv("S3_ENDPOINT", "https://storage.example.test");
    await withStorageS3Client(async () => undefined);
    expect(fixture.clients).toHaveLength(2);
    expect(fixture.clients[0].destroy).toHaveBeenCalledOnce();
    expect(fixture.clients[1].config).toEqual({
      region: "us-west-2",
      endpoint: "https://storage.example.test",
      forcePathStyle: true,
    });
  });
  it("does not destroy an old pool while an operation is in flight", async () => {
    let finish!: () => void;
    const inFlight = withStorageS3Client(
      () =>
        new Promise<void>((done) => {
          finish = done;
        }),
    );
    vi.stubEnv("AWS_REGION", "eu-west-1");
    await withStorageS3Client(async () => undefined);
    expect(fixture.clients[0].destroy).not.toHaveBeenCalled();
    finish();
    await inFlight;
    expect(fixture.clients[0].destroy).toHaveBeenCalledOnce();
  });
  it("retains a streaming body until end/close rather than disposing after headers", async () => {
    const stream = new PassThrough();
    expect(await withStorageS3Client(async () => stream)).toBe(stream);
    retireStorageClient();
    expect(fixture.clients[0].destroy).not.toHaveBeenCalled();
    stream.end("fixture content");
    stream.resume();
    await finished(stream);
    expect(fixture.clients[0].destroy).toHaveBeenCalledOnce();
    expect(stream.listenerCount("end")).toBeLessThan(2);
  });
  it("releases failed operations and cancelled streaming bodies exactly once", async () => {
    await expect(
      withStorageS3Client(async () => {
        throw new Error("fixture failure");
      }),
    ).rejects.toThrow("fixture failure");
    const stream = new PassThrough();
    await withStorageS3Client(async () => stream);
    retireStorageClient();
    stream.destroy();
    await finished(stream).catch(() => {});
    expect(fixture.clients[0].destroy).toHaveBeenCalledOnce();
  });
});
