import { S3Client } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";

type Entry = { key: string; client: S3Client; users: number; retired: boolean };
let current: Entry | undefined;

/** One cached client per process. Configuration replacement retires the old
 * pool only after its active operations/streams finish. Credentials remain the
 * SDK's normal refreshable provider chain; no secrets enter the cache key. */
export async function withStorageS3Client<T>(
  work: (client: S3Client) => Promise<T>,
): Promise<T> {
  const region = process.env.AWS_REGION;
  const endpoint = process.env.S3_ENDPOINT || undefined;
  const key = JSON.stringify([region ?? null, endpoint ?? null]);
  if (!current || current.key !== key) {
    retireStorageClient();
    current = {
      key,
      client: new S3Client({
        region,
        ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      }),
      users: 0,
      retired: false,
    };
  }
  const entry = current;
  entry.users++;
  let released = false;
  let stream: Readable | undefined;
  const release = () => {
    if (released) return;
    released = true;
    stream?.removeListener("end", release);
    stream?.removeListener("close", release);
    stream?.removeListener("error", release);
    entry.users--;
    if (entry.retired && !entry.users) entry.client.destroy();
  };
  try {
    const value = await work(entry.client);
    if (value instanceof Readable && !value.destroyed && !value.readableEnded) {
      stream = value;
      stream.once("end", release);
      stream.once("close", release);
      stream.once("error", release);
    }
    return value;
  } finally {
    if (!stream) release();
  }
}

/** Safe for graceful shutdown and isolated tests; never interrupts a stream. */
export function retireStorageClient() {
  if (!current) return;
  const previous = current;
  current = undefined;
  previous.retired = true;
  if (!previous.users) previous.client.destroy();
}
