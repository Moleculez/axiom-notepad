import sharp from "sharp";
import { brandColors, brandSvg } from "@axiom/shared/brand";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ size: string }> },
) {
  const { size } = await params;
  if (!["180.png", "192.png", "512.png"].includes(size))
    return new Response("Icon unavailable", { status: 404 });
  const width = Number(size.split(".")[0]);
  const svg = brandSvg({
    tile: true,
    color: brandColors.paper,
    background: brandColors.ink,
  });
  return new Response(
    new Uint8Array(
      await sharp(Buffer.from(svg)).resize(width, width).png().toBuffer(),
    ),
    {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=86400",
      },
    },
  );
}
