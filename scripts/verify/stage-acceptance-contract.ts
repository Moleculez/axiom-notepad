import { createHash } from "node:crypto";

export const acceptanceBrowsers = ["chromium", "firefox", "webkit"] as const;
export const acceptanceScaleCases = [
  "planning-5000",
  "portfolio-100000",
  "capacity-100000",
] as const;
export const acceptancePhases = [
  "preflight",
  "static",
  "planning-sql",
  "assistant-sql",
  "runtime",
  "scale",
] as const;
export type AcceptancePhase = (typeof acceptancePhases)[number];
export type AcceptanceState =
  "not-run" | "running" | "passed" | "failed" | "blocked";
export type PhaseReceipt = {
  state: AcceptanceState;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  artifact?: string;
};
export type StageAcceptanceReceipt = {
  format: "axiom-stage-acceptance";
  version: 1;
  startedAt: string;
  finishedAt?: string;
  source: { commit: string; fingerprint: string; dirty: boolean };
  environment: {
    node: string;
    platform: string;
    architecture: string;
    postgresClients?: string[];
  };
  browsers: string[];
  phases: Record<AcceptancePhase, PhaseReceipt>;
  software: "pending" | "passed" | "failed" | "blocked";
  acceptance: "pending-operator-review";
  baseline: "7cd2cc5";
  scope: string;
};

/** No ambient data, provider, proxy, preload or cloud credentials cross the boundary. */
export function acceptanceEnvironment(
  input: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV: "development",
  };
  for (const key of [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SystemRoot",
    "LANG",
    "LC_ALL",
    "TERM",
    "CI",
    "PG_BIN",
  ])
    if (input[key] !== undefined) env[key] = input[key];
  return env;
}

export function parseAcceptanceArguments(args: string[]) {
  let help = false,
    preflightOnly = false;
  const browsers: string[] = [];
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--preflight-only") preflightOnly = true;
    else if (arg.startsWith("--project=")) {
      const name = arg.slice("--project=".length);
      if (!(acceptanceBrowsers as readonly string[]).includes(name))
        throw new Error("Choose chromium, firefox or webkit.");
      if (!browsers.includes(name)) browsers.push(name);
    } else throw new Error(`Unknown acceptance argument: ${arg}`);
  }
  return {
    help,
    preflightOnly,
    browsers: browsers.length ? browsers : [...acceptanceBrowsers],
  };
}

export function emptyAcceptancePhases(): Record<AcceptancePhase, PhaseReceipt> {
  return Object.fromEntries(
    acceptancePhases.map((p) => [p, { state: "not-run" }]),
  ) as Record<AcceptancePhase, PhaseReceipt>;
}
export function acceptanceSoftwareState(
  phases: Record<AcceptancePhase, PhaseReceipt>,
  browsers: string[] = [...acceptanceBrowsers],
): StageAcceptanceReceipt["software"] {
  const states = acceptancePhases.map((p) => phases[p].state);
  if (states.includes("failed")) return "failed";
  if (states.includes("blocked")) return "blocked";
  return states.every((s) => s === "passed") &&
    acceptanceBrowsers.every((b) => browsers.includes(b))
    ? "passed"
    : "pending";
}
export function isAcceptanceEnvironmentError(error: unknown) {
  const e = error as { code?: string; message?: string; name?: string };
  return (
    e?.name === "AbortError" ||
    ["EPERM", "EACCES", "EADDRINUSE", "ENOENT", "EEXIST"].includes(
      e?.code ?? "",
    ) ||
    /Operation not permitted|Cannot reserve isolated port|not installed|missing browser|missing PostgreSQL|older than the test server|Node 24 is required|Acceptance interrupted/i.test(
      e?.message ?? "",
    )
  );
}
export function p95(samples: number[]) {
  if (!samples.length || samples.some((s) => !Number.isFinite(s) || s < 0))
    throw new Error("Timing samples must be nonempty, finite and nonnegative.");
  return [...samples].sort((a, b) => a - b)[
    Math.ceil(samples.length * 0.95) - 1
  ];
}
export function compareScaleSamples(baseline: number[], candidate: number[]) {
  if (baseline.length !== 20 || candidate.length !== 20)
    throw new Error(
      "Scale acceptance requires twenty measurements per source after three warmups.",
    );
  const before = p95(baseline),
    after = p95(candidate);
  if (before <= 0)
    throw new Error("A zero baseline cannot establish a regression budget.");
  const ratio = after / before;
  return {
    baselineP95: before,
    candidateP95: after,
    ratio,
    passed: ratio <= 1.2,
  };
}
export function codeFingerprint(files: { path: string; bytes: Uint8Array }[]) {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(JSON.stringify([file.path, file.bytes.byteLength]));
    hash.update(file.bytes);
  }
  return hash.digest("hex");
}

export const requiredRecoveryTables = [
  "notes",
  "documents",
  "document_updates",
  "snapshots",
  "attachments",
  "tasks",
  "planning_fields",
  "planning_field_values",
  "planning_time",
  "planning_time_history",
  "planning_automations",
  "planning_automation_runs",
  "planning_automation_events",
  "assistant_conversations",
  "assistant_contexts",
  "tool_jobs",
  "assistant_runs",
  "assistant_run_reviews",
  "assistant_run_steps",
  "workspace_change_sets",
  "workspace_change_actions",
] as const;
export function assertPopulatedRecovery(counts: Record<string, number>) {
  const empty = requiredRecoveryTables.filter(
    (t) => !Number.isSafeInteger(counts[t]) || counts[t] < 1,
  );
  if (empty.length)
    throw new Error(
      `Paired recovery lacks populated coverage: ${empty.join(", ")}. Empty-table comparisons are not acceptance.`,
    );
}
