/** Explicit two-step, synthetic-only provider acceptance. Never loads .env. */
import { readFile, writeFile, mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import {
  prepareLiveAcceptance,
  validateLiveAcceptance,
  liveUsageCost,
} from "../../packages/shared/src/assistant-live-acceptance";
import {
  callAssistantProvider,
  sealCredential,
  providerEndpoint,
} from "../../packages/shared/src/tool-providers";
import { parseAssistantResponse } from "../../packages/shared/src/assistant";
import { assistantGroundingReport } from "../../packages/shared/src/assistant-grounding";

const [command, ...args] = process.argv.slice(2);
const option = (name: string) =>
  args.find((v) => v.startsWith("--" + name + "="))?.slice(name.length + 3);
const required = (name: string) => {
  const v = option(name);
  if (!v) throw new Error("Missing --" + name + "=value");
  return v;
};
if (!command || command === "--help") {
  console.log(`Synthetic-only live provider acceptance (no .env is loaded):
  prepare --provider-id=LABEL --kind=private|openrouter --endpoint=https://HOST/v1/ --model=MODEL --budget-usd=LIMIT --input-usd-per-million=RATE --output-usd-per-million=RATE --out=PREVIEW.json
  run --preview=PREVIEW.json --fingerprint=HASH --provider-budget-confirmed=LIMIT --consent --retention-acknowledged
Set AXIOM_LIVE_PROVIDER_CREDENTIAL explicitly for run. Private endpoints also require TOOL_PROVIDER_ALLOWED_ORIGINS.
Preparation does not call a provider. Inspect the complete saved messages before run.
One call, 1,024 output tokens. Configured prices are estimates, not enforced billing.
Configure a real provider-side spending limit first; charges and provider retention cannot be certified by this runner.`);
} else if (command === "prepare") {
  const review = prepareLiveAcceptance({
    providerId: required("provider-id"),
    kind: required("kind"),
    endpoint: required("endpoint"),
    model: required("model"),
    budgetUsd: Number(required("budget-usd")),
    inputUsdPerMillion: Number(required("input-usd-per-million")),
    outputUsdPerMillion: Number(required("output-usd-per-million")),
  });
  const path = resolve(required("out"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(review, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    "No request sent. Review " +
      path +
      "; approval fingerprint " +
      review.fingerprint,
  );
} else if (command === "run") {
  if (!args.includes("--consent") || !args.includes("--retention-acknowledged"))
    throw new Error(
      "Explicit content consent and provider-retention acknowledgement are required.",
    );
  const path = resolve(required("preview"));
  const stat = await import("node:fs/promises").then((fs) => fs.stat(path));
  if (stat.size > 100_000) throw new Error("Preview is too large.");
  const review = validateLiveAcceptance(
    JSON.parse(await readFile(path, "utf8")),
    required("fingerprint"),
    Number(required("provider-budget-confirmed")),
  );
  if (!process.env.AXIOM_LIVE_PROVIDER_CREDENTIAL)
    throw new Error(
      "Set an explicit live acceptance credential; application credentials are never loaded.",
    );
  const endpoint = providerEndpoint(
    review.provider.kind,
    review.provider.endpoint,
  );
  if (endpoint.href !== new URL(review.provider.endpoint).href)
    throw new Error(
      "The actual provider endpoint differs from the reviewed endpoint.",
    );
  // Exclusive durable claim makes repeating this command unable to repeat billing.
  const receipt = path + ".receipt.json";
  const claim = await open(receipt, "wx", 0o600);
  await claim.writeFile(
    JSON.stringify({
      fingerprint: review.fingerprint,
      state: "uncertain",
      message:
        "Dispatch reserved. Inspect provider records before any new request.",
    }),
  );
  await claim.sync();
  const previousKey = process.env.TOOL_PROVIDER_KEY;
  process.env.TOOL_PROVIDER_KEY = randomBytes(32).toString("base64");
  try {
    const response = await callAssistantProvider(
      {
        ...review.provider,
        credential: sealCredential(process.env.AXIOM_LIVE_PROVIDER_CREDENTIAL),
      },
      review.messages,
      AbortSignal.timeout(100000),
      { maxOutputTokens: review.maxOutputTokens },
    );
    const evidence = JSON.parse(review.messages[1].content).evidence;
    const parsed = parseAssistantResponse(response.text, evidence, false),
      grounding = assistantGroundingReport(parsed.answer, evidence);
    const result = {
      fingerprint: review.fingerprint,
      state: "complete",
      usage: response.usage,
      estimatedCostUsd: liveUsageCost(response.usage, review.provider),
      budgetUsd: review.provider.budgetUsd,
      grounding,
      warning: parsed.warning,
      answer: parsed.answer,
      boundary:
        "Synthetic transport/model sample only; not certification of billing, retention, proof correctness or full app acceptance.",
    };
    await claim.truncate(0);
    await claim.write(JSON.stringify(result, null, 2), 0, "utf8");
    await claim.sync();
    console.log("Completed one synthetic call. Receipt: " + receipt);
  } catch {
    console.error(
      "Provider outcome is uncertain. No automatic retry. Receipt: " + receipt,
    );
    process.exitCode = 1;
  } finally {
    await claim.close();
    if (previousKey === undefined) delete process.env.TOOL_PROVIDER_KEY;
    else process.env.TOOL_PROVIDER_KEY = previousKey;
  }
} else
  throw new Error(
    "Choose prepare or run; use --help for the explicit review flow.",
  );
