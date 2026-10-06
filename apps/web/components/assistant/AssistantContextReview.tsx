"use client";
import { useEffect, useRef, useState } from "react";
import type { AssistantContextReview as ContextReview } from "@axiom/shared/assistant-grounding";
import {
  Button,
  Checkbox,
  Field,
  HelpText,
  Notice,
  TextInput,
} from "../ui/controls";
import Dialog, { DialogFooter } from "../Dialog";
import { post } from "../../lib/client";
import { ErrorNotice, useData } from "../workspace/ui";

export default function AssistantContextReview({
  runId,
  legacyFingerprint,
  onClose,
  onChange,
}: {
  runId: string;
  legacyFingerprint?: string;
  onClose: () => void;
  onChange: () => void;
}) {
  const data = useData<ContextReview | { legacy: true; message: string }>(
    `assistant/runs/${runId}/review`,
  );
  const value = data.data && "fingerprint" in data.data ? data.data : null;
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [excluded, setExcluded] = useState<string[]>([]),
    [ranges, setRanges] = useState<
      Record<string, { from: string; to: string }>
    >({});
  const receipt = useRef(crypto.randomUUID());
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setConsent(false);
    setExcluded([]);
    setRanges({});
    receipt.current = crypto.randomUUID();
  }, [value?.fingerprint]);
  const changed = excluded.length > 0 || Object.keys(ranges).length > 0;
  const expired = !!value && Date.parse(value.expiresAt) <= now;
  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const refresh = () =>
    run(async () => {
      const excerpts = Object.entries(ranges)
        .filter(([key]) => !excluded.includes(key))
        .map(([key, range]) => ({
          key,
          from: range.from.trim() === "" ? NaN : Number(range.from),
          to: range.to.trim() === "" ? NaN : Number(range.to),
        }));
      if (
        excerpts.some(
          (e) =>
            !Number.isInteger(e.from) ||
            !Number.isInteger(e.to) ||
            e.from < 0 ||
            e.to <= e.from,
        )
      )
        throw new Error("Enter a valid, nonempty character range.");
      await post(`assistant/runs/${runId}/review/refresh`, {
        fingerprint: value?.fingerprint ?? legacyFingerprint,
        excludeKeys: excluded,
        excerpts,
      });
      setConsent(false);
      data.reload();
      onChange();
    });
  return (
    <Dialog
      wide
      title="Review next outgoing batch"
      subtitle={
        value
          ? `${value.provider.name} · ${value.provider.model} · round ${value.ordinal} of ${value.budget.maxRounds}`
          : "Private local context"
      }
      className="assistant-context-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <ErrorNotice message={error || data.error} />
      <Notice tone="info">
        This batch has not been sent. Approval sends only the exact messages
        shown below. Workspace changes still require separate review.
      </Notice>
      {!value && (
        <HelpText>
          {data.loading
            ? "Loading captured context…"
            : data.data && "message" in data.data
              ? data.data.message
              : "The review could not be loaded."}
        </HelpText>
      )}
      {value && (
        <>
          <dl className="assistant-review-summary">
            <div>
              <dt>Outgoing</dt>
              <dd>{value.characters.toLocaleString()} / 60,000 characters</dd>
            </div>
            <div>
              <dt>New excerpts</dt>
              <dd>
                {value.newEvidenceKeys.length} · {value.spaceIds.length}{" "}
                selected workspace(s)
              </dd>
            </div>
            <div>
              <dt>Output ceiling</dt>
              <dd>
                {value.budget.maxOutputTokens.toLocaleString()} tokens for this
                call
              </dd>
            </div>
            <div>
              <dt>Requests so far</dt>
              <dd>
                {value.usage.requests} · input{" "}
                {value.usage.inputTokens ?? "unknown"}, output{" "}
                {value.usage.outputTokens ?? "unknown"} tokens
              </dd>
            </div>
          </dl>
          <HelpText>
            Expires {new Date(value.expiresAt).toLocaleTimeString()}. Monetary
            cost is not configured; provider billing and retention apply.
          </HelpText>
          {expired && (
            <Notice tone="warning">
              This receipt expired. Refresh the preview and approve again;
              nothing will be submitted automatically.
            </Notice>
          )}
          {!!value.newEvidenceKeys.length && (
            <section
              aria-label="Newly captured evidence"
              className="assistant-review-excerpts"
            >
              <h3>New evidence · captured locally</h3>
              {value.evidence
                .filter((e) => value.newEvidenceKeys.includes(e.key))
                .map((e) => (
                  <details key={e.key}>
                    <summary>
                      {e.title}
                      {e.locator ? " · " + e.locator : ""}
                    </summary>
                    <HelpText>
                      Captured {new Date(e.capturedAt).toLocaleString()} ·{" "}
                      {e.source.length.toLocaleString()} characters · {e.kind}
                    </HelpText>
                    <label className="assistant-consent">
                      <Checkbox
                        checked={!excluded.includes(e.key)}
                        disabled={busy || value.state !== "pending"}
                        onChange={(event) => {
                          setExcluded((old) =>
                            event.target.checked
                              ? old.filter((key) => key !== e.key)
                              : [...old, e.key],
                          );
                          setConsent(false);
                        }}
                      />
                      Include this new excerpt
                    </label>
                    <pre className="assistant-excerpt">{e.source}</pre>
                    {["document", "office"].includes(e.kind) && (
                      <div className="assistant-review-range">
                        <Field label="From character (0-based)">
                          <TextInput
                            type="number"
                            min={0}
                            max={e.source.length - 1}
                            step={1}
                            disabled={
                              busy ||
                              excluded.includes(e.key) ||
                              value.state !== "pending"
                            }
                            value={ranges[e.key]?.from ?? "0"}
                            onChange={(event) => {
                              setRanges((old) => ({
                                ...old,
                                [e.key]: {
                                  from: event.target.value,
                                  to: old[e.key]?.to ?? String(e.source.length),
                                },
                              }));
                              setConsent(false);
                            }}
                          />
                        </Field>
                        <Field label="To character (exclusive)">
                          <TextInput
                            type="number"
                            min={1}
                            max={e.source.length}
                            step={1}
                            disabled={
                              busy ||
                              excluded.includes(e.key) ||
                              value.state !== "pending"
                            }
                            value={ranges[e.key]?.to ?? String(e.source.length)}
                            onChange={(event) => {
                              setRanges((old) => ({
                                ...old,
                                [e.key]: {
                                  from: old[e.key]?.from ?? "0",
                                  to: event.target.value,
                                },
                              }));
                              setConsent(false);
                            }}
                          />
                        </Field>
                      </div>
                    )}
                  </details>
                ))}
            </section>
          )}
          <section
            className="assistant-outgoing"
            aria-label="Exact outgoing messages"
          >
            <h3>Complete outgoing context</h3>
            {value.messages.map((m, i) => (
              <details key={i}>
                <summary>
                  {i + 1} ·{" "}
                  {m.role === "system"
                    ? "Application instructions"
                    : m.role === "assistant"
                      ? "Previous model output"
                      : "Request, history or local evidence"}
                </summary>
                <pre>{m.content}</pre>
              </details>
            ))}
          </section>
        </>
      )}
      <DialogFooter>
        {value?.state === "pending" && (
          <label className="assistant-consent">
            <Checkbox
              checked={consent}
              disabled={busy || changed || expired}
              onChange={(event) => setConsent(event.target.checked)}
            />
            I approve this exact batch and output limit for this provider. This
            does not approve later calls.
          </label>
        )}
        <Button type="button" onClick={onClose} disabled={busy}>
          Close review
        </Button>
        <Button
          type="button"
          disabled={busy}
          pending={busy}
          onClick={() => void refresh()}
        >
          {changed ? "Update preview" : "Refresh preview"}
        </Button>
        {value && (
          <Button
            type="button"
            variant="primary"
            disabled={
              busy ||
              !consent ||
              changed ||
              expired ||
              value.state !== "pending"
            }
            pending={busy}
            onClick={() =>
              void run(async () => {
                await post(`assistant/runs/${runId}/review/approve`, {
                  fingerprint: value.fingerprint,
                  consent: true,
                  mutationId: receipt.current,
                });
                onChange();
                onClose();
              })
            }
          >
            Send this batch
          </Button>
        )}
        {data.error && (
          <Button type="button" onClick={data.reload} disabled={busy}>
            Retry loading
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
