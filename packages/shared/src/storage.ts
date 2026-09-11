import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
const root = () =>
  resolve(
    /* turbopackIgnore: true */ process.env.STORAGE_PATH ??
      "./data/attachments",
  );
const s3 = () => new S3Client({ region: process.env.AWS_REGION, ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}) });
function validateKey(key: string) {
  if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error("Invalid storage key");
}
export async function putAttachment(
  key: string,
  data: Uint8Array,
  mime: string,
) {
  validateKey(key);
  if (process.env.STORAGE_DRIVER === "s3") {
    await s3().send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: data,
        ContentType: mime,
        IfNoneMatch: "*",
      }),
    );
    return;
  }
  await mkdir(root(), { recursive: true });
  await writeFile(join(root(), key), data, { flag: "wx", mode: 0o600 });
}
export async function getAttachment(key: string): Promise<Uint8Array> {
  validateKey(key);
  if (process.env.STORAGE_DRIVER === "s3") {
    const result = await s3().send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
    );
    if (!result.Body) throw new Error("Attachment missing");
    return result.Body.transformToByteArray();
  }
  return readFile(join(root(), key));
}

export async function removeAttachment(key: string) {
  validateKey(key);
  if (process.env.STORAGE_DRIVER === "s3")
    await s3().send(
      new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
    );
  else await unlink(/* turbopackIgnore: true */ join(root(), key));
}

export function attachmentMime(data: Uint8Array) {
  const buffer = Buffer.from(data);
  if (buffer.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    return "image/jpeg";
  if (/^GIF8[79]a$/.test(buffer.subarray(0, 6).toString())) return "image/gif";
  if (
    buffer.subarray(0, 4).toString() === "RIFF" &&
    buffer.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  return "application/octet-stream";
}
