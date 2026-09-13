import { versionDiff } from "@axiom/shared/version-diff";
import { versionDiffRows } from "@axiom/shared/version-diff-rows";
import { versionDiffBlocks } from "@axiom/shared/version-diff-blocks";
import { parseMarkdown } from "@axiom/markdown";
self.onmessage = (
  event: MessageEvent<{
    id: number;
    before: string;
    after: string;
    format: string;
  }>,
) => {
  const { id, before, after, format } = event.data;
  try {
    const beforeParsed =
      format === "markdown" && before.length <= 200_000
        ? parseMarkdown(before)
        : null;
    const afterParsed =
      format === "markdown" && after.length <= 200_000
        ? parseMarkdown(after)
        : null;
    self.postMessage({
      id,
      diff: versionDiff(before, after),
      rows: versionDiffRows(before, after),
      beforeParsed,
      afterParsed,
      blocks:
        beforeParsed && afterParsed
          ? versionDiffBlocks(before, beforeParsed, after, afterParsed)
          : [],
    });
  } catch (e) {
    self.postMessage({ id, error: (e as Error).message });
  }
};
