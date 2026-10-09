"use client";
import { currentLocale } from "@axiom/i18n/client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

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
import { evidenceKindLabel } from "../../lib/interface-labels";

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
  const { t } = useInterfaceLocale();
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
        throw new Error(t("Enter a valid, nonempty character range."));
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
      title={uiText("Review next outgoing batch")}
      subtitle={
        value
          ? t(
              "{provider} · {model} · round {round, number} of {total, number}",
              {
                provider: value.provider.name,
                model: value.provider.model,
                round: value.ordinal,
                total: value.budget.maxRounds,
              },
            )
          : uiText("Private local context")
      }
      className="assistant-context-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <ErrorNotice message={error || data.error} />
      <Notice tone="info">
        <I18nText id="This batch has not been sent. Approval sends only the exact messages shown below. Workspace changes still require separate review." />
      </Notice>
      {!value && (
        <HelpText>
          {data.loading
            ? uiText("Loading captured context…")
            : data.data && "message" in data.data
              ? data.data.message
              : t("The review could not be loaded.")}
        </HelpText>
      )}
      {value && (
        <>
          <dl className="assistant-review-summary">
            <div>
              <dt>
                <I18nText id="Outgoing" />
              </dt>
              <dd>
                <I18nText
                  id="{used, number} / {limit, number} characters"
                  values={{ used: value.characters, limit: 60000 }}
                />
              </dd>
            </div>
            <div>
              <dt>
                <I18nText id="New excerpts" />
              </dt>
              <dd>
                <I18nText
                  id="{excerpts, plural, one {# new excerpt} other {# new excerpts}} · {spaces, plural, one {# selected workspace} other {# selected workspaces}}"
                  values={{
                    excerpts: value.newEvidenceKeys.length,
                    spaces: value.spaceIds.length,
                  }}
                />
              </dd>
            </div>
            <div>
              <dt>
                <I18nText id="Output ceiling" />
              </dt>
              <dd>
                <I18nText
                  id="{count, plural, one {# token for this call} other {# tokens for this call}}"
                  values={{ count: value.budget.maxOutputTokens }}
                />
              </dd>
            </div>
            <div>
              <dt>
                <I18nText id="Requests so far" />
              </dt>
              <dd>
                <I18nText
                  id="{requests, number} requests · input {input} · output {output} tokens"
                  values={{
                    requests: value.usage.requests,
                    input:
                      value.usage.inputTokens?.toLocaleString(
                        currentLocale(),
                      ) ?? t("Unknown usage"),
                    output:
                      value.usage.outputTokens?.toLocaleString(
                        currentLocale(),
                      ) ?? t("Unknown usage"),
                  }}
                />
              </dd>
            </div>
          </dl>
          <HelpText>
            <I18nText
              id="Expires {time}. Monetary cost is not configured; provider billing and retention apply."
              values={{
                time: new Date(value.expiresAt).toLocaleTimeString(
                  currentLocale(),
                ),
              }}
            />
          </HelpText>
          {expired && (
            <Notice tone="warning">
              <I18nText id="This receipt expired. Refresh the preview and approve again; nothing will be submitted automatically." />
            </Notice>
          )}
          {!!value.newEvidenceKeys.length && (
            <section
              aria-label={uiText("Newly captured evidence")}
              className="assistant-review-excerpts"
            >
              <h3>
                <I18nText id="New evidence · captured locally" />
              </h3>
              {value.evidence
                .filter((e) => value.newEvidenceKeys.includes(e.key))
                .map((e) => (
                  <details key={e.key}>
                    <summary>
                      {e.title}
                      {e.locator ? " · " + e.locator : ""}
                    </summary>
                    <HelpText>
                      <I18nText
                        id="Captured {date} · {count, plural, one {# character} other {# characters}} · {kind}"
                        values={{
                          date: new Date(e.capturedAt).toLocaleString(
                            currentLocale(),
                          ),
                          count: e.source.length,
                          kind: evidenceKindLabel(e.kind),
                        }}
                      />
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
                      <I18nText id="Include this new excerpt" />
                    </label>
                    <pre className="assistant-excerpt">{e.source}</pre>
                    {["document", "office"].includes(e.kind) && (
                      <div className="assistant-review-range">
                        <Field label={uiText("From character (0-based)")}>
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
                        <Field label={uiText("To character (exclusive)")}>
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
            aria-label={uiText("Exact outgoing messages")}
          >
            <h3>
              <I18nText id="Complete outgoing context" />
            </h3>
            {value.messages.map((m, i) => (
              <details key={i}>
                <summary>
                  {(i + 1).toLocaleString(currentLocale())} ·{" "}
                  {m.role === "system"
                    ? uiText("Application instructions")
                    : m.role === "assistant"
                      ? t("Previous model output")
                      : t("Request, history or local evidence")}
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
            <I18nText id="I approve this exact batch and output limit for this provider. This does not approve later calls." />
          </label>
        )}
        <Button type="button" onClick={onClose} disabled={busy}>
          <I18nText id="Close review" />
        </Button>
        <Button
          type="button"
          disabled={busy}
          pending={busy}
          onClick={() => void refresh()}
        >
          {changed ? uiText("Update preview") : uiText("Refresh preview")}
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
            <I18nText id="Send this batch" />
          </Button>
        )}
        {data.error && (
          <Button type="button" onClick={data.reload} disabled={busy}>
            <I18nText id="Retry loading" />
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
