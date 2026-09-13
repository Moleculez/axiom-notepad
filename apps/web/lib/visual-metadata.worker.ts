import { load } from "exifreader";
import { DOMParser, onErrorStopParsing } from "@xmldom/xmldom";
export type MetadataField = {
  group: string;
  name: string;
  value: string;
  sensitive: boolean;
};
const sensitive =
  /(gps|latitude|longitude|location|serial|owner|person|address|creator|author|artist|email|contact|usercomment|uniqueid|documentname)/i;
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    if (event.data.byteLength > 50 * 1024 * 1024)
      throw new Error("Metadata inspection is limited to 50 MB.");
    const tags = await load(event.data, {
      expanded: true,
      async: true,
      domParser: new DOMParser({ onError: onErrorStopParsing }),
      excludeTags: { thumbnail: true, mpf: true, makerNotes: true },
      decompress: { maxDecompressedSize: 2 * 1024 * 1024 },
    });
    const fields: MetadataField[] = [];
    for (const [group, entries] of Object.entries(tags)) {
      if (
        !entries ||
        typeof entries !== "object" ||
        ArrayBuffer.isView(entries)
      )
        continue;
      for (const [name, tag] of Object.entries(entries)) {
        if (
          name.startsWith("_") ||
          fields.length >= 1000 ||
          /^(Thumbnail|Images|ICC_Profile)$/i.test(name)
        )
          continue;
        const raw =
          tag && typeof tag === "object"
            ? "description" in tag
              ? tag.description
              : "value" in tag
                ? tag.value
                : tag
            : tag;
        let value = typeof raw === "string" ? raw : JSON.stringify(raw);
        if (!value) continue;
        value = value.slice(0, 4000);
        fields.push({
          group,
          name,
          value,
          sensitive: sensitive.test(group + " " + name),
        });
      }
    }
    self.postMessage({ fields });
  } catch (e) {
    self.postMessage({
      error: e instanceof Error ? e.message : "Metadata could not be decoded.",
    });
  }
};
