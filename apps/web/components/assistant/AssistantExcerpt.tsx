"use client";
import { currentLocale } from "@axiom/i18n/client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { Button, HelpText, TextInput, TextArea } from "../ui/controls";
import { useEffect, useMemo, useState } from "react";
import type { AssistantSelection } from "@axiom/shared/assistant";
import type { RevisionContent } from "@axiom/shared/revisions";
import Dialog from "../Dialog";
import { ErrorNotice, useData } from "../workspace/ui";

type DocumentSelection = Extract<AssistantSelection, { kind: "document" }>;
export default function AssistantExcerpt({
  selection,
  onChoose,
  onClose,
}: {
  selection: DocumentSelection;
  onChoose: (selection: DocumentSelection, label: string) => void;
  onClose: () => void;
}) {
  useInterfaceLocale();
  const data = useData<RevisionContent>(
    `resources/${selection.id}/history/current`,
  );
  const body = data.data?.body ?? "";
  const [range, setRange] = useState({ from: 0, to: 0 });
  const offsets = useMemo(
    () => [0, ...[...body.matchAll(/\n/g)].map((m) => m.index + 1)],
    [body],
  );
  const lineAt = (offset: number) => {
    let low = 0,
      high = offsets.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (offsets[middle] <= offset) low = middle + 1;
      else high = middle;
    }
    return Math.max(1, low);
  };
  useEffect(() => {
    if (data.data)
      setRange(
        selection.hash === data.data.hash
          ? { from: selection.from ?? 0, to: selection.to ?? body.length }
          : { from: 0, to: body.length },
      );
  }, [data.data, body, selection]);
  const length = range.to - range.from;
  return (
    <Dialog
      title={uiText("Choose document excerpt")}
      subtitle={data.data?.title ?? "Loading source…"}
      onClose={onClose}
    >
      <HelpText>
        <I18nText id="Select text below or choose line numbers. Only this exact passage will be attached. Changed server text requires a fresh selection." />
      </HelpText>
      <ErrorNotice message={data.error} />
      {data.loading ? (
        <p role="status">
          <I18nText id="Loading saved document…" />
        </p>
      ) : (
        data.data && (
          <>
            <div className="assistant-fields">
              <label>
                <I18nText id="From line" />
                <TextInput
                  aria-label={uiText("Excerpt from line")}
                  type="number"
                  min={1}
                  max={offsets.length}
                  value={lineAt(range.from)}
                  onChange={(e) => {
                    const from =
                      offsets[
                        Math.max(
                          0,
                          Math.min(
                            offsets.length - 1,
                            Number(e.target.value) - 1,
                          ),
                        )
                      ] ?? 0;
                    setRange((r) => ({ from, to: Math.max(from, r.to) }));
                  }}
                />
              </label>
              <label>
                <I18nText id="Through line" />
                <TextInput
                  aria-label={uiText("Excerpt through line")}
                  type="number"
                  min={1}
                  max={offsets.length}
                  value={lineAt(Math.max(range.from, range.to - 1))}
                  onChange={(e) => {
                    const to =
                      offsets[
                        Math.max(
                          1,
                          Math.min(offsets.length, Number(e.target.value)),
                        )
                      ] ?? body.length;
                    setRange((r) => ({ from: Math.min(r.from, to), to }));
                  }}
                />
              </label>
            </div>
            <TextArea
              className="assistant-excerpt-source"
              aria-label={uiText("Document excerpt source")}
              readOnly
              value={body}
              onSelect={(e) => {
                const el = e.currentTarget;
                if (el.selectionStart !== el.selectionEnd)
                  setRange({ from: el.selectionStart, to: el.selectionEnd });
              }}
            />
            <HelpText className={length > 30000 ? "form-error" : undefined}>
              {length.toLocaleString(currentLocale())} / 30,000 characters
              selected
            </HelpText>
            <details>
              <summary>
                <I18nText id="Selected passage" />
              </summary>
              <pre className="assistant-excerpt">
                {body.slice(range.from, range.to)}
              </pre>
            </details>
          </>
        )
      )}
      <div className="dialog-footer">
        <Button
          data-dialog-cancel
          className="button secondary"
          onClick={onClose}
        >
          <I18nText id="Cancel" />
        </Button>
        <Button
          className="button primary"
          disabled={!data.data || !!data.error || !length || length > 30000}
          onClick={() =>
            onChoose(
              { ...selection, ...range, hash: data.data!.hash },
              `${data.data!.title} · lines ${lineAt(range.from)}–${lineAt(Math.max(range.from, range.to - 1))}`,
            )
          }
        >
          <I18nText id="Use selected excerpt" />
        </Button>
      </div>
    </Dialog>
  );
}
