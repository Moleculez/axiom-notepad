/** Deterministic, loopback-only provider for isolated 3004 acceptance. Never a deployed service. */
import { createServer } from "node:http";
import { assistantTaskSchema } from "../../packages/shared/src/assistant";
let calls = 0;
const server = createServer(async (req, res) => {
  if (req.url === "/calls") {
    res.end(JSON.stringify({ calls }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    res.writeHead(404).end();
    return;
  }
  if (req.headers.authorization !== "Bearer assistant-fixture-token") {
    res.writeHead(401).end();
    return;
  }
  let body = "";
  for await (const c of req) {
    body += c;
    if (body.length > 1_000_000) {
      res.writeHead(413).end();
      return;
    }
  }
  calls++;
  const parsed = JSON.parse(body),
    last = JSON.parse(parsed.messages.at(-1).content),
    e = last.evidence[0];
  const proposals: unknown[] = [];
  if (/propos|draft/i.test(last.request)) {
    for (const item of last.evidence.filter((v: any) => v.editable)) {
      if (item.kind === "document")
        proposals.push({
          kind: "document",
          evidenceKey: item.key,
          source:
            item.source + "\n\nAssumptions must be verified experimentally.\n",
          explanation: "Make the verification boundary explicit.",
        });
      if (item.kind === "task")
        proposals.push({
          kind: "task-update",
          evidenceKey: item.key,
          fields: {
            ...item.task,
            title: item.task.title + " — reviewed",
            priority: "high",
          },
          explanation: "Prioritize the reviewed experiment.",
        });
    }
    if (last.allowTaskCreate)
      proposals.push({
        kind: "task-create",
        fields: assistantTaskSchema.parse({
          title: "Verify the research assumptions",
          body: "Review the source and reproduce the result.",
          status: "todo",
          priority: "normal",
          assigneeId: null,
          labels: ["research"],
          estimateHours: 2,
        }),
        explanation: "A private proposed follow-up, not an executed action.",
      });
  }
  const answer = `## Evidence and interpretation\n\nThe selected material supports a preliminary comparison${e ? ` [[${e.key}]]` : ""}. **Verify the assumptions** before drawing a conclusion.\n\nFor a simple model, $E=mc^2$ describes the stated relationship; this is an explanation, not formal verification.\n\n- Check the source conditions.\n- Record limitations and uncertainty.\n- Reproduce the result independently.`;
  const content = /malformed/i.test(last.request)
    ? "A plain answer with no executable actions."
    : JSON.stringify({ answer, proposals: proposals.slice(0, 5) });
  if (/slow/i.test(last.request)) await new Promise((r) => setTimeout(r, 6000));
  if (/disconnect/i.test(last.request)) {
    req.socket.destroy();
    return;
  }
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content } }],
      usage: { prompt_tokens: 123, completion_tokens: 45 },
    }),
  );
});
server.listen(8096, "127.0.0.1", () =>
  console.log(
    "Isolated assistant fixture on 127.0.0.1:8096. No external AI requests.",
  ),
);
process.on("SIGTERM", () => server.close());
process.on("SIGINT", () => server.close());
