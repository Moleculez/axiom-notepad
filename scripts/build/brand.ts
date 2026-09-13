import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { brandColors, brandSvg } from "../../packages/shared/src/brand";

await mkdir("docs/assets/brand", { recursive: true });
await mkdir("apps/web/public/brand", { recursive: true });
for (const [name, color] of [
  ["mark-ink", brandColors.ink],
  ["mark-paper", brandColors.paper],
  ["mark-mineral", brandColors.mineral],
] as const) {
  const svg = brandSvg({ color });
  await writeFile(`docs/assets/brand/${name}.svg`, svg);
  await sharp(Buffer.from(svg))
    .resize(512, 512)
    .png()
    .toFile(`docs/assets/brand/${name}.png`);
}
const tile = brandSvg({
  tile: true,
  color: brandColors.paper,
  background: brandColors.ink,
});
await writeFile("apps/web/public/icon.svg", tile);
for (const size of [32, 180, 192, 512])
  await sharp(Buffer.from(tile))
    .resize(size, size)
    .png()
    .toFile(`apps/web/public/brand/icon-${size}.png`);
console.log(
  "Exported original SVG marks, transparent PNGs and 32/180/192/512px application icons.",
);
