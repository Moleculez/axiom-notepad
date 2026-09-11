import { parseMarkdown, documentStatistics } from "@axiom/markdown";
self.onmessage = (
  event: MessageEvent<{ source: string; selection: string; version: number }>,
) => {
  const { source, selection, version } = event.data;
  self.postMessage({
    version,
    statistics: documentStatistics(parseMarkdown(source), source),
    selected: selection
      ? documentStatistics(parseMarkdown(selection), selection)
      : null,
  });
};
