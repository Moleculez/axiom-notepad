import { definePlugin } from "@axiom/plugin-sdk";

type Snapshot = { title: string; source: string; hash: string; format: string };
export default definePlugin({
  async run(api, context) {
    if (!context.resourceId) {
      await api.render({
        title: "Saved document summary",
        blocks: [
          {
            kind: "notice",
            tone: "info",
            text: "Open a Markdown note, then run this command again. This example never changes a file.",
          },
        ],
      });
      return;
    }
    const snapshot = await api.request<Snapshot>("documents.read", {
      resourceId: context.resourceId,
    });
    if (snapshot.format !== "markdown") {
      await api.render({
        title: "Saved document summary",
        blocks: [
          {
            kind: "notice",
            tone: "info",
            text: "This example supports Markdown snapshots only.",
          },
        ],
      });
      return;
    }
    const words = snapshot.source.trim().split(/\s+/u).filter(Boolean).length;
    const headings = snapshot.source
      .split("\n")
      .filter((line) => /^#{1,6} +/.test(line)).length;
    await api.render({
      title: snapshot.title,
      blocks: [
        {
          kind: "text",
          text: "Approximate counts from the saved source, not unsynchronized editor content. Fenced code is included.",
        },
        {
          kind: "table",
          columns: ["Words", "Heading-like lines"],
          rows: [[String(words), String(headings)]],
        },
        {
          kind: "link",
          label: "Return to this snapshot",
          target: {
            resourceId: context.resourceId,
            line: 1,
            expectedHash: snapshot.hash,
          },
        },
      ],
    });
  },
});
