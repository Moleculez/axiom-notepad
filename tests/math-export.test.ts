import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyMathImage,
  mathClipboardPlan,
  mathImageBlob,
} from "../apps/web/lib/tools/math-export";
import { rasterizeSvg } from "../apps/web/lib/tools/download";

vi.mock("../apps/web/lib/tools/download", () => ({
  rasterizeSvg: vi.fn(
    async (_svg, _scale, _background, mime) =>
      new Blob(["pixels"], { type: mime }),
  ),
}));
const settings = {
  foreground: "#172033",
  background: "#ffffff",
  transparent: true,
  scale: 3,
};
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><path d="M0 0L20 20"/></svg>';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("equation image clipboard and download contracts", () => {
  it.each([
    ["svg", false, "text/plain"],
    ["svg", true, "image/svg+xml"],
    ["jpeg", false, "image/png"],
    ["jpeg", true, "image/jpeg"],
    ["png", false, "image/png"],
  ] as const)(
    "chooses an honest %s clipboard format (native supported: %s)",
    (format, supported, mime) => {
      const plan = mathClipboardPlan(format, () => supported);
      expect(plan.mime).toBe(mime);
      if (format === "jpeg" && !supported)
        expect(plan.notice).toContain("cannot copy JPG");
      if (format === "svg" && !supported)
        expect(plan.notice).toContain("markup");
    },
  );
  it("keeps a real SVG file and never rasterizes vector downloads", async () => {
    const image = await mathImageBlob(svg, "svg", settings);
    expect(image.type).toBe("image/svg+xml");
    expect(await image.text()).toBe(svg);
    expect(rasterizeSvg).not.toHaveBeenCalled();
  });
  it("preserves PNG transparency but always supplies paper for JPEG", async () => {
    await mathImageBlob(svg, "png", settings);
    expect(rasterizeSvg).toHaveBeenLastCalledWith(
      svg,
      3,
      undefined,
      "image/png",
    );
    await mathImageBlob(svg, "jpeg", settings);
    expect(rasterizeSvg).toHaveBeenLastCalledWith(
      svg,
      3,
      "#ffffff",
      "image/jpeg",
    );
    await mathImageBlob(svg, "png", { ...settings, transparent: false });
    expect(rasterizeSvg).toHaveBeenLastCalledWith(
      svg,
      3,
      "#ffffff",
      "image/png",
    );
  });
  it("copies SVG markup without requiring an image clipboard API", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("ClipboardItem", undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyMathImage(svg, "svg", settings)).toContain(
      "markup copied",
    );
    expect(writeText).toHaveBeenCalledExactlyOnceWith(svg);
  });
  it("starts clipboard write before the image promise resolves", async () => {
    let finish!: (blob: Blob) => void;
    vi.mocked(rasterizeSvg).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    class Item {
      static supports(mime: string) {
        return mime === "image/png";
      }
      constructor(public data: Record<string, Blob | Promise<Blob>>) {}
    }
    const write = vi.fn(async (items: Item[]) => {
      const image = items[0].data["image/png"];
      expect(image).toBeInstanceOf(Promise);
      await image;
    });
    vi.stubGlobal("ClipboardItem", Item);
    vi.stubGlobal("navigator", { clipboard: { write } });
    const copied = copyMathImage(svg, "jpeg", settings);
    expect(write).toHaveBeenCalledTimes(1);
    expect(rasterizeSvg).toHaveBeenLastCalledWith(
      svg,
      3,
      "#ffffff",
      "image/png",
    );
    finish(new Blob(["pixels"], { type: "image/png" }));
    expect(await copied).toContain("Download keeps JPG");
  });
  it("copies native vector data and plain markup in the same clipboard item", async () => {
    class Item {
      static supports() {
        return true;
      }
      constructor(public data: Record<string, Blob | Promise<Blob>>) {}
    }
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("ClipboardItem", Item);
    vi.stubGlobal("navigator", { clipboard: { write } });
    await copyMathImage(svg, "svg", settings);
    const item: Item = write.mock.calls[0][0][0];
    expect(Object.keys(item.data)).toEqual(["image/svg+xml", "text/plain"]);
    expect(await (await item.data["image/svg+xml"]).text()).toBe(svg);
  });
  it("surfaces clipboard denial instead of reporting success or auto-downloading", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi
          .fn()
          .mockRejectedValue(new DOMException("Denied", "NotAllowedError")),
      },
    });
    await expect(copyMathImage(svg, "svg", settings)).rejects.toMatchObject({
      name: "NotAllowedError",
    });
  });
  it("offers download guidance when clipboard access is unavailable", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    vi.stubGlobal("navigator", {});
    await expect(copyMathImage(svg, "png", settings)).rejects.toThrow(
      "Use Download",
    );
    await expect(copyMathImage(svg, "svg", settings)).rejects.toThrow(
      "Use Download SVG",
    );
  });
});
