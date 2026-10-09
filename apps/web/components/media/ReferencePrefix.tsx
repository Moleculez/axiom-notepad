"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { Button, TextInput } from "../ui/controls";
import { useEffect, useState } from "react";
import type { Space } from "@axiom/shared/workspace";
import { api } from "../../lib/client";
import { ErrorNotice, useData } from "../workspace/ui";
export default function ReferencePrefix({ space }: { space: Space }) {
  useInterfaceLocale();
  const data = useData<{ reference_prefix: string | null }>(
    `spaces/${space.id}/reference-prefix`,
  );
  const [prefix, setPrefix] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  useEffect(() => {
    if (data.data) setPrefix(data.data.reference_prefix ?? "");
  }, [data.data]);
  return (
    <section className="settings-card">
      <h2>
        <I18nText id="File reference codes" />
      </h2>
      <p>
        <I18nText id="Give new notes and files a readable identity, such as LAB-42. Existing codes stay unchanged when files are renamed, moved, or the prefix changes." />
      </p>
      <ErrorNotice message={error || data.error} />
      <form
        className="media-filter-row"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          setStatus("");
          try {
            await api(`spaces/${space.id}/reference-prefix`, {
              method: "PUT",
              body: JSON.stringify({ prefix }),
            });
            data.reload();
            setStatus("Prefix saved. It applies to new files.");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          <I18nText id="Prefix" />
          <TextInput
            aria-label={uiText("File code prefix")}
            value={prefix}
            disabled={!space.can_manage}
            maxLength={12}
            pattern="[A-Z][A-Z0-9]{1,11}"
            onChange={(event) => setPrefix(event.target.value.toUpperCase())}
            placeholder={uiText("LAB")}
          />
        </label>
        {space.can_manage && (
          <Button
            className="button secondary"
            disabled={busy || !/^[A-Z][A-Z0-9]{1,11}$/.test(prefix)}
          >
            <I18nText id="Save prefix" />
          </Button>
        )}
      </form>
      <small role="status">
        {status ||
          "2–12 uppercase letters or digits; start with a letter. Prefixes are never reused by another workspace."}
      </small>
    </section>
  );
}
