import sharp from "sharp";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ size: string }> },
) {
  const { size } = await params;
  if (!["192.png", "512.png"].includes(size))
    return new Response("Icon unavailable", { status: 404 });
  const width = Number(size.split(".")[0]);
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#334d64"/><path d="M316 185c-20-24-82-27-114 13-35 44-35 91-11 111 30 25 67 8 91-30l-17 48h43l35-142h-40l-8 28c-7-17-22-28-37-28-26 0-54 28-64 68-8 34-1 52 19 52 30 0 62-54 65-81l8-39z" fill="#f8fafc"/></svg>';
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
