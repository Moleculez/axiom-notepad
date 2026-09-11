import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, statfs, link, unlink, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { attachmentMime } from "./storage";
import { detectPrefix, officeDirectoryType } from "./file-detection";
import { Upload } from "@aws-sdk/lib-storage";
export const storageRoot = () =>
  resolve(
    /* turbopackIgnore: true */ process.env.STORAGE_PATH ??
      "./data/attachments",
  );
const cloud = () => process.env.STORAGE_DRIVER === "s3";
const s3 = () =>
  new S3Client({
    region: process.env.AWS_REGION,
    ...(process.env.S3_ENDPOINT
      ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
      : {}),
  });
const bucket = () => process.env.S3_BUCKET;
function keyPath(key: string) {
  if (!/^[a-f0-9-]{36}$/.test(key))
    throw new Error("Invalid storage identity.");
  return join(/* turbopackIgnore: true */ storageRoot(), key);
}
function staging(uploadId: string) {
  keyPath(uploadId);
  return join(storageRoot(), ".uploads", uploadId);
}
export async function attachmentStream(
  key: string,
  range?: { start: number; end: number },
): Promise<Readable> {
  const file = keyPath(key);
  if (cloud()) {
    const result = await s3().send(
      new GetObjectCommand({
        Bucket: bucket(),
        Key: key,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }),
    );
    if (!result.Body) throw new Error("Stored file unavailable.");
    return result.Body as Readable;
  }
  await stat(/* turbopackIgnore: true */ file);
  return createReadStream(
    /* turbopackIgnore: true */ file,
    range ? { start: range.start, end: range.end } : {},
  );
}
export async function putAttachmentStream(
  key: string,
  stream: Readable,
  bytes: number,
  mime: string,
) {
  const file = keyPath(key);
  if (cloud()) {
    const params = {
      Bucket: bucket(),
      Key: key,
      Body: stream,
      ContentLength: bytes,
      ContentType: mime,
      IfNoneMatch: "*",
    };
    // Prepared ZIPs in a full backup may exceed S3's single-PUT limit.
    if (bytes > 5_000_000_000)
      await new Upload({
        client: s3(),
        params,
        queueSize: 2,
        partSize: 16 * 1024 * 1024,
        leavePartsOnError: false,
      }).done();
    else await s3().send(new PutObjectCommand(params));
  } else {
    await mkdir(storageRoot(), { recursive: true, mode: 0o700 });
    await pipeline(
      stream,
      createWriteStream(file, { flags: "wx", mode: 0o600 }),
    );
  }
}
export async function availableStorageBytes() {
  if (cloud()) return null;
  await mkdir(storageRoot(), { recursive: true, mode: 0o700 });
  const info = await statfs(storageRoot());
  return info.bavail * info.bsize;
}
/** ZIP64 exports can exceed a single S3 PUT and have no known compressed size. */
export async function putGeneratedStream(
  key: string,
  source: Readable,
  mime: string,
) {
  const file = keyPath(key),
    hash = createHash("sha256");
  let bytes = 0;
  const digest = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      hash.update(chunk);
      done(null, chunk);
    },
  });
  if (cloud()) {
    const upload = new Upload({
      client: s3(),
      params: {
        Bucket: bucket(),
        Key: key,
        Body: digest,
        ContentType: mime,
        IfNoneMatch: "*",
      },
      queueSize: 2,
      partSize: 16 * 1024 * 1024,
      leavePartsOnError: false,
    });
    try {
      await Promise.all([pipeline(source, digest), upload.done()]);
    } catch (error) {
      source.destroy();
      digest.destroy();
      await upload.abort().catch(() => {});
      throw error;
    }
  } else {
    await mkdir(storageRoot(), { recursive: true, mode: 0o700 });
    try {
      await pipeline(
        source,
        digest,
        createWriteStream(file, { flags: "wx", mode: 0o600 }),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST")
        await unlink(file).catch(() => {});
      throw error;
    }
  }
  return { bytes, sha256: hash.digest("hex") };
}
export async function startMultipart(key: string, uploadId: string) {
  keyPath(key);
  if (!cloud()) {
    await mkdir(staging(uploadId), { recursive: true, mode: 0o700 });
    return null;
  }
  const result = await s3().send(
    new CreateMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: "application/octet-stream",
      ChecksumAlgorithm: "SHA256",
    }),
  );
  if (!result.UploadId)
    throw new Error("Could not initialize object storage upload.");
  return result.UploadId;
}
export async function storeChunk(
  upload: { id: string; storage_key: string; multipart_id: string | null },
  part: number,
  data: Uint8Array,
  sha256: string,
) {
  if (!Number.isSafeInteger(part) || part < 1 || part > 120)
    throw new Error("Invalid upload part.");
  if (cloud()) {
    const result = await s3().send(
      new UploadPartCommand({
        Bucket: bucket(),
        Key: upload.storage_key,
        UploadId: upload.multipart_id!,
        PartNumber: part,
        Body: data,
        ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
      }),
    );
    return result.ETag ?? null;
  }
  await mkdir(staging(upload.id), { recursive: true, mode: 0o700 });
  const file = join(staging(upload.id), String(part));
  // This path contains only the validated upload identity and integer part. A
  // database lock serializes retries; incomplete staged parts are replaceable.
  await pipeline(
    Readable.from([data]),
    createWriteStream(file, { mode: 0o600 }),
  );
  return null;
}
export async function completeMultipart(
  upload: {
    id: string;
    storage_key: string;
    multipart_id: string | null;
    bytes: number;
  },
  chunks: { part: number; etag: string | null; sha256: string }[],
) {
  if (cloud()) {
    try {
      await s3().send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket(),
          Key: upload.storage_key,
          UploadId: upload.multipart_id!,
          MultipartUpload: {
            Parts: chunks.map((c) => ({
              PartNumber: c.part,
              ETag: c.etag!,
              ChecksumSHA256: Buffer.from(c.sha256, "hex").toString("base64"),
            })),
          },
        }),
      );
    } catch (error) {
      if ((error as Error).name !== "NoSuchUpload") throw error;
      const stored = await s3().send(
        new HeadObjectCommand({ Bucket: bucket(), Key: upload.storage_key }),
      );
      if (stored.ContentLength !== Number(upload.bytes)) throw error;
    }
    return;
  }
  const destination = keyPath(upload.storage_key);
  try {
    if (
      (await stat(/* turbopackIgnore: true */ destination)).size ===
      Number(upload.bytes)
    )
      return;
    throw new Error("Completed file size mismatch.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temp = join(staging(upload.id), "assembled");
  const source = Readable.from(
    (async function* () {
      for (const chunk of chunks)
        for await (const data of createReadStream(
          join(staging(upload.id), String(chunk.part)),
        ))
          yield data;
    })(),
  );
  await pipeline(source, createWriteStream(temp, { mode: 0o600 }));
  if ((await stat(temp)).size !== Number(upload.bytes))
    throw new Error("Assembled file size mismatch.");
  await link(temp, destination); // Immutable publish; never overwrite another object.
  await unlink(temp);
}
export async function verifyStoredFile(key: string, name: string) {
  const hash = createHash("sha256");
  let bytes = 0,
    prefix = Buffer.alloc(0);
  for await (const chunk of await attachmentStream(key)) {
    const data = Buffer.from(chunk);
    bytes += data.length;
    hash.update(data);
    if (prefix.length < 65536)
      prefix = Buffer.concat([prefix, data.subarray(0, 65536 - prefix.length)]);
  }
  const mime = await detectStoredMime(key, name, bytes, prefix);
  return { sha256: hash.digest("hex"), bytes, mime };
}
async function readRange(key: string, start: number, end: number) {
  const chunks: Buffer[] = [];
  for await (const chunk of await attachmentStream(key, { start, end }))
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
const detected = new Map<string, string>();
export async function detectStoredMime(
  key: string,
  name: string,
  bytes: number,
  initial?: Buffer,
) {
  const cacheKey = key + ":" + name;
  if (detected.has(cacheKey)) return detected.get(cacheKey)!;
  const prefix =
    initial ??
    (bytes
      ? await readRange(key, 0, Math.min(bytes, 65536) - 1)
      : Buffer.alloc(0));
  let mime = attachmentMime(prefix);
  if (mime === "application/octet-stream")
    mime = await detectPrefix(prefix, name);
  if (
    prefix.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])) &&
    /\.(docx|pptx|xlsx)$/i.test(name) &&
    bytes >= 22
  ) {
    const tail = await readRange(key, Math.max(0, bytes - 65557), bytes - 1);
    for (let i = tail.length - 22; i >= 0; i--) {
      if (
        tail.readUInt32LE(i) !== 0x06054b50 ||
        i + 22 + tail.readUInt16LE(i + 20) !== tail.length
      )
        continue;
      const size = tail.readUInt32LE(i + 12),
        offset = tail.readUInt32LE(i + 16);
      if (
        size > 0 &&
        size <= 2_000_000 &&
        offset + size <= bytes &&
        !tail.readUInt16LE(i + 4)
      ) {
        const directory = await readRange(key, offset, offset + size - 1);
        mime = officeDirectoryType(directory) ?? "application/zip";
      }
      break;
    }
  }
  if (detected.size >= 1000) detected.clear();
  detected.set(cacheKey, mime);
  return mime;
}
export async function clearUploadStaging(
  upload: { id: string; storage_key: string; multipart_id: string | null },
  abort = false,
) {
  if (cloud()) {
    if (abort && upload.multipart_id) {
      try {
        await s3().send(
          new AbortMultipartUploadCommand({
            Bucket: bucket(),
            Key: upload.storage_key,
            UploadId: upload.multipart_id,
          }),
        );
      } catch (error) {
        if ((error as Error).name !== "NoSuchUpload") throw error;
      }
    }
    return;
  }
  const directory = staging(upload.id);
  let files: string[];
  try {
    files = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const name of files)
    if (/^(?:[1-9]\d{0,2}|assembled)$/.test(name))
      await unlink(join(directory, name)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
}
export function parseByteRange(
  header: string | null,
  bytes: number,
): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || bytes <= 0) return "invalid";
  let start: number, end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, bytes - suffix);
    end = bytes - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), bytes - 1) : bytes - 1;
  }
  return Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    start < bytes &&
    end >= start
    ? { start, end }
    : "invalid";
}
export async function fileResponse(
  request: Request,
  file: {
    storage_key: string;
    bytes: number;
    mime: string;
    name: string;
    sha256: string;
  },
  download = false,
) {
  const bytes = Number(file.bytes),
    range = parseByteRange(request.headers.get("range"), bytes);
  const headers: Record<string, string> = {
    "cache-control": "private, no-store",
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox; default-src 'none'",
    "content-type": file.mime,
    "content-disposition": `${download || file.mime === "application/octet-stream" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
  };
  if (range === "invalid")
    return new Response(null, {
      status: 416,
      headers: { ...headers, "content-range": `bytes */${bytes}` },
    });
  headers["content-length"] = String(
    range ? range.end - range.start + 1 : bytes,
  );
  if (range)
    headers["content-range"] = `bytes ${range.start}-${range.end}/${bytes}`;
  return new Response(
    request.method === "HEAD"
      ? null
      : (Readable.toWeb(
          await attachmentStream(file.storage_key, range ?? undefined),
        ) as ReadableStream<Uint8Array>),
    { status: range ? 206 : 200, headers },
  );
}
