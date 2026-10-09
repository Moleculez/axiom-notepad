"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import {
  Button,
  Checkbox,
  NativeSelect,
  TextArea,
  TextInput,
  HelpText,
} from "../ui/controls";
import { useRef, useState } from "react";
import type {
  LibraryReference,
  LibraryScope,
  LibraryPreview,
  MergeReview,
} from "@axiom/shared/research-library";
import type { ReferenceDetails } from "@axiom/shared/research";
import { api } from "../../lib/client";
import Dialog, { DialogFooter } from "../Dialog";
import { ErrorNotice, useAction, useWorkspace } from "./ui";
import { referenceDraft, referenceLabels } from "./ReferenceDetails";
export default function ReferenceWorkflow({
  mode,
  scope,
  selected,
  onClose,
  onSaved,
  collectionId,
}: {
  mode: "import" | "copy" | "merge";
  scope: LibraryScope;
  selected: LibraryReference[];
  onClose: () => void;
  onSaved: () => void;
  collectionId?: string;
}) {
  useInterfaceLocale();
  const { spaces, notify } = useWorkspace(),
    action = useAction(),
    destinations = spaces.filter(
      (s) =>
        s.id !== scope.spaceId &&
        s.role === "editor" &&
        s.effective_status === "active",
    );
  const [source, setSource] = useState(""),
    [format, setFormat] = useState<"bib" | "ris">("bib"),
    [destination, setDestination] = useState(destinations[0]?.id ?? ""),
    [skip, setSkip] = useState(true),
    [consent, setConsent] = useState(false),
    [target, setTarget] = useState(selected[0]?.id ?? ""),
    [draft, setDraft] = useState<ReferenceDetails>(() =>
      referenceDraft(selected[0]),
    );
  const [preview, setPreview] = useState<
      (LibraryPreview & Partial<MergeReview>) | null
    >(null),
    identity = useRef(crypto.randomUUID());
  const [extraFields, setExtraFields] = useState<Record<string, string>>({});
  const [reviewedInput, setReviewedInput] = useState("");
  const reset = () => {
    setPreview(null);
    setConsent(false);
    identity.current = crypto.randomUUID();
  };
  const input = () =>
    mode === "import"
      ? {
          scope,
          source,
          format,
          skipDuplicates: skip,
          ...(collectionId ? { collectionId } : {}),
        }
      : mode === "copy"
        ? {
            scope: { spaceId: destination },
            sourceScope: scope,
            ids: selected.map((r) => r.id),
            skipDuplicates: skip,
          }
        : {
            scope,
            ids: selected.map((r) => r.id),
            targetId: target,
            versions: Object.fromEntries(
              selected.map((r) => [r.id, r.version]),
            ),
            draft,
            extraFields,
          };
  return (
    <Dialog
      title={
        mode === "import"
          ? uiText("Import references")
          : mode === "copy"
            ? "Copy references to a library"
            : "Review duplicate merge"
      }
      onClose={onClose}
      wide
    >
      <p className="muted">
        {mode === "merge"
          ? uiText(
              "Choose the retained reference and review each field. Existing citation keys and links remain valid; Markdown is not rewritten.",
            )
          : mode === "copy"
            ? "Copy bibliographic metadata and tags only. Files, annotations, reading history and access permissions are not copied."
            : "Review the parsed records before importing. Existing references are never overwritten."}
      </p>
      {mode === "import" && (
        <>
          <div className="library-import-controls">
            <label>
              <I18nText id="Format" />
              <NativeSelect
                aria-label={uiText("Bibliography format")}
                value={format}
                onChange={(e) => {
                  setFormat(e.target.value as "bib" | "ris");
                  reset();
                }}
              >
                <option value="bib">
                  <I18nText id="BibTeX" />
                </option>
                <option value="ris">
                  <I18nText id="RIS" />
                </option>
              </NativeSelect>
            </label>
            <label>
              <I18nText id="Choose a file" />
              <input
                aria-label={uiText("Import bibliography file")}
                type="file"
                accept=".bib,.ris"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file)
                    void action.run(async () => {
                      if (file.size > 2_000_000)
                        throw new Error("Choose a file up to 2 MB.");
                      setSource(await file.text());
                      setFormat(
                        file.name.toLowerCase().endsWith(".ris")
                          ? "ris"
                          : "bib",
                      );
                      reset();
                    });
                }}
              />
            </label>
          </div>
          <label>
            <I18nText id="Or paste a bibliography" />
            <TextArea
              aria-label={uiText("Bibliography source")}
              className="library-import-source"
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                reset();
              }}
              spellCheck={false}
            />
          </label>
        </>
      )}
      {mode === "copy" && (
        <label>
          <I18nText id="Destination library" />
          <NativeSelect
            aria-label={uiText("Destination library")}
            value={destination}
            onChange={(e) => {
              setDestination(e.target.value);
              reset();
            }}
          >
            {!destinations.length && (
              <option value="">
                <I18nText id="No writable destination workspace" />
              </option>
            )}
            {destinations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.group_name ? ` · ${s.group_name}` : uiText(" · Personal")}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
      {mode !== "merge" && (
        <label className="research-inline-check">
          <Checkbox
            checked={skip}
            onChange={(e) => {
              setSkip(e.target.checked);
              reset();
            }}
          />
          <I18nText id="Skip matching DOI, arXiv, or title/author/year duplicates" />
        </label>
      )}
      {mode === "merge" && (
        <>
          <label>
            <I18nText id="Retain this reference" />
            <NativeSelect
              aria-label={uiText("Retained reference")}
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setDraft(
                  referenceDraft(selected.find((r) => r.id === e.target.value)),
                );
                reset();
              }}
            >
              {selected.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.cite_key} · {r.title}
                </option>
              ))}
            </NativeSelect>
          </label>
          <div className="library-property-grid">
            {(Object.keys(referenceLabels) as (keyof ReferenceDetails)[]).map(
              (k) => (
                <div key={k} className="library-merge-field">
                  <label>
                    <span>{referenceLabels[k]}</span>
                    <NativeSelect
                      aria-label={`Merge ${k}`}
                      value={draft[k]}
                      onChange={(e) => {
                        setDraft({ ...draft, [k]: e.target.value });
                        reset();
                      }}
                    >
                      {[
                        ...new Set([...selected.map((r) => r[k]), draft[k]]),
                      ].map((v) => (
                        <option key={v} value={v}>
                          {v || "Empty"}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                  <TextInput
                    aria-label={`Custom merge ${k}`}
                    value={draft[k]}
                    onChange={(e) => {
                      setDraft({ ...draft, [k]: e.target.value });
                      reset();
                    }}
                  />
                </div>
              ),
            )}
          </div>
        </>
      )}
      {preview && (
        <section
          className="library-import-preview"
          aria-label={uiText("Reference operation preview")}
        >
          {mode === "merge" ? (
            <>
              <h3>
                <I18nText id="Keys retained after merging" />
              </h3>
              <p>{preview.keys?.join(" · ")}</p>
              <h3>
                <I18nText id="Why these records match" />
              </h3>
              <ul>
                {preview.matches?.map((match) => (
                  <li key={`${match.left}:${match.right}`}>
                    <strong>
                      {match.left} · {match.right}
                    </strong>
                    <span>
                      {match.reasons.length
                        ? match.reasons.join("; ")
                        : uiText(
                            "No conservative identity match. This is a manual merge; verify both sources.",
                          )}
                    </span>
                  </li>
                ))}
              </ul>
              {preview.impact && (
                <HelpText>
                  {preview.impact.notes} <I18nText id="accessible notes ·" />{" "}
                  {preview.impact.files} <I18nText id="accessible PDFs ·" />{" "}
                  {preview.impact.collections}{" "}
                  <I18nText id="collections. Existing citation keys remain valid." />
                </HelpText>
              )}
              <h3>
                <I18nText id="Field decisions" />
              </h3>
              <div className="library-merge-matrix">
                <table>
                  <thead>
                    <tr>
                      <th>
                        <I18nText id="Field" />
                      </th>
                      <th>
                        <I18nText id="Retained value" />
                      </th>
                      <th>
                        <I18nText id="Original values" />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      Object.keys(referenceLabels) as (keyof ReferenceDetails)[]
                    ).map((key) => (
                      <tr key={key}>
                        <th scope="row">{referenceLabels[key]}</th>
                        <td>{draft[key] || "Empty"}</td>
                        <td>
                          {selected.map((r) => (
                            <div key={r.id}>
                              <small>{r.cite_key}</small> {r[key] || "Empty"}
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!!preview.extraFields?.length && (
                <>
                  <h3>
                    <I18nText id="Additional BibTeX fields" />
                  </h3>
                  <HelpText>
                    <I18nText id="Keep the retained record's value by default. Choose an alternative before refreshing the merge review; every original record remains in history." />
                  </HelpText>
                  <div className="library-property-grid">
                    {preview.extraFields.map((field) => (
                      <label key={field.name}>
                        <span>{field.name}</span>
                        <NativeSelect
                          aria-label={`Merge extra ${field.name}`}
                          value={extraFields[field.name] ?? "__retain__"}
                          onChange={(e) => {
                            const next = e.target.value;
                            setExtraFields((old) => {
                              const result = { ...old };
                              if (next === "__retain__")
                                delete result[field.name];
                              else result[field.name] = next;
                              return result;
                            });
                            identity.current = crypto.randomUUID();
                          }}
                        >
                          <option value="__retain__">
                            <I18nText id="Keep retained record" />
                          </option>
                          {[...new Set(field.values.map((v) => v.value))].map(
                            (value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ),
                          )}
                        </NativeSelect>
                      </label>
                    ))}
                  </div>
                </>
              )}
              <p>
                <I18nText id="Links, collection membership and tags are combined. Each reader keeps their own most recently updated reading status." />
              </p>
            </>
          ) : (
            <>
              <h3>
                {preview.count} <I18nText id="reference" />
                {preview.count === 1 ? "" : "s"} <I18nText id="ready to" />{" "}
                {mode === "copy" ? uiText("copy") : uiText("import")}
              </h3>
              {preview.duplicates.length > 0 && (
                <p>
                  {preview.duplicates.length}{" "}
                  <I18nText id="possible duplicate" />
                  {preview.duplicates.length === 1 ? "" : "s"}
                  {skip
                    ? uiText(" will be skipped")
                    : uiText(" will be copied as separate entries")}
                  .
                </p>
              )}
              <ol>
                {preview.items.map((r) => (
                  <li key={r.citeKey}>
                    <strong>{r.title}</strong>
                    <small>
                      {r.citeKey} · {r.authors} · {r.year}
                    </small>
                  </li>
                ))}
              </ol>
              {preview.warnings.map((w, i) => (
                <p className="muted" key={i}>
                  {w}
                </p>
              ))}
            </>
          )}
          {preview.privateCopy && (
            <label className="synthesis-consent">
              <Checkbox
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <I18nText id="I understand that this private bibliographic metadata and its tags will be visible to readers of the destination workspace." />
            </label>
          )}
        </section>
      )}
      <ErrorNotice message={action.error} />
      <DialogFooter>
        <Button
          data-dialog-cancel
          className="button secondary"
          onClick={onClose}
        >
          <I18nText id="Cancel" />
        </Button>
        <Button
          className="button secondary"
          disabled={
            action.busy ||
            (mode === "import" && !source.trim()) ||
            (mode === "copy" && !destination)
          }
          onClick={() =>
            void action.run(async () => {
              setPreview(
                await api(`research/library/${mode}/preview`, {
                  method: "POST",
                  body: JSON.stringify(input()),
                }),
              );
              identity.current = crypto.randomUUID();
              setReviewedInput(JSON.stringify(input()));
            })
          }
        >
          {preview ? uiText("Refresh preview") : uiText("Preview changes")}
        </Button>
        <Button
          className="button primary"
          disabled={
            action.busy ||
            !preview ||
            (preview.privateCopy && !consent) ||
            JSON.stringify(input()) !== reviewedInput
          }
          onClick={() =>
            void action.run(async () => {
              await api(`research/library/${mode}/apply`, {
                method: "POST",
                body: JSON.stringify({
                  ...input(),
                  hash: preview!.hash,
                  mutationId: identity.current,
                  ...(mode !== "merge" ? { confirmAudience: consent } : {}),
                }),
              });
              notify(
                mode === "merge"
                  ? "References merged. Existing citation keys were preserved."
                  : "References saved.",
              );
              onSaved();
            })
          }
        >
          {mode === "merge"
            ? uiText("Merge references")
            : mode === "copy"
              ? "Copy references"
              : "Import references"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
