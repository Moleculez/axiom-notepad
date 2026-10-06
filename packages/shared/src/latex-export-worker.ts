import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { ZipFile } from "yazl";
import sharp from "sharp";
import type pg from "pg";
import { attachmentStream, availableStorageBytes } from "./storage-streams";
import { getAttachment } from "./storage";
import { publicationSvg } from "./site-svg";
import { HttpError } from "./access";
import { authorizeLatexDependencies } from "./latex-export-api";
import type { LatexPreview, LatexOptions } from "./latex-export";

export type FrozenLatexExport = {
  preview: LatexPreview;
  options: LatexOptions;
  diagrams: { from: number; sha256: string; png: string }[];
};
export function validateDiagramPayload(
  preview: LatexPreview,
  diagrams: FrozenLatexExport["diagrams"],
) {
  let bytes = 0;
  const seen = new Set<number>();
  for (const raster of diagrams) {
    const expected = preview.diagrams.find((d) => d.from === raster.from);
    if (
      !expected ||
      expected.sha256 !== raster.sha256 ||
      seen.has(raster.from) ||
      !/^[A-Za-z\d+/]*={0,2}$/.test(raster.png)
    )
      throw new HttpError(
        400,
        "A diagram does not belong to this reviewed source snapshot.",
      );
    seen.add(raster.from);
    const data = Buffer.from(raster.png, "base64");
    bytes += data.length;
    if (bytes > 20 * 1024 * 1024)
      throw new HttpError(
        413,
        "Diagram rasters exceed the 20 MiB project limit.",
      );
    if (
      !data
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw new HttpError(400, "Diagram exports accept PNG rasters only.");
  }
}
async function verifiedAsset(
  key: string,
  expected: { bytes: number; sha256: string },
) {
  const source = await attachmentStream(key),
    hash = createHash("sha256");
  let bytes = 0;
  const check = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
    flush(callback) {
      callback(
        bytes === expected.bytes && hash.digest("hex") === expected.sha256
          ? null
          : new Error("An original asset failed its immutable checksum check."),
      );
    },
  });
  source.on("error", (error) => check.destroy(error));
  check.on("close", () => source.destroy());
  return source.pipe(check);
}
export async function buildLatexBundle(
  client: pg.PoolClient,
  userId: string,
  frozen: FrozenLatexExport,
) {
  const { preview } = frozen;
  await authorizeLatexDependencies(userId, preview);
  validateDiagramPayload(preview, frozen.diagrams);
  const estimate =
    preview.assets.reduce((n, a) => n + a.bytes * (a.figurePath ? 2 : 1), 0) +
    Object.values(preview.files).reduce(
      (n, value) => n + Buffer.byteLength(value),
      0,
    ) +
    64 * 1024 * 1024;
  const free = await availableStorageBytes();
  if (
    estimate > 100_000_000_000 ||
    (free !== null && free < estimate + 256 * 1024 * 1024)
  )
    throw new Error(
      "Not enough available space to safely prepare this manuscript archive.",
    );
  const diagnostics = [...preview.diagnostics];
  // Complete bounded conversions before opening the ZIP stream, so errors cannot
  // leave an unconsumed producer or a ready archive with a hidden missing figure.
  const converted = new Map<string, Buffer>();
  let convertedBytes = 0;
  const addConverted = (path: string, data: Buffer) => {
    convertedBytes += data.length;
    if (convertedBytes > 64 * 1024 * 1024)
      throw new Error(
        "Converted figures exceed the 64 MiB project memory budget. Split this manuscript export or use PNG/JPEG originals.",
      );
    converted.set(path, data);
  };
  for (const diagram of preview.diagrams) {
    const raster = frozen.diagrams.find((d) => d.from === diagram.from);
    if (raster) {
      const png = await sharp(Buffer.from(raster.png, "base64"), {
        limitInputPixels: 16_000_000,
        animated: false,
      })
        .png()
        .toBuffer();
      addConverted(diagram.path, png);
    } else
      diagnostics.push({
        code: "diagram-unavailable",
        from: diagram.from,
        to: diagram.to,
        severity: "warning",
        message:
          "Diagram could not be rasterized; its complete source remains in code/.",
      });
  }
  const { rows } = await client.query(
    "SELECT id,storage_key FROM attachments WHERE id=ANY($1::uuid[])",
    [preview.assets.map((a) => a.id)],
  );
  const keys = new Map(rows.map((r) => [r.id, r.storage_key]));
  if (keys.size !== preview.assets.length)
    throw new Error(
      "An attached version disappeared. Refresh the manuscript export.",
    );
  for (const asset of preview.assets)
    if (asset.figurePath?.endsWith(".png") && asset.mime !== "image/png") {
      let data = await getAttachment(keys.get(asset.id));
      if (
        data.length !== asset.bytes ||
        createHash("sha256").update(data).digest("hex") !== asset.sha256
      )
        throw new Error("A conversion source failed its checksum check.");
      if (asset.mime === "image/svg+xml") data = publicationSvg(data);
      addConverted(
        asset.figurePath,
        await sharp(data, { limitInputPixels: 16_000_000, animated: false })
          .png()
          .toBuffer(),
      );
      if (asset.mime === "image/gif")
        diagnostics.push({
          code: "animated-image",
          from: 0,
          to: 0,
          severity: "warning",
          message: `${asset.name}: only the first GIF frame is used in the paper; the original animation is retained.`,
        });
    }
  const zip = new ZipFile(),
    output = zip.outputStream as Readable;
  zip.on("error", (error) => output.destroy(error));
  for (const [path, body] of Object.entries(preview.files))
    zip.addBuffer(Buffer.from(body), path);
  for (const [path, bytes] of converted) zip.addBuffer(bytes, path);
  for (const asset of preview.assets) {
    const paths = [
      asset.originalPath,
      ...(asset.figurePath && !converted.has(asset.figurePath)
        ? [asset.figurePath]
        : []),
    ];
    for (const path of paths)
      zip.addReadStreamLazy(
        path,
        { size: asset.bytes, compress: false },
        (callback) => {
          void verifiedAsset(keys.get(asset.id), asset).then(
            (stream) => callback(null, stream),
            (error) => callback(error, Readable.from([])),
          );
        },
      );
  }
  zip.addBuffer(
    Buffer.from(
      JSON.stringify(
        {
          format: "axiom-latex-project",
          version: 1,
          noteId: preview.noteId,
          generation: preview.generation,
          sourceHash: preview.sourceHash,
          reviewFingerprint: preview.fingerprint,
          options: frozen.options,
          citationMap: preview.citationMap,
          references: preview.references.map((r) => ({
            key: r.cite_key,
            identity: r.identity,
            version: r.version,
            sha256: createHash("sha256")
              .update(r.bibtex ?? JSON.stringify(r))
              .digest("hex"),
          })),
          assets: preview.assets,
          diagnostics,
          createdAt: new Date().toISOString(),
          scope:
            "One frozen Markdown note and its authorized immutable dependencies; not an account backup",
        },
        null,
        2,
      ),
    ),
    "export-manifest.json",
  );
  zip.end({
    forceZip64Format: true,
    comment: "Axiom editable research manuscript",
  });
  return {
    output,
    requiredIds: [
      ...new Set([preview.noteId, ...preview.assets.map((a) => a.resourceId)]),
    ],
  };
}
