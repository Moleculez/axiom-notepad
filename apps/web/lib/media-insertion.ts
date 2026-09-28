import { mediaMarkdown, type MediaMetadata } from "@axiom/markdown";
export type MediaInsertionOptions = {
  display: "link" | MediaMetadata["display"];
  alt: string;
  caption: string;
  label: string;
  width: number;
  align: "left" | "center" | "right";
  page: number;
  time: number;
};
export const defaultMediaOptions: MediaInsertionOptions = {
  display: "card",
  alt: "",
  caption: "",
  label: "",
  width: 100,
  align: "center",
  page: 1,
  time: 0,
};
export function mediaLink(name: string, href: string, image: boolean) {
  const label = name.replace(/[\\\[\]]/g, "\\$&").replace(/[\r\n]/g, " ");
  const url = href.replace(/[<>\r\n]/g, (c) => encodeURIComponent(c));
  return `${image ? "!" : ""}[${label}](<${url}>)`;
}
export function insertMediaMarkdown(
  name: string,
  href: string,
  mime: string,
  options: MediaInsertionOptions,
) {
  let target = href;
  if (mime === "application/pdf" && options.page > 1)
    target = href.split("#")[0] + `#page=${Math.floor(options.page)}`;
  if (/^(audio|video)\//.test(mime) && options.time > 0)
    target = href.split("#")[0] + `#t=${Math.floor(options.time)}`;
  const image =
    mime.startsWith("image/") &&
    options.display !== "link" &&
    options.display !== "card";
  const link = mediaLink(options.alt || name, target, image);
  if (options.display === "link") return link;
  if (
    options.display === "image" &&
    !options.caption &&
    options.width === 100 &&
    options.align === "center"
  )
    return link;
  return mediaMarkdown(
    link,
    {
      v: 1,
      display: options.display,
      ...(mime ? { mime } : {}),
      width: options.width,
      align: options.align,
      ...(options.display === "figure" && options.label
        ? {
            label: options.label.startsWith("fig-")
              ? options.label
              : `fig-${options.label}`,
          }
        : {}),
    },
    options.caption,
  );
}
